import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Popover } from "../../components/ui/Popover";
import { MISSION_SECTIONS, useEditorUi, type EditorTarget, type MissionSection } from "../../scenario/editor/editorUi";
import { LanderSection } from "../../scenario/editor/LanderSection";
import { ModelSection } from "../../scenario/editor/ModelSection";
import { NetworkSection } from "../../scenario/editor/NetworkSection";
import { useLiveValidation } from "../../scenario/editor/useLiveValidation";
import { fieldErrorCount, useFieldErrors } from "../../scenario/fieldErrors";
import { useScenario, type ValidationIssue } from "../../scenario/store";
import { usePublishScreenContext } from "../../ask/screenContext";
import "../../styles/mission.css";

const BODIES: Record<MissionSection, () => ReactNode> = {
  lander: () => <LanderSection />,
  network: () => <NetworkSection />,
  model: () => <ModelSection />,
};

const TARGET_OF_ROOT: Record<string, EditorTarget> = {
  site: "site",
  landing_utc: "time",
  mission_duration_h: "time",
  profile: "lander",
  constraints: "constraints",
  network: "network",
  transfer: "time",
  ellipse: "ellipse",
  terrain_error: "model",
  eclipse: "model",
  sampling: "model",
  terrain_stores: "model",
};

function targetOf(loc: string[]): EditorTarget | undefined {
  const root = loc.find((p) => p in TARGET_OF_ROOT);
  return root ? TARGET_OF_ROOT[root] : undefined;
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  const show = useEditorUi((s) => s.show);
  const clearIssues = useScenario((s) => s.clearIssues);
  return (
    <Popover label={`${issues.length} error${issues.length === 1 ? "" : "s"}`} icon="alert" tone="fail" align="end" width={380}>
      <ul className="sc-issues">
        {issues.slice(0, 12).map((i, k) => {
          const target = targetOf(i.loc);
          return (
            <li key={k}>
              <button type="button" className="sc-issue" disabled={!target} onClick={() => target && show(target)}>
                <span className="sc-issue-path">{i.loc.filter((p) => p !== "body" && p !== "document").join(" › ") || "plan"}</span>
                <span>{i.msg}</span>
              </button>
            </li>
          );
        })}
        {issues.length > 12 && <li className="dim num">+{issues.length - 12}</li>}
      </ul>
      <Button size="sm" variant="ghost" icon="close" onClick={clearIssues}>
        Dismiss
      </Button>
    </Popover>
  );
}

function CheckState() {
  const issues = useScenario((s) => s.issues);
  const local = useFieldErrors(fieldErrorCount);
  const validation = useLiveValidation();
  if (issues.length > 0) return <IssueList issues={issues} />;
  if (local === 0 && validation.state !== "invalid") return null;
  return (
    <span className="sc-foot-state sc-bad" role="status">
      <Icon name="alert" size={14} /> Needs fixing
    </span>
  );
}

export function MissionWorkspace() {
  const section = useEditorUi((s) => s.section);
  const request = useEditorUi((s) => s.route?.n ?? 0);
  const show = useEditorUi((s) => s.show);
  const issues = useScenario((s) => s.issues);
  const profileName = useScenario((s) => s.doc?.profile.name ?? "");
  usePublishScreenContext({ where: "Setup", summary: profileName, lines: [] });
  const bodyRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<MissionSection>(section);

  const counts = useMemo(() => {
    const c: Partial<Record<string, number>> = {};
    for (const i of issues) {
      const t = targetOf(i.loc);
      if (t) c[t] = (c[t] ?? 0) + 1;
    }
    return c;
  }, [issues]);

  useEffect(() => {
    const body = bodyRef.current;
    const el = body?.querySelector<HTMLElement>(`#mission-${section}`);
    if (body && el) body.scrollTo({ top: el.offsetTop - body.offsetTop });
  }, [section, request]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = top?.target.id.replace("mission-", "") as MissionSection | undefined;
        if (id) setVisible(id);
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    );
    root.querySelectorAll(".mission-sec").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="mission" aria-label="Setup page">
      <PageHeader actions={<CheckState />}>
        <h1 className="mission-title">Setup</h1>
      </PageHeader>
      <div className="mission-grid">
        <nav className="mission-index" aria-label="Setup sections">
          {MISSION_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="mission-link"
              aria-current={visible === s.id ? "true" : undefined}
              onClick={() => show(s.id)}
            >
              <Icon name={s.icon} size={14} />
              <span>{s.label}</span>
              {counts[s.id] ? <span className="sc-dot" role="img" aria-label={`${counts[s.id]} problems`} /> : null}
            </button>
          ))}
        </nav>
        <div ref={bodyRef} className="mission-body" tabIndex={-1}>
          {MISSION_SECTIONS.map((s) => (
            <section key={s.id} id={`mission-${s.id}`} className="mission-sec" aria-labelledby={`mission-h-${s.id}`}>
              <h2 id={`mission-h-${s.id}`} className="mission-sec-title">
                <Icon name={s.icon} size={16} />
                {s.label}
              </h2>
              {s.about && <p className="mission-sec-about">{s.about}</p>}
              {BODIES[s.id]()}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
