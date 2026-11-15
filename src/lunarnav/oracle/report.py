from __future__ import annotations

from collections.abc import Sequence

from lunarnav.oracle.model import KIND_TEXT, Result, load_changes, load_not_built

STATUS_TEXT = {"pass": "pass", "fail": "FAIL", "info": "report only", "not_run": "not run", "error": "ERROR"}


def fmt(v: float | None) -> str:
    if v is None:
        return ""
    a = abs(v)
    if a == 0:
        return "0"
    if a >= 1000:
        return f"{v:.0f}"
    if a >= 100:
        return f"{v:.1f}"
    if a >= 1:
        return f"{v:.2f}"
    if a >= 0.01:
        return f"{v:.3f}"
    return f"{v:.2e}"


def cell(v) -> str:
    if isinstance(v, float):
        return fmt(v)
    return str(v).replace("|", "\\|").replace("\n", " ")


def pct(t: dict) -> str:
    return "n/a" if t["score"] is None else f"{100 * t['score']:.0f} %"


def tally_row(name: str, t: dict) -> str:
    return f"| {name} | {t['passed']} | {t['failed']} | {t['not_run'] + t['errors']} | {t['report_only']} | {pct(t)} |"


def markdown(results: Sequence[Result], sc: dict, meta: dict) -> str:
    out: list[str] = []
    w = out.append
    t, a = sc["truth"], sc["all"]
    w("# Oracle suite report")
    w("")
    w(f"Run {meta['when_utc']} on commit `{meta['commit']}`, terrain stack `{meta['stack_hash'][:12]}`, "
      f"kernels as pinned. Written by `lunarnav oracle run`. Do not edit by hand.")
    w("")
    w("## Score")
    w("")
    w(f"**Truth checks: {t['passed']} of {t['ran']} gates pass ({pct(t)}).** "
      f"Each of these gates compares the engine with a source outside it: an independent computation or a real observation.")
    w("")
    w(f"All gates, including the implementation checks: {a['passed']} of {a['ran']} pass ({pct(a)}).")
    if a["not_run"] or a["errors"]:
        w("")
        w(f"{a['not_run']} gates did not run because their reference data is missing, and {a['errors']} ended in an error. "
          "The score does not count them. They are listed below.")
    w("")
    w("A gate is one source and one quantity, held to a tolerance. Each limit is written down before the engine is run on "
      "its case. A limit or rule changed afterwards is listed under \"Changed after a first run\" with the data behind the "
      "change, and that data never comes from the engine. A miss against a sound reference stays in the score as a "
      "failure. Report-only rows have no pass or fail, because their reference cannot carry a tolerance.")
    w("")
    changes = load_changes()
    demoted = [c for c in changes if c.get("was_gate")]
    eased = {c["case"] for c in changes if c.get("strict_fail")}
    lost = sum(1 for r in results if r.case.id in eased and r.status == "pass" and r.case.kind != "implementation")
    if demoted or lost:
        n = t["ran"] + len(demoted)
        w(f"Strict count: {t['passed'] - lost} of {n} ({100.0 * (t['passed'] - lost) / n:.0f} %). This count also treats as failures the "
          f"{len(demoted)} truth cases that were gates at their first run and are report-only now, and the {lost} that pass only "
          "because their limit or rule was changed after a first run. Both groups are listed under \"Changed after a first run\".")
        w("")
    w("| Class | Pass | Fail | Not run | Report only | Score |")
    w("|---|---|---|---|---|---|")
    for k in ("observation", "computation", "implementation"):
        w(tally_row(KIND_TEXT[k].capitalize(), sc["by_kind"][k]))
    w("")
    w("| Engine quantity | Pass | Fail | Not run | Report only | Score |")
    w("|---|---|---|---|---|---|")
    for f, tl in sc["by_family"].items():
        w(tally_row(f, tl))
    w("")
    fails = [r for r in results if r.status == "fail"]
    if fails:
        w("## Failing gates")
        w("")
        w("| Case | Source | Result | Limit | Unit |")
        w("|---|---|---|---|---|")
        for r in fails:
            c = r.case
            sign = "≤" if c.sense == "at_most" else "≥"
            w(f"| `{c.id}` | {cell(c.source)} | {fmt(r.value)} | {sign} {fmt(c.limit)} | {c.unit} |")
        w("")
    w("## Every case")
    w("")
    family = None
    for r in results:
        c = r.case
        if c.family != family:
            family = c.family
            w(f"### {family}")
            w("")
            w("| Case | Source | Class | Metric | Result | Limit | Unit | Status |")
            w("|---|---|---|---|---|---|---|---|")
        sign = "" if c.limit is None else ("≤ " if c.sense == "at_most" else "≥ ")
        n = "" if r.n is None else f" (n = {r.n})"
        src = f"[{cell(c.source)}]({c.url})" if c.url else cell(c.source)
        w(f"| `{c.id}` | {src} | {c.kind} | {cell(c.metric)}{n} | {fmt(r.value)} | {sign}{fmt(c.limit)} | {c.unit} | "
          f"{STATUS_TEXT[r.status]} |")
        nxt = results[results.index(r) + 1] if results.index(r) + 1 < len(results) else None
        if nxt is None or nxt.case.family != family:
            w("")
    w("## Tolerances and where they come from")
    w("")
    w("| Case | Basis of the tolerance |")
    w("|---|---|")
    for r in results:
        w(f"| `{r.case.id}` | {cell(r.case.basis)} |")
    w("")
    w("## Details")
    w("")
    for r in results:
        if not (r.detail or r.rows):
            continue
        w(f"### `{r.case.id}`")
        w("")
        if r.detail:
            w(r.detail.strip())
            w("")
        if r.rows:
            w("| " + " | ".join(r.columns) + " |")
            w("|" + "---|" * len(r.columns))
            for row in r.rows:
                w("| " + " | ".join(cell(v) for v in row) + " |")
            w("")
    if changes:
        w("## Changed after a first run")
        w("")
        w("Every change made to a case after the engine had been run on it. \"Strict\" marks the cases that the strict "
          "count treats as failures.")
        w("")
        w("| Case | What changed | Why, and the data behind it | Strict |")
        w("|---|---|---|---|")
        for c in changes:
            strict = "fail" if c.get("was_gate") or c.get("strict_fail") else ""
            w(f"| `{c['case']}` | {cell(c['change'])} | {cell(c['why'])} | {strict} |")
        w("")
    nb = load_not_built()
    if nb:
        w("## Sources not in the suite")
        w("")
        w("| Source | Quantity | Why it is not built |")
        w("|---|---|---|")
        for item in nb:
            w(f"| {cell(item['source'])} | {cell(item['quantity'])} | {cell(item['reason'])} |")
        w("")
    return "\n".join(out)


def console(results: Sequence[Result], sc: dict) -> str:
    lines = []
    for r in results:
        c = r.case
        lim = "" if c.limit is None else f" (limit {fmt(c.limit)} {c.unit})"
        val = "" if r.value is None else f" {fmt(r.value)} {c.unit}"
        lines.append(f"{STATUS_TEXT[r.status]:12} {c.id:44}{val}{lim}")
        if r.status in ("error", "not_run"):
            lines.append(f"             {r.detail.splitlines()[0] if r.detail else ''}")
    t, a = sc["truth"], sc["all"]
    lines.append("")
    lines.append(f"truth checks: {t['passed']} of {t['ran']} gates pass ({pct(t)})")
    lines.append(f"all gates:    {a['passed']} of {a['ran']} ({pct(a)}); not run {a['not_run']}, errors {a['errors']}")
    return "\n".join(lines)
