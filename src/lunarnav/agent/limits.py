"""Explicit model limits, drawn from the validation reports, and the requests the agent must decline.

The limits of an engine result are not listed here: `lunarnav.report.limits` is the only registry of them, and each
tool attaches the notes the report's helper returns for the engine objects it computed. This module keeps only the
limits about the harness's own conduct (values the model typed, constraints it
read from a document, a user DEM, a relay, the workspace quota, the candidate spacing a scan call chose). The harness
attaches the text of every limit carried by the results an answer cites to the final answer (`guard.analyze_answer`),
verbatim and with the ids that carry it: the model's wording is not what keeps a caveat with a number.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ModelLimit:
    """One stated limitation of the models behind a result."""

    id: str
    text: str
    source: str


LIMITS: dict[str, ModelLimit] = {m.id: m for m in (
    ModelLimit(
        "harness.workspace_quota",
        "The run's workspace may hold at most 4 GiB by default (AgentConfig.max_workspace_bytes) and no process may write a "
        "single file larger than 512 MiB by default (RLIMIT_FSIZE). A Bash call is refused while the workspace is over the "
        "quota, and a call that leaves it over ends the turn with a quota error; results that needed the missing "
        "output do not exist.",
        "src/lunarnav/agent/config.py"),
    ModelLimit(
        "user_dem.unvalidated",
        "The user-supplied terrain model is unverified against ground truth; it overlays the stock terrain for "
        "this run only, is accepted only after the overlap check, and every result that uses it depends on the "
        "assumption that it is correct.",
        "src/lunarnav/agent/ingest/terrain_dem.py"),
    ModelLimit(
        "relay.geometric",
        "Relay contact is geometric (spacecraft above the terrain horizon of the antenna, from the supplied "
        "trajectory): no link budget, no spacecraft attitude or antenna pointing, no Earth or Sun constraint; "
        "its accuracy is that of the supplied trajectory file.",
        "src/lunarnav/agent/ingest/trajectory.py"),
    ModelLimit(
        "constraints.interpreted",
        "Constraint limits taken from a document are the model's reading of the text, each with its quoted "
        "sentence; ambiguous ones are not applied until a planner signs off.",
        "src/lunarnav/agent/ingest/constraints_doc.py"),
    ModelLimit(
        "scenario.typed",
        "Values the model entered in this run that change what the engine computes (a limit, a lander parameter, a "
        "mission length, a landing time, a hazard threshold, a terrain option); none is a preset or a reviewed proposal. "
        "Each is listed below with the value it replaced and the text of the request around it when the request contains "
        "the number, which is evidence only: a number that appears in the request does not show that the planner "
        "meant this parameter. They are one pending assumption to confirm or correct.",
        "src/lunarnav/agent/typed_inputs.py"),
    ModelLimit(
        "scan.candidate_spacing",
        "The scan sampled candidate landings at the spacing the assistant chose, so a window edge is quantised to that "
        "spacing: the true edge lies within one spacing beyond it. This is a choice of the call, not a property of the "
        "engine's models (the signal step of the engine's own interpolation is the report's `scan.step`).",
        "src/lunarnav/agent/engine_tools/analysis.py"),
)}


UNSUPPORTED = (
    ("probability of landing success, landing hazard or safety assessment, or any risk or confidence number "
    "(the engine is deterministic geometry, not a hazard or reliability model)"),
    "regolith bearing capacity, trafficability, dust, plume-surface interaction or boulder distribution",
    "thermal survival temperatures, radiation dose, or lander structural limits",
    "trajectory design (delta-v, transfer optimisation), launch-vehicle performance or flight-rule decisions",
    ("any decision that a site is 'safe', 'approved' or 'go' (the engine reports geometry and margins; the "
    "decision belongs to the mission authority)"),
)
"""Request classes the agent must decline or escalate, with the reason and what it can offer instead."""


def limit_text(limit_id: str, notes: Sequence[str] = ()) -> str:
    """The text of a limit with the lines a result adds under it (one per line): the values the model typed, or the
    scenario's own k-sigma where the text quotes the default."""
    return "\n".join([LIMITS[limit_id].text, *(f"- {n}" for n in notes)]) if limit_id in LIMITS else limit_id


def limit_title(limit_id: str) -> str:
    """One line for a harness limit: its first sentence."""
    text = LIMITS[limit_id].text if limit_id in LIMITS else limit_id
    first = text.split(". ")[0].rstrip(".")
    return first if len(first) <= 110 else first[:107].rstrip() + "..."
