import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublishScreenContext } from "../../ask/screenContext";
import { Link, useSearchParams } from "react-router-dom";
import { evidenceApi } from "../../api/endpoints";
import { useLoad } from "../../api/useLoad";
import type { EvidenceDoc } from "../../api/types";
import { Markdown } from "../../components/content/Markdown";
import { Button } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon, type IconName } from "../../components/ui/Icon";
import { evidenceHref, resolveSection } from "../../lib/evidence";
import { extractToc, resolveRelative, type TocEntry } from "../../lib/markdown";
import { toast } from "../../state/toasts";
import { Chip, type ChipTone } from "../analyst/Chip";
import { CHECKS, DOC_TITLES, NOT_VALIDATED, type CheckStatus } from "./glance";
import { LoadState, MetaView } from "./MetaView";

const MARK_MS = 3000;
const ACTIVE_OFFSET = 24;

const docTitle = (d: EvidenceDoc) => DOC_TITLES[d.id] ?? d.title.replaceAll("`", "");

const STATUS: Record<CheckStatus, { tone: ChipTone; icon?: IconName }> = {
  Met: { tone: "pass", icon: "check" },
  Missed: { tone: "fail", icon: "cross" },
  Mixed: { tone: "marginal", icon: "warn" },
  Measured: { tone: "default" },
};

function useActiveHeading(scroller: HTMLElement | null, toc: readonly TocEntry[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!scroller || toc.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top + ACTIVE_OFFSET;
      let current: string | null = null;
      for (const t of toc) {
        const el = document.getElementById(t.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= top) current = t.id;
        else break;
      }
      if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = toc[toc.length - 1]!.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scroller, toc]);
  return scroller && toc.some((t) => t.id === active) ? active : null;
}

function DocView({ doc, docs, section }: { doc: EvidenceDoc; docs: EvidenceDoc[]; section: string | null }) {
  const docId = doc.id;
  const { state, reload } = useLoad(useCallback((signal: AbortSignal) => evidenceApi.doc(docId, { signal }), [docId]));
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const docPath = doc.path;
  const resolveImage = useCallback(
    (src: string) => {
      const rel = resolveRelative(docPath, src);
      return rel === null ? src : evidenceApi.assetUrl(rel);
    },
    [docPath],
  );
  const resolveLink = useCallback(
    (href: string) => {
      const rel = resolveRelative(docPath, href);
      if (rel === null) return undefined;
      const target = docs.find((d) => d.path === rel);
      return target ? `?doc=${encodeURIComponent(target.id)}` : evidenceApi.assetUrl(rel);
    },
    [docPath, docs],
  );
  const fullToc = useMemo(() => (state.status === "ready" ? extractToc(state.data) : []), [state]);
  const toc = useMemo(() => fullToc.filter((t) => t.level >= 2 && t.level <= 3), [fullToc]);
  const target = useMemo(() => {
    if (!section || state.status !== "ready") return null;
    return resolveSection(section, fullToc) ?? ("missing" as const);
  }, [section, state, fullToc]);
  const active = useActiveHeading(scroller, toc);
  const current = toc.find((t) => t.id === active)?.text ?? null;

  useEffect(() => {
    if (!target || target === "missing") return;
    const el = document.getElementById(target.id);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.classList.add("evi-mark");
    const t = window.setTimeout(() => el.classList.remove("evi-mark"), MARK_MS);
    return () => {
      window.clearTimeout(t);
      el.classList.remove("evi-mark");
    };
  }, [target, state]);

  const copyLink = () => {
    const url = window.location.origin + evidenceHref(doc.id, current);
    navigator.clipboard.writeText(url).then(
      () => toast({ kind: "success", title: "Link copied" }, 1500),
      () => toast({ kind: "error", title: "Could not copy the link" }),
    );
  };

  if (state.status !== "ready") return <LoadState state={state} loading={`Loading ${docTitle(doc)}`} what={docTitle(doc)} onRetry={reload} />;

  return (
    <div className="evi-doc" ref={setScroller}>
      <article className="evi-article" aria-label={docTitle(doc)}>
        {target === "missing" && (
          <p className="evi-miss" role="status">
            <Chip tone="marginal" icon="warn">
              Section not found
            </Chip>
            <span className="evi-miss-name">{section}</span>
          </p>
        )}
        <Markdown source={state.data} resolveImage={resolveImage} resolveLink={resolveLink} />
      </article>
      <aside className="evi-aside">
        <Button size="sm" variant="ghost" icon="link" onClick={copyLink} title={current ? `Copy a link to "${current}"` : undefined}>
          {current ? "Copy section link" : "Copy link"}
        </Button>
        {toc.length > 1 && (
          <nav className="evi-toc" aria-label="On this page">
            <ul>
              {toc.map((t) => (
                <li key={t.id} className={t.level === 3 ? "evi-toc-sub" : undefined}>
                  <a
                    href={`#${t.id}`}
                    className={t.id === active ? "is-active" : undefined}
                    aria-current={t.id === active ? "location" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(t.id)?.scrollIntoView({ block: "start", behavior: "smooth" });
                    }}
                  >
                    {t.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
    </div>
  );
}

function DocList({ docs, selected, onOpen }: { docs: EvidenceDoc[]; selected: string | null; onOpen: (id: string | null) => void }) {
  return (
    <nav className="evi-list" aria-label="Documents">
      <button type="button" className="evi-item" aria-current={selected === null ? "page" : undefined} onClick={() => onOpen(null)}>
        At a glance
      </button>
      {[...Map.groupBy(docs, (d) => d.kind)].map(([kind, group]) => (
        <section key={kind} className="evi-group" aria-labelledby={`evi-group-${kind}`}>
          <h2 id={`evi-group-${kind}`} className="evi-group-title">
            {kind === "validation" ? "Validation" : "Research"}
          </h2>
          <ul>
            {group.map((d) => (
              <li key={d.id}>
                <button type="button" className="evi-item" aria-current={d.id === selected ? "page" : undefined} onClick={() => onOpen(d.id)}>
                  {docTitle(d)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

const COUNTS = (["Met", "Missed", "Mixed", "Measured"] as const).map((s) => [s, CHECKS.filter((c) => c.status === s).length] as const).filter(([, n]) => n > 0);

function Glance() {
  return (
    <div className="evi-glance-scroll">
      <div className="evi-glance">
        <header className="evi-glance-head">
          <h1>At a glance</h1>
          <ul className="evi-leads">
            {CHECKS.flatMap((c) =>
              c.lead
                ? [
                    <li key={c.check}>
                      <Link className="evi-lead" to={evidenceHref(c.doc, c.section)}>
                        <strong className="num">{c.lead.value}</strong>
                        <span>{c.lead.label}</span>
                      </Link>
                    </li>,
                  ]
                : [],
            )}
          </ul>
          <p className="evi-glance-sum">
            {CHECKS.length} checks against independent references, each published with its result, misses included:{" "}
            {COUNTS.map(([s, n], i) => (
              <span key={s}>
                {i > 0 && ", "}
                {n} {s.toLowerCase()}
              </span>
            ))}
            .
          </p>
        </header>
        <div className="evi-checks-wrap">
          <table className="evi-checks">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Reference</th>
                <th scope="col">Result</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {CHECKS.map((c) => (
                <tr key={c.check}>
                  <th scope="row">
                    <Link className="evi-check-name" to={evidenceHref(c.doc, c.section)}>
                      {c.check}
                      <Icon name="chevronRight" size={12} />
                    </Link>
                  </th>
                  <td className="evi-check-ref">{c.reference}</td>
                  <td className="evi-check-result">{c.result}</td>
                  <td className="evi-check-status">
                    <Chip tone={STATUS[c.status].tone} icon={STATUS[c.status].icon}>
                      {c.status}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="evi-glance-not">
          <b>Not validated:</b> {NOT_VALIDATED.text} <Link to={evidenceHref(NOT_VALIDATED.doc, NOT_VALIDATED.section)}>Details</Link>
        </p>
        <div className="evi-glance-versions">
          <Disclosure title="Data versions">
            <MetaView />
          </Disclosure>
        </div>
      </div>
    </div>
  );
}

const loadList = (signal: AbortSignal) => evidenceApi.list({ signal });

export function EvidenceWorkspace() {
  const [params, setParams] = useSearchParams();
  const { state: list, reload } = useLoad(loadList);

  const docs = list.status === "ready" ? list.data : [];
  const docId = params.get("doc");
  const selected = docId ? docs.find((d) => d.id === docId) : undefined;
  const section = selected ? params.get("section") : null;
  const open = (id: string | null) => setParams(id ? { doc: id } : {});

  usePublishScreenContext({
    where: "Evidence",
    summary: selected ? docTitle(selected) : "At a glance",
    lines: [selected ? `The open document is "${selected.id}"${section ? `, at section "${section}"` : ""}.` : "The validation summary is open."],
  });

  let main;
  if (!docId) main = <Glance />;
  else if (selected) main = <DocView key={selected.id + "|" + (section ?? "")} doc={selected} docs={docs} section={section} />;
  else if (list.status === "ready") main = <EmptyState icon="evidence" title="Document not found" />;
  else main = <LoadState state={list} loading="Loading" what="the validation documents" onRetry={reload} />;

  return (
    <div className="evidence">
      <div className="evi-layout">
        <DocList docs={docs} selected={docId} onOpen={open} />
        {main}
      </div>
    </div>
  );
}
