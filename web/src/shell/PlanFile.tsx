import { useRef } from "react";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { Spinner } from "../components/ui/Progress";
import { toast } from "../state/toasts";
import { useEditorUi } from "../scenario/editor/editorUi";
import { useField } from "../scenario/editor/fieldState";
import { useConfirm } from "../scenario/editor/useConfirm";
import { exportScenarioJson } from "../scenario/editor/scenarioActions";
import { planLink } from "../scenario/scenarioUrl";
import { selectDirty, useScenario } from "../scenario/store";

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
  if (!s.saved || selectDirty(s)) {
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

export function PlanFile() {
  const doc = useScenario((s) => s.doc);
  const saved = useScenario((s) => s.saved);
  const dirty = useScenario(selectDirty);
  const phase = useScenario((s) => s.phase);
  const { save, close, importText } = useScenario.getState();
  const setDialog = useEditorUi((s) => s.setDialog);
  const { confirm, dialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  if (!doc) return null;

  const discard = (action: string) => (dirty ? confirm({ title: "Discard unsaved edits?", consequence: `“${doc.name || "Untitled plan"}” has unsaved edits.`, action }) : Promise.resolve(true));

  const items: MenuItem[] = [
    { id: "open", label: "Open…", icon: "folder", onSelect: () => setDialog("open") },
    { id: "import", label: "Open plan file…", icon: "file", onSelect: () => fileRef.current?.click() },
    { id: "export", label: "Download plan file", icon: "download", divider: true, onSelect: exportScenarioJson },
    { id: "link", label: "Copy link", icon: "link", onSelect: () => void copyPlanLink() },
    { id: "reset", label: "Reset", icon: "reset", divider: true, onSelect: () => void discard("Reset").then((ok) => ok && close()) },
  ];

  const busy = phase === "saving" || phase === "loading";
  const showSave = dirty && !busy;

  return (
    <div className="pf" role="group" aria-label="Plan file">
      <label className="pf-title">
        <Icon name="file" size={16} />
        <PlanName />
      </label>
      <div className="pf-row">
        {busy ? (
          <span className="pf-state" role="status">
            <Spinner size={12} /> {phase === "saving" ? "Saving" : "Opening"}
          </span>
        ) : dirty ? (
          <span className="pf-state" role="status">
            <span className="tb-dot dirty" aria-hidden="true" />
            Unsaved
          </span>
        ) : saved ? (
          <span className="pf-state" role="status">
            <span className="tb-dot saved" aria-hidden="true" />
            Saved
          </span>
        ) : null}
        <span className="grow" />
        {showSave && (
          <Button size="sm" variant="primary" onClick={() => void save()}>
            Save
          </Button>
        )}
        <Menu text="Plans" icon="folder" label="Plan actions" align="start" width={200} items={items} />
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void discard("Open").then((ok) => ok && void f.text().then(importText));
        }}
      />
      {dialog}
    </div>
  );
}
