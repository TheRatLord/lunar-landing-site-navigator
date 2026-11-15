from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).parent
REFERENCE = HERE / "reference"
KINDS = ("implementation", "computation", "observation")
KIND_TEXT = {
    "implementation": "implementation check (closed form, same-ephemeris cross-check or brute force)",
    "computation": "independent computation (different ephemeris, terrain or code)",
    "observation": "real observation",
}


@dataclass(frozen=True)
class Case:
    id: str
    family: str
    quantity: str
    source: str
    url: str
    kind: str
    role: str
    metric: str
    limit: float | None
    unit: str
    sense: str
    basis: str


@dataclass
class Outcome:
    value: float | None
    detail: str = ""
    columns: tuple[str, ...] = ()
    rows: list[tuple] = field(default_factory=list)
    n: int | None = None


@dataclass
class Result:
    case: Case
    status: str
    value: float | None = None
    detail: str = ""
    columns: tuple[str, ...] = ()
    rows: list[tuple] = field(default_factory=list)
    n: int | None = None
    seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        c = self.case
        return {
            "id": c.id, "family": c.family, "quantity": c.quantity, "source": c.source, "url": c.url, "kind": c.kind,
            "role": c.role, "metric": c.metric, "limit": c.limit, "unit": c.unit, "sense": c.sense, "basis": c.basis,
            "status": self.status, "value": self.value, "detail": self.detail, "n": self.n,
            "columns": list(self.columns), "rows": [list(r) for r in self.rows], "seconds": round(self.seconds, 2),
        }  # fmt: skip


class NotRun(Exception):
    pass


@dataclass(frozen=True)
class Check:
    name: str
    case_ids: tuple[str, ...]
    fn: Callable[[Any], dict[str, Outcome]]


CHECKS: list[Check] = []


def check(*case_ids: str) -> Callable:
    def register(fn: Callable) -> Callable:
        CHECKS.append(Check(f"{fn.__module__.rsplit('.', 1)[-1]}.{fn.__name__}", tuple(case_ids), fn))
        return fn

    return register


def load_cases() -> dict[str, Case]:
    doc = yaml.safe_load((HERE / "cases.yaml").read_text(encoding="utf-8"))
    out: dict[str, Case] = {}
    for family in doc["families"]:
        for c in family["cases"]:
            case = Case(
                id=c["id"], family=family["name"], quantity=c["quantity"], source=c["source"], url=c.get("url", ""),
                kind=c["kind"], role=c.get("role", "gate"), metric=c["metric"],
                limit=None if c.get("limit") is None else float(c["limit"]), unit=c.get("unit", ""),
                sense=c.get("sense", "at_most"), basis=c["basis"],
            )  # fmt: skip
            if case.kind not in KINDS or case.role not in ("gate", "report") or case.sense not in ("at_most", "at_least"):
                raise ValueError(f"case {case.id}: bad kind, role or sense")
            if case.role == "gate" and case.limit is None:
                raise ValueError(f"case {case.id}: a gate needs a limit")
            if case.id in out:
                raise ValueError(f"duplicate case id {case.id}")
            out[case.id] = case
    return out


def load_not_built() -> list[dict[str, str]]:
    return yaml.safe_load((HERE / "cases.yaml").read_text(encoding="utf-8")).get("not_built", [])


def load_changes() -> list[dict]:
    return yaml.safe_load((HERE / "cases.yaml").read_text(encoding="utf-8")).get("changed_after_first_run", [])


def judge(case: Case, value: float | None) -> str:
    if value is None or value != value:
        return "error"
    if case.role == "report":
        return "info"
    ok = value <= case.limit if case.sense == "at_most" else value >= case.limit
    return "pass" if ok else "fail"
