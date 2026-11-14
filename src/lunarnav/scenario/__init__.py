"""Scenario layer: planner answers from the validated engine modules.

Typical use::

    from lunarnav.scenario import scenario_from_catalog, evaluate_scenario, scan_opportunities, slip_analysis

    sc = scenario_from_catalog("blue-ghost-m1", "blue-ghost", mission_duration_h=336)
    ev = evaluate_scenario(sc)                      # one landing epoch: verdict, metrics, intervals, series
    scan = scan_opportunities(sc, start_utc=..., end_utc=...)   # every candidate landing epoch
    slips = slip_analysis(sc, slips_h=[0, 24, 48])  # what still works if the landing moves

Numbers come only from `lunarnav.ephem`, `lunarnav.visibility` and a horizon provider; see
`docs/validation/scenario.md`.
"""

from .attribution import attribute_event
from .compare import compare_scenarios
from .ellipse import ellipse_statistics
from .evaluate import EVENT_KINDS, SiteEvaluation, evaluate_scenario
from .export import (
    export_evaluation,
    minmax_indices,
    read_scenario_json,
    write_aem,
    write_calendar_csv,
    write_comparison_csv,
    write_intervals_csv,
    write_metrics_csv,
    write_opportunities_csv,
    write_scenario_json,
    write_slip_csv,
    write_timeseries_csv,
    write_timeseries_json,
)
from .horizons import HorizonProvider, SmoothSphereProvider, TerrainProvider
from .models import SCHEMA_VERSION, Constraints, Ellipse, Limit, Network, Scenario, SiteSpec, Transfer
from .opportunities import scan_opportunities
from .profiles import (
    constraints_preset,
    generic_layouts,
    generic_profile,
    merge_constraints,
    network_from_catalog,
    profile_from_catalog,
    scenario_from_catalog,
)
from .provenance import canonical_scenario_json, scenario_hash
from .search import SearchRegion, search_sites
from .sensitivity import height_sensitivity, position_sensitivity
from .slip import rank_sites, slip_analysis
from .verdicts import describe_constraint

__all__ = [
    "Constraints",
    "EVENT_KINDS",
    "Ellipse",
    "HorizonProvider",
    "Limit",
    "Network",
    "SCHEMA_VERSION",
    "Scenario",
    "SearchRegion",
    "SiteEvaluation",
    "SiteSpec",
    "SmoothSphereProvider",
    "TerrainProvider",
    "Transfer",
    "attribute_event",
    "canonical_scenario_json",
    "compare_scenarios",
    "constraints_preset",
    "describe_constraint",
    "ellipse_statistics",
    "evaluate_scenario",
    "export_evaluation",
    "generic_layouts",
    "generic_profile",
    "height_sensitivity",
    "merge_constraints",
    "minmax_indices",
    "network_from_catalog",
    "position_sensitivity",
    "profile_from_catalog",
    "rank_sites",
    "read_scenario_json",
    "scan_opportunities",
    "scenario_from_catalog",
    "scenario_hash",
    "search_sites",
    "slip_analysis",
    "write_aem",
    "write_calendar_csv",
    "write_comparison_csv",
    "write_intervals_csv",
    "write_metrics_csv",
    "write_opportunities_csv",
    "write_scenario_json",
    "write_slip_csv",
    "write_timeseries_csv",
    "write_timeseries_json",
]
