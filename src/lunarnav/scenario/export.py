"""Exports: STK `.aem` mask, time-series CSV/JSON, interval, comparison, slip, opportunity CSVs, scenario JSON.

Every export carries provenance. CSV files start with `# key: value` comment lines (read them with
`pandas.read_csv(..., comment="#")`); JSON files embed a `provenance` object; the `.aem` file has no
comment syntax in the STK specification, so its provenance is written beside it as
`<name>.aem.provenance.json`. Each CSV also gets the full provenance sidecar `<name>.provenance.json`.
Time is ISO-8601 UTC (`utc`) next to ET seconds (`et`); bounded quantities carry `_lo`/`_hi` columns
(pessimistic / optimistic horizon world). Empty CSV cells mean "no value".
"""

from __future__ import annotations

import csv
import json
import math
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path

import numpy as np

from lunarnav.ephem import et_to_utc as _et_to_utc

from .compare import Comparison
from .engine import HOUR_S
from .evaluate import IntervalRow, SiteEvaluation
from .models import Scenario, SiteSpec
from .opportunities import OpportunityScan
from .slip import SlipResult

AEM_VERSION = "stk.v.6.0"
BOUNDS = ("nominal", "optimistic", "pessimistic")
DECIMATION_SERIES = ("sunlight_fraction", "array_power_w", "array_power_w_lo", "array_power_w_hi",
                    "contact_clearance_deg", "soc", "soc_lo", "soc_hi", "sun_el_deg")


def minmax_indices(series: Mapping[str, np.ndarray], max_points: int) -> np.ndarray:
    """Sorted unique sample indices that keep the first and last samples and, for each of the `series`,
    the minimum and the maximum inside every bucket.

    Each series contributes two samples per bucket, so with `k` series there are about
    `max_points / (2 k)` buckets and the result has at most `max_points` entries. Non-finite samples are
    ignored when picking extremes. If the input has no more than `max_points` samples, every index is
    returned.
    """
    arrays = [np.asarray(a, dtype=np.float64) for a in series.values()]
    if not arrays:
        raise ValueError("at least one series is required")
    n = arrays[0].size
    if any(a.shape != (n,) for a in arrays):
        raise ValueError("series must be 1-D arrays of equal length")
    if max_points < 4 or n <= max_points:
        if max_points < 4:
            raise ValueError("max_points must be at least 4")
        return np.arange(n)
    buckets = max(1, (max_points - 2) // (2 * len(arrays)))
    edges = np.linspace(0, n, buckets + 1).astype(np.int64)
    keep = {0, n - 1}
    for a in arrays:
        for lo, hi in zip(edges[:-1], edges[1:]):
            if hi <= lo:
                continue
            chunk = a[lo:hi]
            if not np.isfinite(chunk).any():
                continue
            keep.add(int(lo + np.nanargmin(np.where(np.isfinite(chunk), chunk, np.inf))))
            keep.add(int(lo + np.nanargmax(np.where(np.isfinite(chunk), chunk, -np.inf))))
    return np.array(sorted(keep), dtype=np.int64)


def et_to_utc(et):
    """UTC text of an ET (scalar) or array of ETs; a non-finite ET (no such event) becomes "" in a table.

    `lunarnav.ephem.et_to_utc` rejects NaN and infinity, so every place that formats an event time goes
    through this function and "no event" stays explicit (blank cell; the reason is in the metric note).
    """
    if np.ndim(et) == 0:
        return _et_to_utc(float(et)) if math.isfinite(float(et)) else ""
    a = np.asarray(et, dtype=np.float64)
    out = np.full(a.shape, "", dtype=object)
    ok = np.isfinite(a)
    if ok.any():
        out[ok] = list(_et_to_utc(a[ok]))
    return out


def _num(x: float | None) -> str:
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return ""
    return repr(float(x))


def _provenance_lines(prov: dict, kind: str) -> list[str]:
    ecl = prov.get("eclipse", {})
    kern = prov.get("kernels") or prov.get("ephemeris", {}).get("kernels") or {}
    lines = [
        f"lunarnav export: {kind}",
        f"schema_version: {prov.get('schema_version')}",
        f"scenario_sha256: {prov.get('scenario_sha256')}",
        f"code: {json.dumps(prov.get('code'), sort_keys=True)}",
        f"horizon_provider: {json.dumps(prov.get('horizon_provider'), sort_keys=True, default=str)}",
        f"eclipse: {json.dumps(ecl, sort_keys=True, default=str)}",
        f"kernels: {json.dumps(kern, sort_keys=True, default=str)}",
        "bounds: _lo = pessimistic case (the lowest value of the quantity, raised horizon), _hi = optimistic case (the highest, lowered horizon), no suffix = nominal",
    ]
    lines += [f"note: {n}" for n in prov.get("series_notes", [])]
    for key in ("scenario_sha256_by_name", "scenario_sha256_by_site"):
        if key in prov:
            lines.append(f"{key}: {json.dumps(prov[key], sort_keys=True)}")
    return lines


def _write_sidecar(path: Path, prov: dict) -> Path:
    side = path.with_name(path.name + ".provenance.json") if path.suffix == ".aem" else path.with_suffix(".provenance.json")
    side.write_text(json.dumps(prov, indent=2, sort_keys=True, default=str) + "\n")
    return side


def _write_csv(path: Path, prov: dict, kind: str, header: Sequence[str], rows: Iterable[Sequence]) -> Path:
    path = Path(path)
    with path.open("w", newline="") as f:
        for line in _provenance_lines(prov, kind):
            f.write(f"# {line}\n")
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    _write_sidecar(path, prov)
    return path


def write_aem(ev: SiteEvaluation, path: str | Path, *, horizon: str = "antenna", bound: str = "nominal") -> Path:
    """STK azimuth-elevation mask: version line, `BEGIN AzElMask`,
    `NumberOfPoints`, one `<az> <el>` row per horizon azimuth and a closing 360.0 row equal to the 0.0 row.

    `horizon` is `"antenna"` (Earth line of sight) or `"array"` (power); `bound` selects the nominal, optimistic
    (`elev_lo_deg`: the lowered horizon, which shows more of the target) or pessimistic (`elev_hi_deg`: the raised horizon, the
    conservative mask for a link or power analysis) horizon, as in `visibility.horizon_grid`. Elevation is the horizon elevation from the local
    horizontal plane, degrees, clamped to [-90, 90] as STK requires."""
    if bound not in BOUNDS:
        raise ValueError(f"bound must be one of {BOUNDS}")
    if horizon not in ("antenna", "array"):
        raise ValueError("horizon must be 'antenna' or 'array'")
    h = ev.signals.antenna_horizon if horizon == "antenna" else ev.signals.array_horizon
    field = {"nominal": "elev_deg", "optimistic": "elev_lo_deg", "pessimistic": "elev_hi_deg"}[bound]
    el = getattr(h, field)
    az = np.asarray(h.az_deg, dtype=float)
    el = np.clip(np.asarray(el, dtype=float), -90.0, 90.0)
    az = np.append(az, 360.0)
    el = np.append(el, el[0])
    path = Path(path)
    lines = [AEM_VERSION, "BEGIN AzElMask", f"NumberOfPoints {az.size}", "BEGIN AzElMaskData"]
    lines += [f"{a:.4f} {e:.6f}" for a, e in zip(az, el)]
    lines += ["END AzElMaskData", "END AzElMask"]
    path.write_text("\n".join(lines) + "\n")
    _write_sidecar(path, {**ev.provenance, "export": {"kind": "aem", "horizon": horizon, "bound": bound, "elevation_field": field}})
    return path


def read_aem(path: str | Path) -> tuple[np.ndarray, np.ndarray]:
    """Parse a simple `.aem` file written by `write_aem` (or any simple-form STK mask): azimuth and
    elevation arrays in degrees, including the closing 360 row."""
    lines = [ln.strip() for ln in Path(path).read_text().splitlines() if ln.strip()]
    if not lines[0].lower().startswith("stk.v."):
        raise ValueError("not an STK file: missing version line")
    n = next(int(ln.split()[1]) for ln in lines if ln.startswith("NumberOfPoints"))
    i0 = lines.index("BEGIN AzElMaskData") + 1
    data = np.array([[float(x) for x in ln.split()] for ln in lines[i0:i0 + n]])
    if lines[i0 + n] != "END AzElMaskData":
        raise ValueError("NumberOfPoints does not match the data block")
    return data[:, 0], data[:, 1]


def _series_selection(ev: SiteEvaluation, max_points: int | None, window: str) -> tuple[dict[str, np.ndarray], np.ndarray]:
    ts = ev.time_series()
    t = ts["et"]
    if window == "mission":
        idx = np.flatnonzero((t >= ev.t_land_et) & (t <= ev.t_land_et + ev.mission_s))
    elif window == "all":
        idx = np.arange(t.size)
    else:
        raise ValueError("window must be 'mission' or 'all'")
    if max_points is not None and idx.size > max_points:
        sub = {k: ts[k][idx] for k in DECIMATION_SERIES if k in ts}
        idx = idx[minmax_indices(sub, max_points)]
    return ts, idx


def _with_series_notes(ev: SiteEvaluation) -> dict:
    """Provenance with `series_notes`: why a series is empty (unknown heading: no nominal for `ev.no_nominal_series`)."""
    return {**ev.provenance, "series_notes": ev.series_notes}


def write_timeseries_csv(
    ev: SiteEvaluation, path: str | Path, *, max_points: int | None = None, window: str = "mission",
) -> Path:
    """Time series with bounds (`ev.time_series()`), `window` = `"mission"` (landing to end) or `"all"`.
    `max_points` applies min/max-preserving decimation (`minmax_indices`)."""
    ts, idx = _series_selection(ev, max_points, window)
    names = [k for k in ts if k != "et"]
    utc = et_to_utc(ts["et"][idx])
    rows = ([utc[r], repr(float(ts["et"][i])), *(_num(ts[k][i]) for k in names)] for r, i in enumerate(idx))
    return _write_csv(Path(path), _with_series_notes(ev), "timeseries", ["utc", "et", *names], rows)


def write_timeseries_json(
    ev: SiteEvaluation, path: str | Path, *, max_points: int | None = None, window: str = "mission",
) -> Path:
    """As `write_timeseries_csv`, as JSON: `{"provenance": ..., "series": {name: [...]}}` (NaN -> null)."""
    ts, idx = _series_selection(ev, max_points, window)
    series = {"utc": list(et_to_utc(ts["et"][idx]))}
    for k, v in ts.items():
        series[k] = [None if not math.isfinite(x) else float(x) for x in v[idx]]
    doc = {"provenance": _with_series_notes(ev), "decimated": max_points is not None, "series": series}
    path = Path(path)
    path.write_text(json.dumps(doc, indent=1, sort_keys=True, default=str) + "\n")
    return path


def _interval_row(kind: str, r: IntervalRow) -> list:
    return [kind, et_to_utc(r.start_et), et_to_utc(r.end_et), _num(r.duration_s / HOUR_S),
            *(["", ""] if r.start_range_censored else [et_to_utc(r.start_range[0]), et_to_utc(r.start_range[1])]),
            *(["", ""] if r.end_range_censored else [et_to_utc(r.end_range[0]), et_to_utc(r.end_range[1])]),
            int(r.start_censored), int(r.end_censored), int(r.nominal), int(r.certain),
            int(r.start_range_censored), int(r.end_range_censored)]


INTERVAL_HEADER = ["kind", "start_utc", "end_utc", "duration_h", "start_earliest_utc", "start_latest_utc",
                   "end_earliest_utc", "end_latest_utc", "start_censored", "end_censored", "nominal", "certain",
                   "start_range_censored", "end_range_censored"]


def write_intervals_csv(ev: SiteEvaluation, path: str | Path) -> Path:
    """Sunlit, dark, eclipse, contact and contact-gap intervals with edge-time ranges over the horizon
    worlds. `*_censored = 1` marks an edge that is the end of the analysed span, not a transition;
    `*_range_censored = 1` marks an edge range whose bound is only the edge of the data (beyond the analysed
    span): both bounds of that range are left blank; `nominal = 0` an interval only the optimistic world has; `certain = 0` one the pessimistic world lacks."""
    rows = [_interval_row(k, r) for k, rs in ev.intervals.items() for r in rs]
    return _write_csv(Path(path), ev.provenance, "intervals", INTERVAL_HEADER, rows)


def write_metrics_csv(ev: SiteEvaluation, path: str | Path) -> Path:
    """Headline metrics (nominal, low, high) and constraint verdicts."""
    rows = [["metric", m.key, m.label, _num(m.value), _num(m.low), _num(m.high), m.unit, int(m.censored), m.note]
            for m in ev.metrics]
    for c in ev.verdict.constraints:
        rows.append(["constraint", c.key, c.label, _num(c.value), _num(c.margin), _num(c.margin_worst), c.unit,
                     0, f"{c.state}; limit min={c.limit_min} max={c.limit_max}"])
    rows.append(["verdict", "overall", "", "", "", "", "", 0, f"{ev.verdict.state}; limiting={ev.verdict.limiting}"])
    return _write_csv(Path(path), ev.provenance, "metrics",
                      ["row", "key", "label", "value", "low_or_margin", "high_or_worst_margin", "unit", "censored",
                       "note"], rows)


def write_comparison_csv(cmp: Comparison, path: str | Path) -> Path:
    """Metric rows by scenario column (nominal values), then `verdict` and `limiting` rows.
    Provenance of the first scenario is recorded; each scenario's hash is in its own provenance."""
    header = ["metric", "label", "unit", *cmp.names]
    rows = [[r["metric"], r["label"], r["unit"], *(_num(r[n]) for n in cmp.names)] for r in cmp.rows()]
    rows.append(["verdict", "overall verdict", "", *cmp.states])
    rows.append(["limiting", "limiting constraint", "", *(x or "" for x in cmp.limiting)])
    prov = {**cmp.evaluations[0].provenance,
            "scenario_sha256_by_name": {n: e.provenance["scenario_sha256"] for n, e in zip(cmp.names, cmp.evaluations)}}
    return _write_csv(Path(path), prov, "comparison", header, rows)


def site_labels(results: Sequence[SlipResult]) -> list[str]:
    """One distinct label per result, in order: the catalogue id, else the site name, else `lat,lon`.

    Results whose label would be shared get `<name> @ <lat>,<lon>` (full float precision, so distinct coordinates give distinct
    labels); results that are the same name at the same point also get ` #<n>`. The same label is written in the `site`
    column of that site's rows, so a reader can join rows to `scenario_sha256_by_site`."""
    base = [r.site.catalog_id or r.site.name or f"{r.site.lat_deg!r},{r.site.lon_deg!r}" for r in results]
    out = [b if base.count(b) == 1 else f"{r.site.name or b} @ {r.site.lat_deg!r},{r.site.lon_deg!r}" for b, r in zip(base, results)]
    seen: dict[str, int] = {}
    for k, lab in enumerate(out):
        if out.count(lab) > 1:
            seen[lab] = seen.get(lab, 0) + 1
            out[k] = f"{lab} #{seen[lab]}"
    return out


def write_slip_csv(results: SlipResult | Sequence[SlipResult], path: str | Path,
                   primary_site: SiteSpec | None = None) -> Path:
    """Slip table(s): one row per slip and site.

    Provenance is that of the result whose site is `primary_site` (the submitted scenario's site; results come
    best-first, so the first one is not necessarily it), else of the first result. The scenario hash of every result is
    recorded as `scenario_sha256_by_site` (one entry per result, keyed by `site_labels`), as the comparison CSV does per name."""
    results = [results] if isinstance(results, SlipResult) else list(results)
    labels = site_labels(results)
    primary = next((r for r in results if primary_site is not None and r.site == primary_site), results[0])
    prov = {**primary.provenance,
            "scenario_sha256_by_site": {lab: r.provenance["scenario_sha256"] for lab, r in zip(labels, results)}}
    header = ["scenario", "site", "mode", "slip_h", "launch_utc", "landing_utc", "state", "limiting",
              "normalised_margin", "explanation", "next_open_utc", "next_open_wait_h", "next_open_state"]
    rows = [[res.scenario_name, lab, res.mode, _num(r.slip_h),
             r.launch_utc or "", r.landing_utc or "", r.state, r.limiting or "", _num(r.margin), r.explanation,
             r.next_open_utc or "", _num(r.next_open_wait_h), r.next_open_state or ""]
            for lab, res in zip(labels, results) for r in res.rows]
    return _write_csv(Path(path), prov, "slip", header, rows)


def write_opportunities_csv(scan: OpportunityScan, path: str | Path) -> Path:
    """Open landing windows (first/last open candidate, duration, best margin, limiting constraint, PASS-only
    sub-runs) of an opportunity scan."""
    rows = [[et_to_utc(w.start_et), et_to_utc(w.end_et), _num(w.duration_h), w.n_candidates, w.n_pass,
             et_to_utc(w.best_et), _num(w.best_margin), w.best_state, w.best_limiting or "",
             ";".join(f"{et_to_utc(a)}/{et_to_utc(b)}" for a, b in w.robust)] for w in scan.windows]
    return _write_csv(Path(path), scan.provenance, "opportunities",
                      ["start_utc", "end_utc", "duration_h", "n_candidates", "n_pass", "best_utc", "best_margin",
                       "best_state", "best_limiting", "pass_runs"], rows)


def write_calendar_csv(scan: OpportunityScan, path: str | Path) -> Path:
    """Calendar cells: lunation, time in lunation, best state, open fraction, dominant closing constraint,
    local solar time and Sun elevation of the cell's first candidate."""
    cal = scan.calendar
    rows = []
    for i, lu in enumerate(cal.lunations):
        for j in range(cal.state.shape[1]):
            if cal.state[i, j] < 0:
                continue
            lim = int(cal.limiting[i, j])
            rows.append([lu.brown_number, et_to_utc(lu.start_et), _num(j * cal.bin_h), _num((j + 1) * cal.bin_h),
                         ("fail", "marginal", "pass")[int(cal.state[i, j])], _num(cal.open_fraction[i, j]),
                         cal.keys[lim] if lim >= 0 else "", _num(cal.local_solar_time_h[i, j]),
                         _num(cal.sun_el_deg[i, j])])
    return _write_csv(Path(path), scan.provenance, "calendar",
                      ["lunation", "new_moon_utc", "hours_from", "hours_to", "state", "open_fraction",
                       "dominant_closing_constraint", "local_solar_time_h", "sun_el_deg"], rows)


def write_scenario_json(scenario: Scenario, path: str | Path) -> Path:
    """The scenario as JSON (round-trips through `read_scenario_json`)."""
    path = Path(path)
    path.write_text(scenario.model_dump_json(indent=2) + "\n")
    return path


def read_scenario_json(path: str | Path) -> Scenario:
    """Load and validate a scenario JSON."""
    return Scenario.model_validate_json(Path(path).read_text())


def export_evaluation(ev: SiteEvaluation, directory: str | Path, prefix: str = "scenario") -> dict[str, Path]:
    """Write every single-scenario export into `directory`; returns name -> path."""
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    return {
        "scenario": write_scenario_json(ev.scenario, d / f"{prefix}.scenario.json"),
        "timeseries_csv": write_timeseries_csv(ev, d / f"{prefix}.timeseries.csv"),
        "timeseries_json": write_timeseries_json(ev, d / f"{prefix}.timeseries.json"),
        "intervals": write_intervals_csv(ev, d / f"{prefix}.intervals.csv"),
        "metrics": write_metrics_csv(ev, d / f"{prefix}.metrics.csv"),
        "aem_antenna": write_aem(ev, d / f"{prefix}.antenna.aem", horizon="antenna"),
        "aem_array": write_aem(ev, d / f"{prefix}.array.aem", horizon="array"),
    }
