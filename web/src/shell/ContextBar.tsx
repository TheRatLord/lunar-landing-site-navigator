import { useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { PopoverPanel } from "../components/ui/Popover";
import { Spinner } from "../components/ui/Progress";
import { formatLat, formatLon } from "../lib/coords";
import { clamp } from "../lib/scale";
import { MS_HOUR, formatUtc, parseUtc } from "../lib/time";
import { toast } from "../state/toasts";
import { useEditorUi, type ContextField } from "../scenario/editor/editorUi";
import { useField } from "../scenario/editor/fieldState";
import { useConfirm } from "../scenario/editor/useConfirm";
import { exportScenarioJson } from "../scenario/editor/scenarioActions";
import { SiteSection } from "../scenario/editor/SiteSection";
import { TimeSection } from "../scenario/editor/TimeSection";
import { selectDirty, useScenario } from "../scenario/store";
import { stackIds, stackName } from "../scenario/terrainStack";

function PlanName() {
  const { value, issue, set } = useField<string>(["name"]);
  return (
    <input
      id="ctx-name"
      className="ctx-name"
      aria-label="Plan name"
      aria-invalid={issue ? true : undefined}
      spellCheck={false}
      autoComplete="off"
      size={clamp((value ?? "").length + 1, 8, 36)}
      value={value ?? ""}
      onChange={(e) => set(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function FieldSlot({ field, label, value, detail, children }: { field: ContextField; label: string; value: string; detail?: string; children: ReactNode }) {
  const open = useEditorUi((s) => s.field === field);
  const openField = useEditorUi((s) => s.openField);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        id={`ctx-${field}`}
        className="ctx-slot"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => openField(open ? null : field)}
      >
        <span className="ctx-label">{label}</span>
        <span className="ctx-value">{value}</span>
        {detail && <span className="ctx-detail num">{detail}</span>}
        <Icon name="chevronDown" size={12} />
      </button>
      <PopoverPanel open={open} anchor={anchor} onClose={() => openField(null)} label={label} width={440} className="ctx-pop">
        {children}
      </PopoverPanel>
    </>
  );
}

export function ContextBar() {
  const doc = useScenario((s) => s.doc);
  const saved = useScenario((s) => s.saved);
  const dirty = useScenario(selectDirty);
  const phase = useScenario((s) => s.phase);
  const { save, saveAsNew, close } = useScenario.getState();
  const setDialog = useEditorUi((s) => s.setDialog);
  const show = useEditorUi((s) => s.show);
  const openField = useEditorUi((s) => s.openField);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { confirm, dialog } = useConfirm();

  if (!doc) return <div className="ctx" aria-hidden="true" />;

  const landing = parseUtc(doc.landing_utc);
  const days = doc.mission_duration_h / 24;
  const siteName = doc.site.name || doc.site.catalog_id || "Unnamed site";

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

  return (
    <div className="ctx" role="region" aria-label="Current plan">
      <span className="ctx-kicker">Plan</span>
      <PlanName />
      <span className="ctx-rule" aria-hidden="true" />
      <FieldSlot
        field="site"
        label="Site"
        value={siteName}
        detail={`${formatLat(doc.site.lat_deg, 2)} ${formatLon(doc.site.lon_deg, 2)}`}
      >
        <div className="ctx-pop-body">
          <SiteSection />
        </div>
      </FieldSlot>
      <FieldSlot field="time" label="Landing" value={landing === null ? doc.landing_utc : formatUtc(landing, { seconds: false })} detail={`${days.toFixed(1)} d on the surface`}>
        <div className="ctx-pop-body">
          <TimeSection />
        </div>
        <div className="ctx-pop-foot">
          <Button
            size="sm"
            icon="calendar"
            onClick={() => {
              openField(null);
              navigate("/dates");
            }}
          >
            Scan landing dates
          </Button>
          {landing !== null && <span className="faint num">Ends {formatUtc(landing + doc.mission_duration_h * MS_HOUR, { seconds: false })}</span>}
        </div>
      </FieldSlot>
      <button type="button" className="ctx-slot" aria-current={pathname.startsWith("/mission") ? "page" : undefined} onClick={() => show()}>
        <span className="ctx-label">Lander</span>
        <span className="ctx-value">{doc.profile.name}</span>
        <Icon name="chevronRight" size={12} />
      </button>
      {doc.terrain_stores != null && (
        <button type="button" className="ctx-flag" title={`${stackName(doc.terrain_stores)}: ${stackIds(doc.terrain_stores)}`} onClick={() => show("model")}>
          <Icon name="terrain" size={12} /> Custom terrain stack
        </button>
      )}
      <span className="grow" />
      {phase === "saving" || phase === "loading" ? (
        <span className="ctx-state" role="status">
          <Spinner size={12} /> {phase === "saving" ? "Saving" : "Opening plan"}
        </span>
      ) : (
        <span className="ctx-state num" role="status">
          <span className={`tb-dot ${dirty ? "dirty" : saved ? "saved" : "unsaved"}`} aria-hidden="true" />
          {dirty ? (saved ? `Edited since v${saved.version}` : "Not saved") : saved ? `Saved v${saved.version}` : "Not saved"}
        </span>
      )}
      <Button size="sm" variant={dirty || !saved ? "primary" : "ghost"} disabled={phase !== "idle" || (Boolean(saved) && !dirty)} onClick={() => void save()}>
        Save
      </Button>
      <Menu text="Plans" icon="folder" label="Plan actions" align="end" width={220} items={items} />
      {dialog}
    </div>
  );
}
