"""The service's stored scenarios as the Analyst's read-only `ScenarioSource` (`lunarnav.agent.saved_scenarios`)."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from lunarnav.api.docstore import DocumentStore, NotFound
from lunarnav.scenario.models import Scenario
from lunarnav.scenario.provenance import scenario_hash

KIND = "scenario"


def _engine_hash(body: dict[str, Any]) -> str | None:
    try:
        return scenario_hash(Scenario.model_validate(body))
    except ValidationError:
        return None


class StoredScenarios:
    """Lists and loads the document store's scenarios; never writes. Synchronous: the harness calls it on a worker thread."""

    def __init__(self, docs: DocumentStore) -> None:
        self._docs = docs

    def list(self, limit: int) -> list[dict[str, Any]]:
        """At most `limit` scenarios, most recently updated first, with the fields the agent lists. `scenario_sha256` is the
        engine's hash of the document (`lunarnav.scenario.provenance.scenario_hash`): the one every analysis, export and
        report of that scenario states, so a listing and a result can be compared. None for a document the engine cannot read."""
        items, _ = self._docs.search(KIND, None, limit, 0)
        rows = []
        for item in items:
            try:
                body = self._docs.get(item.id).body
            except NotFound:
                continue
            site = body.get("site") if isinstance(body.get("site"), dict) else {}
            rows.append({
                "scenario_id": item.id, "name": item.name, "site": {"lat_deg": site.get("lat_deg"), "lon_deg": site.get("lon_deg")},
                "landing_utc": body.get("landing_utc"), "scenario_sha256": _engine_hash(body),
                "updated_utc": item.updated_utc})
        return rows

    def load(self, scenario_id: str) -> dict[str, Any] | None:
        """The stored document, or None for an id that is not a scenario."""
        try:
            record = self._docs.get(scenario_id)
        except NotFound:
            return None
        return record.body if record.kind == KIND else None
