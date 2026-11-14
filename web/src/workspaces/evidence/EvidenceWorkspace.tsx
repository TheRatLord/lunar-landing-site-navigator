import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublishScreenContext } from "../../ask/screenContext";
import { useSearchParams } from "react-router-dom";
import { evidenceApi } from "../../api/endpoints";
import { useLoad } from "../../api/useLoad";
import type { EvidenceDoc } from "../../api/types";
import { Markdown } from "../../components/content/Markdown";
import { IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Tabs } from "../../components/ui/Panel";
import { evidenceHref, resolveSection } from "../../lib/evidence";
import { extractToc, resolveRelative, type TocEntry } from "../../lib/markdown";
import { toast } from "../../state/toasts";
import { Chip } from "../analyst/Chip";
import { LoadState, MetaView } from "./MetaView";

const MARK_MS = 3000;
const ACTIVE_OFFSET = 24;

const plainTitle = (t: string) => t.replaceAll("`", "");

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

function DocView({ doc, docs, section, onSection }: { doc: EvidenceDoc; docs: EvidenceDoc[]; section: string | null; onSection: (text: string | null) => void }) {
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

  const activeText = toc.find((t) => t.id === active)?.text ?? null;
  useEffect(() => {
    onSection(activeText);
  }, [activeText, onSection]);
  useEffect(() => () => onSection(null), [onSection]);

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

  if (state.status !== "ready") return <LoadState state={state} loading={`Loading ${plainTitle(doc.title)}`} what={plainTitle(doc.title)} onRetry={reload} />;

  return (
    <div className="evi-doc" ref={setScroller}>
      <article className="evi-article" aria-label={plainTitle(doc.title)}>
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
    </div>
  );
}

function DocList({ docs, selected, onOpen }: { docs: EvidenceDoc[]; selected: EvidenceDoc; onOpen: (id: string) => void }) {
  const collide = useMemo(() => {
    const seen = new Map<string, number>();
    for (const d of docs) seen.set(plainTitle(d.title), (seen.get(plainTitle(d.title)) ?? 0) + 1);
    return (d: EvidenceDoc) => (seen.get(plainTitle(d.title)) ?? 0) > 1;
  }, [docs]);
  return (
    <nav className="evi-list" aria-label="Documents">
      {[...Map.groupBy(docs, (d) => d.kind)].map(([kind, group]) => (
        <section key={kind} className="evi-group" aria-labelledby={`evi-group-${kind}`}>
          <h2 id={`evi-group-${kind}`} className="evi-group-title">
            {kind === "validation" ? "Validation" : "Research"}
          </h2>
          <ul>
            {group.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="evi-item"
                  title={d.path}
                  aria-current={d.id === selected.id ? "page" : undefined}
                  onClick={() => onOpen(d.id)}
                >
                  <span className="evi-item-title">{plainTitle(d.title)}</span>
                  {collide(d) && <span className="evi-item-path">{d.path}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

type Tab = "reports" | "versions";

const loadList = (signal: AbortSignal) => evidenceApi.list({ signal });

export function EvidenceWorkspace() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("reports");
  const { state: list, reload } = useLoad(loadList);
  const [current, setCurrent] = useState<string | null>(null);

  const docs = list.status === "ready" ? list.data : [];
  const selected = docs.find((d) => d.id === params.get("doc")) ?? docs[0];
  const section = selected && selected.id === params.get("doc") ? params.get("section") : null;
  const open = (id: string) => setParams({ doc: id });

  const copyLink = () => {
    if (!selected) return;
    const url = window.location.origin + evidenceHref(selected.id, current);
    navigator.clipboard.writeText(url).then(
      () => toast({ kind: "success", title: "Link copied" }, 1500),
      () => toast({ kind: "error", title: "Could not copy the link" }),
    );
  };

  usePublishScreenContext({
    where: "Evidence",
    summary: tab === "reports" ? "Validation reports" : "Data versions",
    lines:
      tab === "reports"
        ? [selected ? `The open document is "${selected.id}"${section ? `, at section "${section}"` : ""}.` : "No document is open."]
        : ["The Data versions tab (data and code versions) is open."],
  });

  return (
    <div className="evidence">
      <PageHeader
        tabs={
          <Tabs
            label="Evidence"
            panels
            value={tab}
            onChange={(t) => setTab(t as Tab)}
            tabs={[
              { id: "reports", label: "Validation reports" },
              { id: "versions", label: "Data versions" },
            ]}
          />
        }
        actions={tab === "reports" && selected ? <IconButton icon="link" label={current ? "Copy section link" : "Copy link"} onClick={copyLink} /> : undefined}
      />
      <div className="evi-body" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "versions" && <MetaView />}
        {tab === "reports" && (
          <>
            <LoadState state={list} loading="Loading validation reports" what="the validation reports" onRetry={reload} />
            {list.status === "ready" && docs.length === 0 && <EmptyState icon="evidence" title="No validation reports" />}
            {selected && (
              <div className="evi-layout">
                <DocList docs={docs} selected={selected} onOpen={open} />
                <DocView key={selected.id + "|" + (section ?? "")} doc={selected} docs={docs} section={section} onSection={setCurrent} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
