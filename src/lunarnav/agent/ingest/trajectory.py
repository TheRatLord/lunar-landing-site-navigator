"""Gated ingestion of a user-supplied relay/orbiter trajectory (CCSDS OEM text or a NAIF SPK) and the contact
windows it implies for a lunar surface site.

Trust model
    The file is untrusted. An OEM is parsed by a strict pure-Python reader (no eval, caps on bytes, lines and
    rows). An SPK is *never* furnished in the engine process: its DAF header is checked in Python, then
    ``spiceypy`` reads it in a child process with CPU, memory, file-size, output and wall-clock limits
    (`ingest.common.run_limited`), and only plain numbers come back. Every problem is a `Reason` code in a
    `TrajectoryReport`; malformed bytes never raise.

What is accepted
    Centre: the Moon (``MOON``, ``LUNA``, ``301``). Frames: EME2000/J2000, ICRF/GCRF (treated as J2000; the
    ~20 mas frame bias is far below the interpolation error, `FRAME_BIAS_IGNORED` warning) and the body-fixed
    ``MOON_ME``/``MOON_PA`` (converted to J2000 with the pinned lunar frame kernels before interpolation).
    Time systems: UTC, TAI, TT, GPS (= TAI - 19 s), TDB (UT1/TCG/TCB/mission clocks are refused). Units are
    those of the OEM standard (km, km/s); implausible magnitudes (below 1700 km or beyond 10^6 km from the Moon's
    centre, speed above 20 km/s) are refused as probable unit or centre mistakes. Other centres (Earth, EMB,
    L2 points) are refused rather than silently re-centred.

Interpolation (never extrapolates)
    Samples are interpolated in J2000 with a cubic Hermite spline (position and velocity) or a cubic spline
    (position only), then rotated to ``MOON_ME`` at each epoch. A gap larger than ``gap_factor`` times the
    median step splits the track into pieces, and no value is produced inside a gap or outside the data. The
    interpolation error is estimated by leave-one-out prediction of every interior sample from its two
    neighbours (`Trajectory.loo_error_km`); `TrajectoryThresholds` documents the calibrated limits.

Contact windows
    `relay_contacts` evaluates the relay's azimuth/elevation seen from a surface site, against the engine's
    terrain horizon (`HorizonProfile`) and its optimistic/pessimistic brackets, exactly as the engine does for
    ground stations (`visibility.disc.point_clearance_bounds`, `visibility.intervals`). Window edges are refined
    to the signal itself (not only the sampling grid); passes shorter than the grid step can be missed.
    It does **not** model link budget, Earth/Sun geometry, relay attitude or antenna patterns, the lunar limb
    beyond what the horizon already contains, or occultation by anything but terrain.
"""

from __future__ import annotations

import itertools
import json
import math
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import spiceypy as spice
from scipy.interpolate import CubicHermiteSpline, CubicSpline
from scipy.optimize import minimize_scalar
from spiceypy.utils.exceptions import SpiceyError

from lunarnav.agent.ingest.common import (
    MAX_FILE_BYTES,
    IngestRefusal,
    Reason,
    check_regular_file,
    python_roots,
    run_limited,
    sha256_file,
)
from lunarnav.constants import R_MOON_M
from lunarnav.ephem import et_to_utc, load_kernels, utc_to_et
from lunarnav.ephem.geometry import az_el_deg, local_basis
from lunarnav.ephem.kernels import kernel_dir
from lunarnav.types import HorizonProfile
from lunarnav.visibility._horizon import horizon_grid
from lunarnav.visibility.disc import point_clearance, point_clearance_bounds
from lunarnav.visibility.intervals import Window, bounded_windows, find_windows, window_stats

R_MOON_KM = R_MOON_M / 1000.0
MAX_OEM_ROWS = 200_000
MAX_OEM_LINES = 1_000_000
MAX_SPK_SAMPLES = 100_000
MAX_GRID_POINTS = 400_000


@dataclass(frozen=True, slots=True)
class TrajectoryThresholds:
    """Limits of the trajectory gates (calibration numbers in `CALIBRATION`)."""

    min_samples: int = 4
    gap_factor: float = 5.0
    """A step above this multiple of the median step is a gap: no interpolation across it."""
    loo_warn_km: float = 1.0
    """Leave-one-out prediction error above this warns (`INTERPOLATION_COARSE`)."""
    loo_refuse_km: float = 20.0
    """Leave-one-out error above this refuses (`INTERPOLATION_TOO_COARSE`)."""
    r_min_km: float = 1700.0
    r_max_km: float = 1.0e6
    v_max_km_s: float = 20.0


CALIBRATION: dict = {
    "loo_vs_true_error": (
        "A 100 km circular lunar orbit (period 7060 s) sampled at 30/60/120/300/600 s with exact Keplerian "
        "states: the leave-one-out error (prediction from the two neighbours, spacing 2h) is 16x the true "
        "Hermite interpolation error at spacing h, as the h^4 law predicts. "
        "Measured (LOO max / true max, km), circular "
        "100 km polar orbit: 30 s 3.9e-5 / 2.4e-6; 60 s 6.2e-4 / 3.9e-5; 120 s 9.9e-3 / 6.2e-4; 300 s 0.386 / 0.0242; "
        "600 s 6.08 / 0.386 (ratio 15.8-16.0). e=0.6, 12 h orbit: 60 s 4.1e-4 / 2.5e-5; 300 s 0.249 / 0.0157; "
        "600 s 3.74 / 0.240. Hence `loo_warn_km` = 1 km corresponds to a true error of about 60 m (a 300-360 s step on "
        "a low lunar orbit) and `loo_refuse_km` = 20 km to about 1.25 km (a step of roughly 800 s), where the "
        "contact edges of a relay seen at grazing elevation would move by minutes."
    ),
    "relay_contact_edges": (
        "Against an independent 1 s brute force (analytic Kepler states, own az/el algebra, own horizon "
        "interpolation, linear edge crossing) on a 2-day, e=0.6 orbit and a synthetic horizon, window edges agree to "
        "4e-5 s (max) in both MOON_ME and EME2000 inputs."
    ),
}


@dataclass(frozen=True, slots=True)
class Pass:
    """One relay contact window against the terrain horizon (ET seconds, TDB past J2000)."""

    start_et: float
    end_et: float
    start_censored: bool
    end_censored: bool
    start_range_et: tuple[float, float]
    end_range_et: tuple[float, float]
    certain: bool
    max_elevation_deg: float
    max_elevation_et: float
    peak_clearance_deg: float
    min_range_km: float
    max_range_km: float
    start_err_s: float
    end_err_s: float

    @property
    def duration_s(self) -> float:
        return self.end_et - self.start_et

    def to_dict(self) -> dict:
        return {
            "start_utc": et_to_utc(self.start_et), "end_utc": et_to_utc(self.end_et),
            "start_et": self.start_et, "end_et": self.end_et, "duration_s": self.duration_s,
            "start_censored": self.start_censored, "end_censored": self.end_censored,
            "start_range_et": list(self.start_range_et), "end_range_et": list(self.end_range_et),
            "certain": self.certain, "max_elevation_deg": self.max_elevation_deg,
            "max_elevation_et": self.max_elevation_et, "peak_clearance_deg": self.peak_clearance_deg,
            "min_range_km": self.min_range_km, "max_range_km": self.max_range_km,
            "start_err_s": self.start_err_s, "end_err_s": self.end_err_s,
        }


CAVEATS = (
    ("Geometric line of sight to the relay point over the terrain horizon only: no link budget, antenna pattern, "
    "Earth/Sun visibility, relay attitude or limb beyond the horizon profile."),
    ("The relay track is the user's, interpolated between samples (never extrapolated); its accuracy is the "
    "user's ephemeris accuracy plus the stated interpolation error."),
    "Passes shorter than the grid step can be missed; edges are refined to the signal itself.",
)


@dataclass(frozen=True, slots=True)
class RelayContacts:
    """Contact analysis of one relay track against one site horizon over ``[t0, t1]``."""

    t0: float
    t1: float
    passes: tuple[Pass, ...]
    n_passes: int
    total_contact_s: float
    contact_fraction: float
    longest_gap_s: float
    longest_gap_censored: bool
    coverage_fraction: float
    """Fraction of ``[t0, t1]`` where the trajectory has data; the rest is unknown and counts as no contact."""
    outages: tuple[tuple[float, float], ...]
    step_s: float
    margin_deg: float
    interp_error_km_est: float
    horizon_used: dict
    caveats: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "t0_utc": et_to_utc(self.t0), "t1_utc": et_to_utc(self.t1), "t0_et": self.t0, "t1_et": self.t1,
            "n_passes": self.n_passes, "passes": [p.to_dict() for p in self.passes],
            "total_contact_s": self.total_contact_s, "contact_fraction": self.contact_fraction,
            "longest_gap_s": self.longest_gap_s, "longest_gap_censored": self.longest_gap_censored,
            "coverage_fraction": self.coverage_fraction,
            "outages": [[a, b] for a, b in self.outages], "step_s": self.step_s, "margin_deg": self.margin_deg,
            "interp_error_km_est": self.interp_error_km_est, "horizon_used": self.horizon_used,
            "caveats": list(self.caveats),
        }


class _Piece:
    """A gap-free run of samples (J2000, km, km/s) with its interpolator."""

    def __init__(self, et: np.ndarray, pos: np.ndarray, vel: np.ndarray | None) -> None:
        self.et, self.pos, self.vel = et, pos, vel
        self.start, self.stop = float(et[0]), float(et[-1])
        self._f = CubicHermiteSpline(et, pos, vel) if vel is not None else CubicSpline(et, pos)

    def __call__(self, et: np.ndarray) -> np.ndarray:
        return np.asarray(self._f(et))


class Trajectory:
    """A validated relay track: gap-free pieces in J2000 plus provenance. Build with `load_oem`/`load_spk`."""

    def __init__(self, name: str, source: str, pieces: list[_Piece], meta: dict) -> None:
        self.name, self.source, self.pieces, self.meta = name, source, pieces, meta
        self.start = min(p.start for p in pieces)
        self.stop = max(p.stop for p in pieces)
        self.loo_error_km = _loo_stats(pieces)

    @property
    def n_samples(self) -> int:
        return int(sum(len(p.et) for p in self.pieces))

    def position_j2000(self, et: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Moon-centred J2000 position (km) at ``et``; rows outside every piece are NaN and ``valid`` False."""
        et = np.atleast_1d(np.asarray(et, float))
        out = np.full((et.size, 3), np.nan)
        valid = np.zeros(et.size, bool)
        for p in self.pieces:
            m = (et >= p.start) & (et <= p.stop)
            if m.any():
                out[m] = p(et[m])
                valid |= m
        return out, valid

    def position_me(self, et: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Moon-centred ``MOON_ME`` position (km) at ``et`` (rotated epoch by epoch); NaN outside the data."""
        load_kernels()
        et = np.atleast_1d(np.asarray(et, float))
        pos, valid = self.position_j2000(et)
        for i in np.nonzero(valid)[0]:
            pos[i] = np.asarray(spice.pxform("J2000", "MOON_ME", float(et[i]))) @ pos[i]
        return pos, valid


def _loo_pieces(p: _Piece) -> np.ndarray:
    """Leave-one-out prediction error (km) of each interior sample from its neighbours."""
    t, x, v = p.et, p.pos, p.vel
    if v is not None:
        if len(t) < 3:
            return np.empty(0)
        h = (t[2:] - t[:-2])[:, None]
        s = ((t[1:-1] - t[:-2])[:, None]) / h
        m0, m1 = v[:-2] * h, v[2:] * h
        s2, s3 = s * s, s * s * s
        pred = (2 * s3 - 3 * s2 + 1) * x[:-2] + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * x[2:] + (s3 - s2) * m1
        return np.linalg.norm(pred - x[1:-1], axis=1)
    if len(t) < 5:
        return np.empty(0)
    idx = np.arange(2, len(t) - 2)
    pred = np.zeros((idx.size, 3))
    nodes = [idx - 2, idx - 1, idx + 1, idx + 2]
    for a, ja in enumerate(nodes):
        w = np.ones(idx.size)
        for b, jb in enumerate(nodes):
            if a != b:
                w *= (t[idx] - t[jb]) / (t[ja] - t[jb])
        pred += w[:, None] * x[ja]
    return np.linalg.norm(pred - x[idx], axis=1)


def _loo_stats(pieces: list[_Piece]) -> dict:
    e = np.concatenate([_loo_pieces(p) for p in pieces]) if pieces else np.empty(0)
    if e.size == 0:
        return {"n": 0, "max_km": 0.0, "p95_km": 0.0, "median_km": 0.0}
    return {"n": int(e.size), "max_km": float(e.max()), "p95_km": float(np.percentile(e, 95)), "median_km": float(np.median(e))}


@dataclass
class TrajectoryReport:
    """Outcome of loading a trajectory file; ``trajectory`` is set iff ``accepted``."""

    path: str
    name: str = ""
    sha256: str = ""
    size_bytes: int = 0
    format: str = ""
    refusals: list[Reason] = field(default_factory=list)
    warnings: list[Reason] = field(default_factory=list)
    trajectory: Trajectory | None = None
    summary: dict = field(default_factory=dict)

    @property
    def accepted(self) -> bool:
        return not self.refusals and self.trajectory is not None

    @property
    def refusal_codes(self) -> list[str]:
        return [r.code for r in self.refusals]

    @property
    def warning_codes(self) -> list[str]:
        return [r.code for r in self.warnings]

    def raise_if_refused(self) -> None:
        if self.refusals:
            raise IngestRefusal(self.refusals)

    def to_dict(self) -> dict:
        return {
            "accepted": self.accepted, "path": self.path, "name": self.name, "sha256": self.sha256,
            "size_bytes": self.size_bytes, "format": self.format,
            "refusals": [r.to_dict() for r in self.refusals], "warnings": [r.to_dict() for r in self.warnings],
            "summary": self.summary,
        }


def _ref(rep: TrajectoryReport, code: str, message: str, **detail: Any) -> TrajectoryReport:
    rep.refusals.append(Reason(code, message, detail))
    return rep


def _warn(rep: TrajectoryReport, code: str, message: str, **detail: Any) -> None:
    rep.warnings.append(Reason(code, message, detail))


_CALENDAR = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,12})?Z?$")
_DOY = re.compile(r"^(\d{4})-(\d{3})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,12})?Z?$")
_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
MAX_OEM_LINE_CHARS = 10_000
"""A longer line is refused outright: a KVN record or a state vector row is far shorter."""


def _kv(line: str) -> tuple[str, str] | None:
    """``(key, value)`` of a ``KEY = value`` record, else ``None``. Linear in the line length."""
    key, sep, value = line.partition("=")
    key = key.strip()
    if not sep or not _KEY.fullmatch(key):
        return None
    return key, value.strip()
_J2000_ORD = date(2000, 1, 1).toordinal()
_TIME_SYSTEMS = {"UTC", "TAI", "TT", "GPS", "TDB"}
_MOON_NAMES = {"MOON", "LUNA", "301", "MOON CENTER"}
_INERTIAL = {"EME2000": False, "J2000": False, "ICRF": True, "ICRF2": True, "GCRF": True}
_BODY_FRAMES = {"MOON_ME", "MOON_PA"}


class _Fail(Exception):
    def __init__(self, code: str, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.reason = Reason(code, message, detail)


@dataclass
class _Segment:
    meta: dict
    epochs: list[str] = field(default_factory=list)
    lines: list[int] = field(default_factory=list)
    rows: list[list[float]] = field(default_factory=list)


def _parse_epoch(s: str, line: int) -> tuple[int, int, int, int, int, float]:
    m = _CALENDAR.match(s)
    if m:
        y, mo, d, h, mi, sec = (int(m.group(i)) for i in range(1, 7))
        frac = float(m.group(7)) if m.group(7) else 0.0
    else:
        m = _DOY.match(s)
        if not m:
            raise _Fail("EPOCH_UNPARSEABLE", f"line {line}: cannot parse epoch {s[:40]!r}", line=line)
        y, doy, h, mi, sec = (int(m.group(i)) for i in range(1, 6))
        frac = float(m.group(6)) if m.group(6) else 0.0
        if not 1 <= doy <= (366 if date(y, 12, 31).timetuple().tm_yday == 366 else 365):
            raise _Fail("EPOCH_INVALID", f"line {line}: day of year {doy} invalid", line=line)
        dt = date.fromordinal(date(y, 1, 1).toordinal() + doy - 1)
        mo, d = dt.month, dt.day
    try:
        date(y, mo, d)
    except ValueError:
        raise _Fail("EPOCH_INVALID", f"line {line}: invalid calendar date in {s[:40]!r}", line=line) from None
    if not (1950 <= y <= 2100) or h > 23 or mi > 59 or sec > 60:
        raise _Fail("EPOCH_INVALID", f"line {line}: epoch field out of range in {s[:40]!r}", line=line)
    return y, mo, d, h, mi, sec + frac


def _epochs_to_et(labels: list[str], lines: list[int], system: str) -> np.ndarray:
    parsed = [_parse_epoch(s, ln) for s, ln in zip(labels, lines, strict=True)]
    if system == "UTC":
        strs = [f"{y:04d}-{mo:02d}-{d:02d}T{h:02d}:{mi:02d}:{sec:09.6f}" for y, mo, d, h, mi, sec in parsed]
        try:
            return np.asarray(utc_to_et(strs), float)
        except (ValueError, SpiceyError) as e:
            raise _Fail("EPOCH_INVALID", f"UTC epoch rejected: {str(e)[:160]}") from None
    secs = np.empty(len(parsed))
    for i, (y, mo, d, h, mi, sec) in enumerate(parsed):
        if sec >= 60.0:
            raise _Fail("EPOCH_INVALID", f"line {lines[i]}: second 60 only exists in UTC", line=lines[i])
        secs[i] = (date(y, mo, d).toordinal() - _J2000_ORD) * 86400.0 + h * 3600.0 + mi * 60.0 + sec - 43200.0
    load_kernels()
    if system == "TDB":
        return secs
    tt = secs + {"TT": 0.0, "TAI": 32.184, "GPS": 51.184}[system]
    return np.array([spice.unitim(float(x), "TDT", "TDB") for x in tt])


def _split_oem(text: str, max_rows: int) -> tuple[dict, list[_Segment]]:
    """Strict KVN OEM parser. Raises `_Fail` on the first structural problem."""
    header: dict = {}
    segs: list[_Segment] = []
    cur: _Segment | None = None
    state = "header"
    nrows = 0
    lines = text.splitlines()
    if len(lines) > MAX_OEM_LINES:
        raise _Fail("TOO_MANY_LINES", f"{len(lines)} lines exceeds the {MAX_OEM_LINES}-line cap", lines=len(lines))
    seen_version = False
    for ln, raw in enumerate(lines, 1):
        if len(raw) > MAX_OEM_LINE_CHARS:
            raise _Fail("LINE_TOO_LONG", f"line {ln} has {len(raw)} characters; the cap is {MAX_OEM_LINE_CHARS}", line=ln)
        line = raw.strip()
        if not line or line.startswith("COMMENT"):
            continue
        if not seen_version:
            m = _kv(line)
            if not m or m[0] != "CCSDS_OEM_VERS":
                raise _Fail("NOT_OEM", "not a KVN CCSDS OEM: the first record must be CCSDS_OEM_VERS", line=ln)
            if m[1] not in ("1.0", "2.0", "3.0"):
                raise _Fail("OEM_VERSION_UNSUPPORTED", f"OEM version {m[1][:20]!r} is not 1.0/2.0/3.0", line=ln)
            header["CCSDS_OEM_VERS"] = m[1]
            seen_version = True
            continue
        if line == "META_START":
            if state == "meta":
                raise _Fail("OEM_STRUCTURE", f"line {ln}: META_START inside a metadata block", line=ln)
            cur = _Segment(meta={})
            segs.append(cur)
            state = "meta"
            continue
        if line == "META_STOP":
            if state != "meta":
                raise _Fail("OEM_STRUCTURE", f"line {ln}: META_STOP without META_START", line=ln)
            state = "data"
            continue
        if line == "COVARIANCE_START":
            if state != "data":
                raise _Fail("OEM_STRUCTURE", f"line {ln}: COVARIANCE_START outside a data block", line=ln)
            state = "cov"
            continue
        if line == "COVARIANCE_STOP":
            if state != "cov":
                raise _Fail("OEM_STRUCTURE", f"line {ln}: COVARIANCE_STOP without COVARIANCE_START", line=ln)
            state = "data"
            continue
        if state == "cov":
            continue
        if state == "header":
            m = _kv(line)
            if not m:
                raise _Fail("OEM_STRUCTURE", f"line {ln}: expected a header keyword before META_START", line=ln)
            header[m[0]] = m[1]
            continue
        if state == "meta":
            m = _kv(line)
            if not m:
                raise _Fail("OEM_STRUCTURE", f"line {ln}: expected KEY = value in the metadata block", line=ln)
            assert cur is not None
            cur.meta[m[0]] = m[1]
            continue
        assert cur is not None
        tok = line.split()
        if len(tok) - 1 not in (3, 6, 9):
            raise _Fail("BAD_DATA_LINE", f"line {ln}: a state line needs an epoch plus 3, 6 or 9 numbers, got {len(tok) - 1}",
                        line=ln)
        if "_" in line:
            raise _Fail("BAD_DATA_LINE", f"line {ln}: unexpected character in a numeric field", line=ln)
        try:
            vals = [float(x) for x in tok[1:]]
        except ValueError:
            raise _Fail("BAD_DATA_LINE", f"line {ln}: non-numeric field", line=ln) from None
        if not all(math.isfinite(v) for v in vals):
            raise _Fail("NONFINITE_VALUE", f"line {ln}: NaN or infinite value in a state", line=ln)
        nrows += 1
        if nrows > max_rows:
            raise _Fail("TOO_MANY_ROWS", f"more than {max_rows} state rows", max_rows=max_rows)
        if cur.rows and len(vals) != len(cur.rows[0]):
            raise _Fail("INCONSISTENT_COLUMNS", f"line {ln}: {len(vals)} numbers but earlier rows have {len(cur.rows[0])}",
                        line=ln)
        cur.epochs.append(tok[0])
        cur.lines.append(ln)
        cur.rows.append(vals)
    if not seen_version:
        raise _Fail("NOT_OEM", "empty OEM")
    if state in ("meta", "cov"):
        raise _Fail("OEM_TRUNCATED", "the file ends inside a metadata or covariance block")
    if not segs:
        raise _Fail("OEM_STRUCTURE", "no META_START/data segment")
    return header, segs


def _to_j2000(et: np.ndarray, pos: np.ndarray, vel: np.ndarray | None, frame: str) -> tuple[np.ndarray, np.ndarray | None]:
    if frame not in _BODY_FRAMES:
        return pos, vel
    load_kernels()
    p = np.empty_like(pos)
    v = None if vel is None else np.empty_like(vel)
    for i, t in enumerate(et):
        if vel is None:
            p[i] = np.asarray(spice.pxform(frame, "J2000", float(t))) @ pos[i]
        else:
            s = np.asarray(spice.sxform(frame, "J2000", float(t))) @ np.concatenate([pos[i], vel[i]])
            p[i], v[i] = s[:3], s[3:]
    return p, v


def _build_pieces(et: np.ndarray, pos: np.ndarray, vel: np.ndarray | None, th: TrajectoryThresholds,
                  rep: TrajectoryReport, label: str) -> list[_Piece]:
    step = np.diff(et)
    med = float(np.median(step))
    cut = np.nonzero(step > th.gap_factor * med)[0]
    bounds = [0, *(cut + 1).tolist(), len(et)]
    pieces: list[_Piece] = []
    for a, b in itertools.pairwise(bounds):
        if b - a < th.min_samples:
            _warn(rep, "PIECE_DROPPED", f"{label}: {b - a} isolated samples between gaps are too few to interpolate and were dropped",
                  n=b - a)
            continue
        pieces.append(_Piece(et[a:b], pos[a:b], None if vel is None else vel[a:b]))
    if len(cut):
        _warn(rep, "TRAJECTORY_GAPS", f"{label}: {len(cut)} gap(s) larger than {th.gap_factor:g}x the median step "
              f"({med:g} s); nothing is interpolated across them",
              gaps=[[float(et[i]), float(et[i + 1])] for i in cut[:20]])
    return pieces


def _plausible(rep: TrajectoryReport, pos: np.ndarray, vel: np.ndarray | None, th: TrajectoryThresholds) -> bool:
    r = np.linalg.norm(pos, axis=1)
    if r.min() < th.r_min_km:
        _ref(rep, "TRAJECTORY_BELOW_SURFACE", f"distance from the Moon's centre reaches {r.min():.1f} km (< {th.r_min_km:.0f} km): "
             "wrong units, centre or frame?", r_min_km=float(r.min()))
        return False
    if r.max() > th.r_max_km:
        _ref(rep, "TRAJECTORY_TOO_FAR", f"distance from the Moon's centre reaches {r.max():.3g} km (> {th.r_max_km:.0e} km): "
             "wrong units, centre or frame?", r_max_km=float(r.max()))
        return False
    if vel is not None and float(np.linalg.norm(vel, axis=1).max()) > th.v_max_km_s:
        _ref(rep, "VELOCITY_IMPLAUSIBLE", f"speed reaches {np.linalg.norm(vel, axis=1).max():.3g} km/s (> {th.v_max_km_s:g})")
        return False
    return True


def _finish(rep: TrajectoryReport, name: str, source: str, pieces: list[_Piece], meta: dict, th: TrajectoryThresholds) -> TrajectoryReport:
    if not pieces:
        return _ref(rep, "INSUFFICIENT_SAMPLES", f"no run of at least {th.min_samples} samples without gaps")
    traj = Trajectory(name, source, pieces, meta)
    loo = traj.loo_error_km
    if loo["max_km"] > th.loo_refuse_km:
        return _ref(rep, "INTERPOLATION_TOO_COARSE", f"samples are too sparse for the orbit: predicting a sample from its neighbours "
                    f"is off by up to {loo['max_km']:.1f} km (limit {th.loo_refuse_km:g} km)", **loo)
    if loo["max_km"] > th.loo_warn_km:
        _warn(rep, "INTERPOLATION_COARSE", f"leave-one-out error up to {loo['max_km']:.2f} km; the true interpolation error is "
              "about 1/16 of that for cubic Hermite", **loo)
    rep.trajectory = traj
    rep.summary = trajectory_summary(traj)
    return rep


def load_oem(path: str | Path, *, max_bytes: int | None = None, max_rows: int = MAX_OEM_ROWS,
             thresholds: TrajectoryThresholds | None = None) -> TrajectoryReport:
    """Parse and validate a CCSDS OEM (KVN) trajectory. Never raises on bad content; see ``report.refusals``."""
    th = thresholds or TrajectoryThresholds()
    p = Path(path)
    rep = TrajectoryReport(path=str(p), name=p.name, format="OEM")
    try:
        rep.size_bytes = check_regular_file(p, max_bytes if max_bytes is not None else MAX_FILE_BYTES["trajectory"], kind="trajectory")
        data = p.read_bytes()
        rep.sha256 = sha256_file(p)
    except IngestRefusal as e:
        rep.refusals.extend(e.reasons)
        return rep
    except OSError as e:
        return _ref(rep, "FILE_UNREADABLE", f"cannot read the file: {type(e).__name__}")
    if b"\x00" in data:
        return _ref(rep, "NOT_TEXT", "the file contains NUL bytes; an OEM is a text file")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return _ref(rep, "NOT_TEXT", "the file is not valid UTF-8 text")
    if text.lstrip().startswith("<"):
        return _ref(rep, "OEM_XML_UNSUPPORTED", "XML OEM is not supported; supply the KVN (text) form")
    try:
        header, segs = _split_oem(text, max_rows)
        return _oem_to_report(rep, header, segs, th)
    except _Fail as f:
        rep.refusals.append(f.reason)
        return rep
    except (ValueError, KeyError, IndexError, OverflowError, SpiceyError) as e:
        return _ref(rep, "OEM_UNREADABLE", f"unexpected failure while reading the OEM: {type(e).__name__}")


def _oem_to_report(rep: TrajectoryReport, header: dict, segs: list[_Segment], th: TrajectoryThresholds) -> TrajectoryReport:
    all_et, all_pos, all_vel = [], [], []
    names, ids = set(), set()
    meta0: dict = {}
    for k, seg in enumerate(segs):
        m = seg.meta
        label = f"segment {k + 1}"
        missing = [key for key in ("CENTER_NAME", "REF_FRAME", "TIME_SYSTEM") if key not in m]
        if missing:
            raise _Fail("MISSING_METADATA", f"{label}: missing {', '.join(missing)}", missing=missing)
        if not seg.rows:
            raise _Fail("INSUFFICIENT_SAMPLES", f"{label} has no state lines")
        if m["CENTER_NAME"].upper() not in _MOON_NAMES:
            raise _Fail("CENTER_NOT_MOON", f"{label}: centre {m['CENTER_NAME'][:40]!r}; only Moon-centred trajectories are accepted "
                        "(re-centre first)", center=m["CENTER_NAME"][:40])
        frame = m["REF_FRAME"].upper()
        if frame in _INERTIAL:
            if _INERTIAL[frame]:
                _warn(rep, "FRAME_BIAS_IGNORED", f"{label}: frame {frame} treated as J2000 (bias ~20 mas ignored)")
        elif frame not in _BODY_FRAMES:
            raise _Fail("FRAME_UNSUPPORTED", f"{label}: reference frame {m['REF_FRAME'][:30]!r} is not supported "
                        "(EME2000, J2000, ICRF, GCRF, MOON_ME, MOON_PA)", frame=m["REF_FRAME"][:30])
        system = m["TIME_SYSTEM"].upper()
        if system not in _TIME_SYSTEMS:
            raise _Fail("TIME_SYSTEM_UNSUPPORTED", f"{label}: time system {m['TIME_SYSTEM'][:20]!r} not supported "
                        f"({', '.join(sorted(_TIME_SYSTEMS))})", time_system=m["TIME_SYSTEM"][:20])
        names.add(m.get("OBJECT_NAME", ""))
        ids.add(m.get("OBJECT_ID", ""))
        if k == 0:
            meta0 = {kk: vv[:80] for kk, vv in m.items() if kk in ("OBJECT_NAME", "OBJECT_ID", "CENTER_NAME", "REF_FRAME", "TIME_SYSTEM",
                                                                   "INTERPOLATION", "INTERPOLATION_DEGREE")}
            meta0["CCSDS_OEM_VERS"] = header.get("CCSDS_OEM_VERS")
        et = _epochs_to_et(seg.epochs, seg.lines, system)
        d = np.diff(et)
        if np.any(d <= 0):
            i = int(np.nonzero(d <= 0)[0][0]) + 1
            code = "DUPLICATE_EPOCH" if d[i - 1] == 0 else "NON_MONOTONIC_EPOCH"
            raise _Fail(code, f"{label}, line {seg.lines[i]}: epoch {seg.epochs[i]} does not follow {seg.epochs[i - 1]}", line=seg.lines[i])
        arr = np.asarray(seg.rows, float)
        pos, vel = arr[:, :3], (arr[:, 3:6] if arr.shape[1] >= 6 else None)
        if arr.shape[1] == 9:
            _warn(rep, "ACCELERATIONS_IGNORED", f"{label}: acceleration columns are ignored")
        if len(et) < th.min_samples:
            raise _Fail("INSUFFICIENT_SAMPLES", f"{label} has {len(et)} samples; at least {th.min_samples} are needed", n=len(et))
        if m.get("START_TIME") and m.get("STOP_TIME"):
            try:
                lo = _epochs_to_et([m["START_TIME"]], [0], system)[0]
                hi = _epochs_to_et([m["STOP_TIME"]], [0], system)[0]
                if et[0] < lo - 1e-3 or et[-1] > hi + 1e-3:
                    _warn(rep, "META_RANGE_MISMATCH", f"{label}: data epochs lie outside START_TIME..STOP_TIME")
            except _Fail:
                _warn(rep, "META_RANGE_UNPARSED", f"{label}: START_TIME/STOP_TIME could not be parsed")
        try:
            for t in (et[0], et[-1]):
                spice.pxform("J2000", "MOON_ME", float(t))
        except SpiceyError:
            raise _Fail("EPOCH_OUTSIDE_KERNELS", f"{label}: epochs lie outside the lunar frame kernel coverage",
                        start_utc=et_to_utc(float(et[0])), stop_utc=et_to_utc(float(et[-1]))) from None
        pos, vel = _to_j2000(et, pos, vel, frame)
        if not _plausible(rep, pos, vel, th):
            return rep
        all_et.append(et)
        all_pos.append(pos)
        all_vel.append(vel)
    if len(ids) > 1 or len(names) > 1:
        raise _Fail("MIXED_OBJECTS", "segments describe different objects; supply one object per file",
                    names=sorted(names)[:5], ids=sorted(ids)[:5])
    order = np.argsort([e[0] for e in all_et])
    for a, b in itertools.pairwise(order):
        if all_et[b][0] <= all_et[a][-1]:
            raise _Fail("OVERLAPPING_SEGMENTS", "OEM segments overlap in time or share an epoch; each epoch may appear once")
    et = np.concatenate([all_et[k] for k in order])
    pos = np.concatenate([all_pos[k] for k in order])
    have_vel = all(all_vel[k] is not None for k in order)
    vel = np.concatenate([all_vel[k] for k in order]) if have_vel else None
    if not have_vel and any(v is not None for v in all_vel):
        _warn(rep, "VELOCITY_PARTIAL", "some segments lack velocities; positions only were used for the whole file")
    pieces = _build_pieces(et, pos, vel, th, rep, "track")
    return _finish(rep, meta0.get("OBJECT_NAME", ""), f"oem:{rep.name}", pieces, meta0, th)


_SPK_SCRIPT = r"""
import json, sys
import spiceypy as sp
a = json.loads(sys.argv[1])
out = {"ok": False}
try:
    if a.get("de440"):
        sp.furnsh(a["de440"])
    sp.furnsh(a["spk"])
    ids = [int(i) for i in sp.spkobj(a["spk"])]
    out["ids"] = ids
    tgt = a.get("target")
    if tgt is None and len(ids) != 1:
        out["error"] = "AMBIGUOUS_TARGET"
    elif tgt is not None and tgt not in ids:
        out["error"] = "TARGET_NOT_IN_SPK"
    else:
        if tgt is None:
            tgt = ids[0]
        cov = sp.spkcov(a["spk"], tgt)
        ivs = [list(sp.wnfetd(cov, i)) for i in range(sp.wncard(cov))]
        total = sum(r - l for l, r in ivs)
        step = max(a["step_s"], total / a["max_samples"])
        samples, which = [], []
        for k, (l, r) in enumerate(ivs):
            n = int((r - l) // step) + 1
            times = [l + i * step for i in range(n)]
            if r - times[-1] > 1e-6:
                times.append(r)
            for t in times:
                st, _ = sp.spkez(tgt, t, "J2000", "NONE", 301)
                samples.append([t] + [float(x) for x in st])
                which.append(k)
        out.update(ok=True, target=tgt, intervals=ivs, samples=samples, which=which, step_s=step)
except Exception as e:
    out = {"ok": False, "error": "SPICE_ERROR", "message": str(e)[:300]}
print(json.dumps(out))
"""


def load_spk(path: str | Path, *, target: int | None = None, step_s: float = 30.0, max_samples: int = MAX_SPK_SAMPLES,
             max_bytes: int | None = None, thresholds: TrajectoryThresholds | None = None,
             hide_dirs: Sequence[str | Path] = ()) -> TrajectoryReport:
    """Read a NAIF SPK in a resource-limited child process and resample it (J2000, Moon-centred) every ``step_s``.

    The SPK is never loaded into the calling process. ``target`` selects the NAIF body id when the file holds
    several (else exactly one is required). The object's chain to the Moon must be resolvable from the SPK
    itself or from the pinned DE440 (`SPK_CHAIN_UNRESOLVED` otherwise). Interpolation error of the *resampling*
    is the leave-one-out figure of the returned track; pick ``step_s`` well below the orbital period / 30.
    """
    th = thresholds or TrajectoryThresholds()
    p = Path(path)
    rep = TrajectoryReport(path=str(p), name=p.name, format="SPK")
    try:
        rep.size_bytes = check_regular_file(p, max_bytes if max_bytes is not None else MAX_FILE_BYTES["trajectory"], kind="trajectory")
        with p.open("rb") as fh:
            head = fh.read(8)
        rep.sha256 = sha256_file(p)
    except IngestRefusal as e:
        rep.refusals.extend(e.reasons)
        return rep
    except OSError as e:
        return _ref(rep, "FILE_UNREADABLE", f"cannot read the file: {type(e).__name__}")
    if head != b"DAF/SPK ":
        return _ref(rep, "NOT_SPK", "the file is not a NAIF SPK (DAF/SPK header missing)")
    if not (0.001 <= step_s <= 3600.0):
        return _ref(rep, "BAD_PARAMETER", "step_s must be between 0.001 and 3600 s")
    de440 = kernel_dir() / "de440.bsp"
    args = {"spk": str(p.resolve()), "de440": str(de440) if de440.exists() else None, "target": target,
            "step_s": float(step_s), "max_samples": int(max_samples)}
    env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"}
    binds = [*python_roots(), p.resolve(), *([de440] if de440.exists() else [])]
    res = run_limited([sys.executable, "-I", "-c", _SPK_SCRIPT, json.dumps(args)], ro_binds=binds, hide=hide_dirs,
                      cpu_s=60, mem_bytes=2 * 1024**3,
                      wall_s=120.0, max_output_bytes=64 * 1024 * 1024, env=env)
    if res.timed_out or res.signal_name or res.output_truncated:
        return _ref(rep, "SPK_READER_LIMIT", "reading the SPK exceeded its resource limits (time, CPU, memory or output)",
                    timed_out=res.timed_out, signal=res.signal_name, truncated=res.output_truncated)
    try:
        out = json.loads(res.stdout.decode("utf-8", "replace").strip().splitlines()[-1])
    except (ValueError, IndexError):
        return _ref(rep, "SPK_UNREADABLE", "the SPK reader produced no usable output", returncode=res.returncode,
                    stderr=res.stderr[-300:])
    if not out.get("ok"):
        err = out.get("error", "SPICE_ERROR")
        if err == "AMBIGUOUS_TARGET":
            return _ref(rep, "AMBIGUOUS_TARGET", f"the SPK holds bodies {out.get('ids')}; pass target=<NAIF id>", ids=out.get("ids"))
        if err == "TARGET_NOT_IN_SPK":
            return _ref(rep, "TARGET_NOT_IN_SPK", f"body {target} is not in the SPK (it holds {out.get('ids')})", ids=out.get("ids"))
        msg = str(out.get("message", ""))
        code = "SPK_CHAIN_UNRESOLVED" if "insufficient" in msg.lower() or "cannot be" in msg.lower() or "no loaded" in msg.lower() else "SPK_UNREADABLE"
        return _ref(rep, code, f"SPICE could not evaluate the SPK relative to the Moon: {msg[:200]}")
    try:
        samples = np.asarray(out["samples"], float)
        which = np.asarray(out["which"], int)
    except (KeyError, ValueError, TypeError):
        return _ref(rep, "SPK_UNREADABLE", "the SPK reader returned malformed data")
    if samples.ndim != 2 or samples.shape[1] != 7 or not np.all(np.isfinite(samples)):
        return _ref(rep, "SPK_UNREADABLE", "the SPK produced non-finite or malformed states")
    pos, vel = samples[:, 1:4], samples[:, 4:7]
    if not _plausible(rep, pos, vel, th):
        return rep
    pieces: list[_Piece] = []
    for k in np.unique(which):
        m = which == k
        et = samples[m, 0]
        if len(et) < th.min_samples:
            _warn(rep, "PIECE_DROPPED", f"coverage interval {int(k)} has only {len(et)} samples", n=len(et))
            continue
        pieces += _build_pieces(et, pos[m], vel[m], th, rep, f"coverage interval {int(k)}")
    if len(out["intervals"]) > 1:
        _warn(rep, "TRAJECTORY_GAPS", f"the SPK covers {len(out['intervals'])} separate intervals; nothing is interpolated between them",
              intervals=out["intervals"][:20])
    meta = {"naif_id": out["target"], "spk_ids": out.get("ids"), "resample_step_s": out["step_s"]}
    return _finish(rep, f"naif:{out['target']}", f"spk:{rep.name}", pieces, meta, th)


def trajectory_summary(traj: Trajectory) -> dict:
    """Plain-number description of a trajectory for the model context and the ledger."""
    r = np.concatenate([np.linalg.norm(p.pos, axis=1) for p in traj.pieces])
    steps = np.concatenate([np.diff(p.et) for p in traj.pieces])
    pieces = sorted(traj.pieces, key=lambda q: q.start)
    gaps = [(a.stop, b.start) for a, b in itertools.pairwise(pieces)]
    gaps = [(float(a), float(b)) for a, b in gaps]
    return {
        "source": traj.source, "name": traj.name, "n_samples": traj.n_samples, "n_pieces": len(traj.pieces),
        "start_utc": et_to_utc(traj.start), "stop_utc": et_to_utc(traj.stop), "start_et": traj.start, "stop_et": traj.stop,
        "span_s": traj.stop - traj.start,
        "step_s": {"min": float(steps.min()), "median": float(np.median(steps)), "max": float(steps.max())} if steps.size else None,
        "gaps": [[a, b] for a, b in gaps],
        "radius_km": {"min": float(r.min()), "max": float(r.max())},
        "altitude_km": {"min": float(r.min() - R_MOON_KM), "max": float(r.max() - R_MOON_KM)},
        "has_velocity": all(p.vel is not None for p in traj.pieces),
        "loo_error_km": traj.loo_error_km, "meta": traj.meta,
    }


def _geometry(pos_me: np.ndarray, site_vec: np.ndarray, basis: tuple[np.ndarray, np.ndarray, np.ndarray]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    d = pos_me - site_vec
    az, el = az_el_deg(d, *basis)
    return az, el, np.linalg.norm(d, axis=1)


def relay_contacts(traj: Trajectory, horizon: HorizonProfile, *, t0: float | None = None, t1: float | None = None,
                   step_s: float = 30.0, margin_deg: float = 0.0) -> RelayContacts:
    """Contact windows of the relay with the site of ``horizon`` over ``[t0, t1]`` (ET; default the trajectory span).

    The relay is in contact when its elevation exceeds the terrain horizon at its azimuth by ``margin_deg``
    (nominal horizon; optimistic/pessimistic brackets give the edge ranges). The observer is at the site's
    ground height plus mast. Time outside the trajectory's data (gaps, before/after) is *unknown* and counts as
    no contact; ``coverage_fraction`` says how much of the span is covered.
    """
    if step_s <= 0 or not math.isfinite(step_s):
        raise ValueError("step_s must be positive")
    t0 = traj.start if t0 is None else float(t0)
    t1 = traj.stop if t1 is None else float(t1)
    if not t1 > t0:
        raise ValueError("t1 must exceed t0")
    if (t1 - t0) / step_s > MAX_GRID_POINTS:
        raise ValueError(f"span/step gives more than {MAX_GRID_POINTS} grid points; raise step_s or shorten the span")
    load_kernels()
    site = horizon.site
    basis = local_basis(site.lat_deg, site.lon_deg)
    site_vec = (R_MOON_KM + (horizon.ground_height_m + site.mast_height_m) / 1000.0) * basis[2]
    grids = {b: horizon_grid(horizon, b) for b in ("nominal", "optimistic", "pessimistic")}

    def clearance_at(et: float) -> tuple[float, float, float, float]:
        pos, ok = traj.position_me(np.array([et]))
        if not ok[0]:
            return math.nan, math.nan, math.nan, math.nan
        az, el, rng = _geometry(pos, site_vec, basis)
        return float(point_clearance(az, el, grids["nominal"], margin_deg)[0]), float(el[0]), float(rng[0]), float(az[0])

    all_windows: list[Window] = []
    bounded: list = []
    covered = 0.0
    outages: list[tuple[float, float]] = []
    cursor = t0
    for piece in sorted(traj.pieces, key=lambda q: q.start):
        a, b = max(t0, piece.start), min(t1, piece.stop)
        if b <= a:
            continue
        if a > cursor:
            outages.append((cursor, a))
        cursor = max(cursor, b)
        n = math.floor((b - a) / step_s) + 1
        grid = a + np.arange(n) * step_s
        if b - grid[-1] > 1e-9:
            grid = np.append(grid, b)
        covered += b - a
        if grid.size < 2:
            continue
        pos, _ok = traj.position_me(grid)
        az, el, _ = _geometry(pos, site_vec, basis)
        sig = point_clearance_bounds(az, el, horizon, margin_deg)
        u = grid - grid[0]
        base = float(grid[0])

        def refine(x: float, base: float = base) -> float:
            return clearance_at(base + x)[0]

        for w in find_windows(u, sig.nominal, 0.0, method="hermite", refine=refine):
            all_windows.append(Window(w.start + base, w.end + base, w.start_censored, w.end_censored))
        for uw in bounded_windows(u, sig.nominal, sig.optimistic, sig.pessimistic, 0.0, method="hermite"):
            bounded.append((uw, base))
    if cursor < t1:
        outages.append((cursor, t1))
    all_windows.sort(key=lambda w: w.start)
    interp_err = traj.loo_error_km["max_km"] / 16.0
    passes: list[Pass] = []
    for w in all_windows:
        match = None
        for uw, base in bounded:
            if uw.nominal is not None and abs(uw.nominal.start + base - w.start) <= step_s and abs(uw.nominal.end + base - w.end) <= step_s:
                match = (uw, base)
                break
        if match:
            uw, base = match
            sr = (uw.start_range[0] + base, uw.start_range[1] + base)
            er = (uw.end_range[0] + base, uw.end_range[1] + base)
            certain = uw.certain
        else:
            sr, er, certain = (w.start, w.start), (w.end, w.end), False
        passes.append(_pass_metrics(w, sr, er, certain, clearance_at, step_s, interp_err))
    stats = window_stats(all_windows, t0, t1)
    longest_gap = stats.longest_dark
    gap_censored = stats.longest_dark_censored
    prov = horizon.provenance or {}
    horizon_used = {
        "site": {"lat_deg": site.lat_deg, "lon_deg": site.lon_deg, "mast_height_m": site.mast_height_m, "name": site.name},
        "ground_height_m": horizon.ground_height_m, "n_az": int(horizon.az_deg.size),
        "stack_hash": prov.get("stack_hash"), "nodes_without_data": prov.get("nodes_without_data"),
        "bounds_used": ["nominal", "optimistic", "pessimistic"],
    }
    return RelayContacts(
        t0=t0, t1=t1, passes=tuple(passes), n_passes=len(passes), total_contact_s=stats.total_visible,
        contact_fraction=stats.fraction_visible, longest_gap_s=longest_gap, longest_gap_censored=gap_censored,
        coverage_fraction=covered / (t1 - t0), outages=tuple(outages), step_s=step_s, margin_deg=margin_deg,
        interp_error_km_est=interp_err, horizon_used=horizon_used, caveats=CAVEATS,
    )


def _pass_metrics(w: Window, sr: tuple[float, float], er: tuple[float, float], certain: bool, clearance_at, step_s: float,
                  interp_err_km: float) -> Pass:
    n = max(3, math.ceil((w.end - w.start) / step_s) + 1)
    ts = np.linspace(w.start, w.end, n)
    vals = np.array([clearance_at(float(t)) for t in ts])
    clr, el, rng = vals[:, 0], vals[:, 1], vals[:, 3 - 1]
    k = int(np.nanargmax(el))
    lo, hi = ts[max(k - 1, 0)], ts[min(k + 1, n - 1)]
    best_t, best_el = float(ts[k]), float(el[k])
    if hi > lo:
        r = minimize_scalar(lambda t: -clearance_at(float(t))[1], bounds=(float(lo), float(hi)), method="bounded",
                            options={"xatol": 1e-3})
        if -r.fun >= best_el:
            best_t, best_el = float(r.x), float(-r.fun)
    kr = int(np.nanargmin(rng))
    lo, hi = ts[max(kr - 1, 0)], ts[min(kr + 1, n - 1)]
    min_r = float(rng[kr])
    if hi > lo:
        r = minimize_scalar(lambda t: clearance_at(float(t))[2], bounds=(float(lo), float(hi)), method="bounded",
                            options={"xatol": 1e-3})
        min_r = min(min_r, float(r.fun))

    def edge_err(t: float) -> float:
        h = min(step_s, 10.0)
        s = abs(clearance_at(t + h)[0] - clearance_at(t - h)[0]) / (2 * h)
        rg = clearance_at(t)[2]
        if not (s > 0 and math.isfinite(s) and math.isfinite(rg)):
            return math.nan
        return math.degrees(interp_err_km / rg) / s

    return Pass(
        start_et=w.start, end_et=w.end, start_censored=w.start_censored, end_censored=w.end_censored,
        start_range_et=sr, end_range_et=er, certain=certain, max_elevation_deg=best_el, max_elevation_et=best_t,
        peak_clearance_deg=float(np.nanmax(clr)), min_range_km=min_r, max_range_km=float(np.nanmax(rng)),
        start_err_s=edge_err(w.start) if not w.start_censored else 0.0,
        end_err_s=edge_err(w.end) if not w.end_censored else 0.0,
    )


__all__ = [
    "CALIBRATION", "CAVEATS", "MAX_OEM_ROWS", "Pass", "RelayContacts", "Trajectory", "TrajectoryReport",
    "TrajectoryThresholds", "load_oem", "load_spk", "relay_contacts", "trajectory_summary",
]
