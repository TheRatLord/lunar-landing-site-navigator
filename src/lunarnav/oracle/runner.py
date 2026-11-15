from __future__ import annotations

import importlib
import time
import traceback
from collections.abc import Callable, Sequence

from lunarnav.oracle.context import Context
from lunarnav.oracle.model import CHECKS, Case, NotRun, Outcome, Result, judge, load_cases

MODULES = ("closed_form", "ephemeris", "missions", "illumination", "literature", "imagery", "independent", "ranging", "terrain")


def load_checks() -> None:
    for name in MODULES:
        importlib.import_module(f"lunarnav.oracle.checks.{name}")


def run(
    only: Sequence[str] = (), quick: bool = False, progress: Callable[[str], None] | None = None
) -> list[Result]:
    load_checks()
    cases = load_cases()
    declared = {i for c in CHECKS for i in c.case_ids}
    orphans = sorted(set(cases) - declared)
    unknown = sorted(declared - set(cases))
    if orphans or unknown:
        raise RuntimeError(f"cases without a check: {orphans}; checks without a case: {unknown}")
    ctx = Context(quick=quick)
    results: dict[str, Result] = {}
    for chk in CHECKS:
        ids = [i for i in chk.case_ids if not only or any(i.startswith(p) for p in only)]
        if not ids:
            continue
        if progress:
            progress(f"{chk.name} ...")
        t0 = time.time()
        try:
            outcomes = chk.fn(ctx)
            failure = None
        except NotRun as exc:
            outcomes, failure = {}, ("not_run", str(exc))
        except Exception as exc:
            outcomes, failure = {}, ("error", f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=4)}")
        dt = time.time() - t0
        for i in chk.case_ids:
            results[i] = _result(cases[i], outcomes.get(i), failure, dt / len(chk.case_ids))
        if progress:
            progress(f"{chk.name}: " + ", ".join(f"{i}={results[i].status}" for i in chk.case_ids) + f" ({dt:.0f} s)")
    return [results[i] for i in cases if i in results]


def _result(case: Case, outcome: Outcome | None, failure: tuple[str, str] | None, seconds: float) -> Result:
    if failure:
        return Result(case, failure[0], detail=failure[1], seconds=seconds)
    if outcome is None:
        return Result(case, "error", detail="the check returned no outcome for this case", seconds=seconds)
    return Result(
        case, judge(case, outcome.value), outcome.value, outcome.detail, outcome.columns, outcome.rows, outcome.n, seconds
    )


def score(results: Sequence[Result]) -> dict:
    def tally(rs: Sequence[Result]) -> dict:
        gates = [r for r in rs if r.case.role == "gate"]
        ran = [r for r in gates if r.status in ("pass", "fail")]
        passed = sum(r.status == "pass" for r in ran)
        return {
            "gates": len(gates), "ran": len(ran), "passed": passed, "failed": len(ran) - passed,
            "not_run": sum(r.status == "not_run" for r in gates), "errors": sum(r.status == "error" for r in gates),
            "report_only": sum(r.case.role == "report" for r in rs),
            "score": None if not ran else passed / len(ran),
        }  # fmt: skip

    truth = [r for r in results if r.case.kind != "implementation"]
    families: dict[str, list[Result]] = {}
    for r in results:
        families.setdefault(r.case.family, []).append(r)
    return {
        "all": tally(results),
        "truth": tally(truth),
        "by_kind": {k: tally([r for r in results if r.case.kind == k]) for k in ("implementation", "computation", "observation")},
        "by_family": {f: tally(rs) for f, rs in families.items()},
    }
