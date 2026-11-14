"""Which regional layers may be read as point values, this run's measured error and the validated bracket coverage.

``point_value`` is one of

* ``supported``: the value is an estimate whose measured error is small; the ``_lo``/``_hi`` layers are an estimated bracket;
* ``approximate``: typical error is small but the tail is not; read the bracket for anything that matters;
* ``bracket_only``: single cells can be off by days to months because a run length changes when one gap opens or closes;
  the point value must not be shown alone, only the range ``[<name>_lo, <name>_hi]``.  A point value that can be relied on comes from the
  site search, which evaluates the candidate with the exact engine;
* ``exact_input``: not an estimate of a modelled quantity (terrain derivative, flags);
* ``bracket``: the layer is itself the low or high end of the bracket of another layer (``bracket_of``).

The ``_lo``/``_hi`` brackets are **estimates, not bounds**: the regional horizon is shifted by the pooled 0.99 / 0.01 quantile of the measured
horizon error, and a cell with one azimuth far outside that quantile can fall outside its bracket.

Every record carries two separate measurements, never mixed:

* ``run_measured_error`` / ``run_measured_on``: the regional-minus-exact error of this layer on the calibration cells of **this run**
  (``compute_layers(calibrate=N)``), with the configuration of the run.  ``None`` when the run did not calibrate.
* ``validation``: the error and the bracket coverage measured by ``validation/illumination_defaults.py`` on 960 independent cells, with the
  configuration it was measured at (``validation_reference.json``, ``docs/validation/illumination.md`` section 7) and ``applies_to_run``
  (whether this run uses that configuration).

Units: ``unit`` is the unit of the layer values (fractions are 0 to 1); ``error_unit`` the unit of the error figures (percentage points for fractions).
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

BRACKET_SUFFIXES = ("_lo", "_hi")
REFERENCE_FILE = Path(__file__).with_name("validation_reference.json")
"""Written by ``validation/illumination_defaults.py`` (not edited by hand)."""

HORIZON_SHIFT_LOWERED = "lowered"
HORIZON_SHIFT_RAISED = "raised"

LAYER_SUPPORT: dict[str, dict[str, Any]] = {
    "average_illumination": {"point_value": "supported", "bracket_low_horizon": "raised", "unit": "fraction (0-1)", "error_unit": "percentage points"},
    "sun_mean_flux": {"point_value": "supported", "bracket_low_horizon": "raised", "unit": "fraction (0-1)", "error_unit": "percentage points"},
    "sunlit_fraction": {"point_value": "supported", "bracket_low_horizon": "raised", "unit": "fraction (0-1)", "error_unit": "percentage points"},
    "earth_fraction": {"point_value": "approximate", "bracket_low_horizon": "raised", "unit": "fraction (0-1)", "error_unit": "percentage points"},
    "longest_sunlit_h": {"point_value": "approximate", "bracket_low_horizon": "raised", "unit": "hours", "error_unit": "hours"},
    "longest_shadow_h": {"point_value": "bracket_only", "bracket_low_horizon": "lowered", "unit": "hours", "error_unit": "hours"},
    "longest_earth_outage_h": {"point_value": "bracket_only", "bracket_low_horizon": "lowered", "unit": "hours", "error_unit": "hours"},
    "slope_deg": {"point_value": "exact_input", "unit": "degrees", "error_unit": None},
    "ground_height_m": {"point_value": "exact_input", "unit": "metres", "error_unit": None},
    "censoring_flags": {"point_value": "exact_input", "unit": "bit flags (see header conventions)", "error_unit": None},
}

_OPPOSITE = {HORIZON_SHIFT_LOWERED: HORIZON_SHIFT_RAISED, HORIZON_SHIFT_RAISED: HORIZON_SHIFT_LOWERED}


@cache
def reference() -> dict[str, Any] | None:
    """The validation record shipped with the package, or ``None`` if the file is absent."""
    try:
        return json.loads(REFERENCE_FILE.read_text())
    except OSError:
        return None


def _describe(cfg: dict[str, Any]) -> str:
    stores = cfg.get("dem_ids")
    return (f"mast {cfg['mast_height_m']:g} m, sun {cfg['sun_rule']}, Earth {cfg['earth_rule']}, {cfg['n_az']} azimuths, step {cfg['step_s']:g} s, "
            f"{cfg['start_utc']} to {cfg['stop_utc']}, {cfg['calibration_cells']} calibration cells (seed {cfg['calibration_seed']}), "
            f"stores {','.join(stores) if stores else 'all'}")


def _applies(ref_cfg: dict[str, Any], run_cfg: dict[str, Any] | None) -> bool | None:
    """Whether the run uses the validated configuration (``None`` when the run configuration is not known)."""
    if run_cfg is None:
        return None
    same = all(run_cfg.get(k) == ref_cfg.get(k) for k in ("mast_height_m", "sun_rule", "earth_rule", "n_az", "step_s", "dem_ids"))
    return bool(same and run_cfg.get("calibration_cells", 0) >= ref_cfg["calibration_cells"])


def _validation(base_name: str, run_cfg: dict[str, Any] | None) -> dict[str, Any] | None:
    ref = reference()
    if ref is None or base_name not in ref["layers"]:
        return None
    lay = ref["layers"][base_name]
    return {"configuration": _describe(ref["configuration"]), "applies_to_run": _applies(ref["configuration"], run_cfg),
            "bracket_coverage": lay["bracket_coverage"], "measured_error": lay["measured_error"], "measured_by": ref["measured_by"]}


_NOTES = {
    "supported": ("Point value usable within the measured error; the _lo/_hi layers are an estimated bracket of the exact value, not a guaranteed bound "
                  "(validation.bracket_coverage). Cells with censoring_flags bit 3 are near a boundary between terrain products: not reliable."),
    "approximate": "Typical error small, tail large: show the estimated bracket [lo, hi] beside the value; the bracket can miss (validation.bracket_coverage).",
    "bracket_only": ("Do not show the point value alone: a single cell can differ from the exact value by days to months. Show the estimated bracket "
                     "[lo, hi]; it can miss the exact value (validation.bracket_coverage) and is not a guaranteed bound. "
                     "Point values come from the site search (exact engine)."),
    "exact_input": "Not an estimate of a modelled quantity.",
}


def layer_support(name: str, run: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Support record of a layer, or ``None`` for an unknown name.  ``<name>_lo`` / ``<name>_hi`` return the bracket role of ``<name>``.

    ``run``: the calibration of this run (``calibrate_horizon_error``: ``layer_errors`` and ``configuration``); without it
    ``run_measured_error`` is ``None`` and ``validation.applies_to_run`` is ``None``."""
    run_cfg = run["configuration"] if run else None
    if name in LAYER_SUPPORT:
        base = LAYER_SUPPORT[name]
        pv = base["point_value"]
        bracketed = pv in ("supported", "approximate", "bracket_only")
        err = run["layer_errors"].get(name) if run else None
        low = base.get("bracket_low_horizon")
        return {
            **base, "bracket_low_horizon": low, "bracket_high_horizon": _OPPOSITE.get(low),
            "bracket_layers": [name + s for s in BRACKET_SUFFIXES] if bracketed else [],
            "role": "estimate" if pv != "exact_input" else "input", "note": _NOTES[pv],
            "run_measured_error": {k: v for k, v in err.items() if k != "unit"} if err else None,
            "run_measured_on": _describe(run_cfg) if err else None,
            "validation": _validation(name, run_cfg) if bracketed else None,
        }
    for s in BRACKET_SUFFIXES:
        if name.endswith(s) and name[: -len(s)] in LAYER_SUPPORT:
            base_name = name[: -len(s)]
            low = LAYER_SUPPORT[base_name].get("bracket_low_horizon")
            return {"point_value": "bracket", "horizon_shift": low if s == "_lo" else _OPPOSITE.get(low), "role": "bracket low" if s == "_lo" else "bracket high", "bracket_of": base_name,
                    "unit": LAYER_SUPPORT[base_name]["unit"], "error_unit": LAYER_SUPPORT[base_name]["error_unit"], "bracket_layers": [],
                    "run_measured_error": None, "run_measured_on": None, "validation": _validation(base_name, run_cfg),
                    "note": ("Estimated bracket of the exact value, set by the pooled 0.99 / 0.01 quantile of this run's measured horizon error. "
                             "It can miss and is not a guaranteed bound (validation.bracket_coverage).")}
    return None


def support_table(names, run: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    """Support records for the given layer names (those without a record are omitted)."""
    return {n: s for n in names if (s := layer_support(n, run)) is not None}
