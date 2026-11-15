import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { Spinner } from "../components/ui/Progress";
import { parseUtc } from "../lib/time";
import { toast } from "../state/toasts";
import { useEditorUi } from "../scenario/editor/editorUi";
import { useField } from "../scenario/editor/fieldState";
import { useConfirm } from "../scenario/editor/useConfirm";
import { exportScenarioJson } from "../scenario/editor/scenarioActions";
import { loadCreatedPlans } from "../scenario/myPlans";
import { forgetDemoSearch, importPlanFile, selectSearchDirty, usePlanSearch } from "../scenario/planSearch";
import { planLink } from "../scenario/scenarioUrl";
import { BLANK_LINK, DEMO_LINK, RESET_LINK, selectDirty, useScenario } from "../scenario/store";
import type { ScenarioRecord } from "../scenario/types";
import { whenText } from "../scenario/when";
import { HOME, showsPlan } from "../workspaces/registry";

const LISTED = 8;

function PlanName() {
  const { value, issue, set } = useField<string>(["name"]);
  return (
    <input
      id="plan-name"
      className="pf-name"
      aria-label="Plan name"
      aria-invalid={issue ? true : undefined}
      spellCheck={false}
      autoComplete="off"
      placeholder="Untitled plan"
      value={value ?? ""}
      onChange={(e) => set(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

export async function copyPlanLink(): Promise<void> {
  const s = useScenario.getState();
  if (!s.saved || selectDirty(s) || selectSearchDirty(usePlanSearch.getState())) {
    if (!(await s.save())) return;
  }
  const link = planLink();
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    toast({ kind: "success", title: "Link copied" });
  } catch {
    toast({ kind: "error", title: "Could not copy the link", detail: link });
  }
}

export function usePlanDirty(): boolean {
  const demo = useScenario((s) => s.demo);
  const docDirty = useScenario(selectDirty);
  const searchDirty = usePlanSearch(selectSearchDirty);
  return !demo && (docDirty || searchDirty);
}

export function useDiscardGuard() {
  const dirty = usePlanDirty();
  const name = useScenario((s) => s.doc?.name);
  const { confirm, dialog } = useConfirm();
  const guard = (action: string) => (dirty ? confirm({ title: "Discard unsaved edits?", consequence: `“${name || "Untitled plan"}” has unsaved edits.`, action }) : Promise.resolve(true));
  return { guard, dialog };
}

export async function resetDemo(): Promise<void> {
  forgetDemoSearch();
  if (await useScenario.getState().openDemo(true)) toast({ kind: "info", title: "Demo reset" });
}

export async function startBlankPlan(): Promise<boolean> {
  if (!(await useScenario.getState().openBlank())) return false;
  useEditorUi.getState().openField("site");
  return true;
}

export type PlanAction = typeof DEMO_LINK | typeof BLANK_LINK | typeof RESET_LINK;

export function runPlanAction(action: PlanAction): Promise<unknown> {
  if (action === BLANK_LINK) return startBlankPlan();
  if (action === RESET_LINK) return resetDemo();
  return useScenario.getState().openDemo();
}

export function requestPlanAction(action: PlanAction): Promise<unknown> {
  const s = useScenario.getState();
  if (!s.demo && (selectDirty(s) || selectSearchDirty(usePlanSearch.getState()))) {
    useScenario.setState({ pendingLink: action });
    return Promise.resolve(false);
  }
  return runPlanAction(action);
}

export function PlanSwitcher() {
  const doc = useScenario((s) => s.doc);
  const saved = useScenario((s) => s.saved);
  const demo = useScenario((s) => s.demo);
  const phase = useScenario((s) => s.phase);
  const dirty = usePlanDirty();
  const { save, saveAsNew, openDemo, load } = useScenario.getState();
  const setDialog = useEditorUi((s) => s.setDialog);
  const { guard, dialog } = useDiscardGuard();
  const fileRef = useRef<HTMLInputElement>(null);
  const [plans, setPlans] = useState<ScenarioRecord[] | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (!doc) {
    return phase === "loading" ? (
      <span className="tb-plan pf-state" role="status">
        <Spinner size={12} /> Opening
      </span>
    ) : null;
  }

  const refresh = () => {
    setPlans(null);
    void loadCreatedPlans().then(setPlans);
  };

  const startBlank = () =>
    void guard("Start a blank plan").then(async (ok) => {
      if (ok && (await startBlankPlan()) && !showsPlan(pathname)) navigate(HOME.path);
    });

  const mine: MenuItem[] =
    plans === null
      ? [{ id: "loading", label: "Loading your plans…", icon: "history", disabled: true, onSelect: () => undefined }]
      : plans.length === 0
        ? [{ id: "none", label: "No saved plans yet", icon: "folder", disabled: true, onSelect: () => undefined }]
        : plans.slice(0, LISTED).map((p) => ({
            id: `plan-${p.id}`,
            label: p.name || "Untitled plan",
            icon: "file",
            hint: p.id === saved?.id ? "Open" : whenText(parseUtc(p.updated_utc) ?? 0),
            onSelect: () => {
              if (p.id !== saved?.id) void guard("Open").then((ok) => ok && void load(p.id));
            },
          }));
  if (plans && plans.length > LISTED) mine.push({ id: "all", label: `All ${plans.length} plans…`, icon: "list", onSelect: () => setDialog("open") });
  mine[0] = { ...mine[0]!, divider: true };

  const items: MenuItem[] = [
    {
      id: "demo",
      label: "Demo plan",
      icon: "rover",
      hint: demo ? "Open" : undefined,
      onSelect: () => {
        if (!demo) void guard("Open the demo").then((ok) => ok && void openDemo());
      },
    },
    { id: "blank", label: "Blank plan", icon: "plus", onSelect: startBlank },
    ...mine,
    ...(demo
      ? ([
          { id: "keep", label: "Save as my plan", icon: "save", divider: true, onSelect: () => void save() },
          { id: "reset", label: "Reset the demo", icon: "reset", onSelect: () => void resetDemo() },
        ] satisfies MenuItem[])
      : saved
        ? ([{ id: "copy", label: "Save a copy", icon: "copy", divider: true, onSelect: () => void saveAsNew() }] satisfies MenuItem[])
        : []),
    { id: "import", label: "Open plan file…", icon: "folder", divider: !demo && !saved, onSelect: () => fileRef.current?.click() },
    { id: "export", label: "Download plan file", icon: "download", onSelect: exportScenarioJson },
    { id: "link", label: "Copy link", icon: "link", onSelect: () => void copyPlanLink() },
  ];

  const busy = phase === "saving" || phase === "loading";

  const rename = (
    <div className="tb-plan-rename">
      <label htmlFor="plan-name">Name</label>
      <PlanName />
    </div>
  );

  return (
    <div className="tb-plan" role="group" aria-label="Plan">
      <Menu
        text={
          <>
            {demo && (
              <span className="chip tb-plan-demo" title="Your own copy of the demo, kept in this browser. Edits are kept as you go.">
                Demo
              </span>
            )}
            <span className="tb-plan-name">{doc.name.trim() || "Untitled plan"}</span>
          </>
        }
        label="Plan"
        align="end"
        width={300}
        items={items}
        footer={rename}
        onOpen={refresh}
      />
      {busy ? (
        <span className="pf-state" role="status">
          <Spinner size={12} /> {phase === "saving" ? "Saving" : "Opening"}
        </span>
      ) : dirty ? (
        <>
          <span className="tb-dot dirty" role="status" title="Unsaved edits">
            <span className="sr-only">Unsaved</span>
          </span>
          <Button size="sm" variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      ) : (
        saved && (
          <span className="tb-dot saved" role="status" title="Saved">
            <span className="sr-only">Saved</span>
          </span>
        )
      )}
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void guard("Open").then((ok) => ok && void f.text().then(importPlanFile));
        }}
      />
      {dialog}
    </div>
  );
}
