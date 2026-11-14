import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { Spinner } from "../components/ui/Progress";
import { toast } from "../state/toasts";
import { useEditorUi } from "../scenario/editor/editorUi";
import { useField } from "../scenario/editor/fieldState";
import { useConfirm } from "../scenario/editor/useConfirm";
import { exportScenarioJson } from "../scenario/editor/scenarioActions";
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
      value={value ?? ""}
      onChange={(e) => set(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

export function PlanFile() {
  const doc = useScenario((s) => s.doc);
  const saved = useScenario((s) => s.saved);
  const dirty = useScenario(selectDirty);
  const phase = useScenario((s) => s.phase);
  const { save, saveAsNew, close } = useScenario.getState();
  const setDialog = useEditorUi((s) => s.setDialog);
  const { confirm, dialog } = useConfirm();

  if (!doc) return null;

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast({ kind: "success", title: "Link copied", detail: dirty && saved ? `Opens v${saved.version}, without your unsaved edits` : undefined }),
      () => toast({ kind: "error", title: "Could not copy the link" }),
    );
  };

  const items: MenuItem[] = [
    { id: "new", label: "New plan…", icon: "plus", onSelect: () => setDialog("new") },
    { id: "open", label: "Open plan…", icon: "folder", onSelect: () => setDialog("open") },
    { id: "duplicate", label: "Save as copy", icon: "copy", onSelect: () => void saveAsNew(`${doc.name} (copy)`) },
    { id: "revisions", label: "Version history…", icon: "history", disabled: !saved, onSelect: () => setDialog("revisions") },
    { id: "export", label: "Download plan (JSON)", icon: "download", divider: true, onSelect: exportScenarioJson },
    { id: "link", label: "Copy link", icon: "link", disabled: !saved, onSelect: copyLink },
    {
      id: "reset",
      label: "Reset to example plan",
      icon: "reset",
      divider: true,
      onSelect: () =>
        void (dirty ? confirm({ title: "Reset to example plan?", consequence: `Your unsaved edits to “${doc.name}” will be lost.`, action: "Reset" }) : Promise.resolve(true)).then((ok) => ok && close()),
    },
  ];

  const state = dirty ? (saved ? `Edited since v${saved.version}` : "Not saved") : saved ? `Saved v${saved.version}` : "Not saved";

  return (
    <div className="pf" role="group" aria-label="Plan file">
      <label className="pf-title" title="Plan name">
        <Icon name="file" size={16} />
        <PlanName />
      </label>
      <div className="pf-row">
        {phase === "saving" || phase === "loading" ? (
          <span className="pf-state" role="status">
            <Spinner size={12} /> {phase === "saving" ? "Saving" : "Opening"}
          </span>
        ) : (
          <span className="pf-state num" role="status">
            <span className={`tb-dot ${dirty ? "dirty" : saved ? "saved" : "unsaved"}`} aria-hidden="true" />
            {state}
          </span>
        )}
        <span className="grow" />
        <Button size="sm" variant={dirty || !saved ? "primary" : "ghost"} disabled={phase !== "idle" || (Boolean(saved) && !dirty)} onClick={() => void save()}>
          Save
        </Button>
        <Menu text="Plans" icon="folder" label="Plan actions" align="start" width={220} items={items} />
      </div>
      {dialog}
    </div>
  );
}
