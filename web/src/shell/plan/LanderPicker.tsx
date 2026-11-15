import { ServiceNotice } from "../../components/ServiceNotice";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import type { ProfileEntry } from "../../scenario/api";
import { useEditorUi } from "../../scenario/editor/editorUi";
import { useConfirm } from "../../scenario/editor/useConfirm";
import { usePresets } from "../../scenario/editor/usePresets";
import { useScenario } from "../../scenario/store";
import { landerFacts, landerName, sameProfile } from "./landerFacts";

export function LanderPicker() {
  const profile = useScenario((s) => s.doc?.profile);
  const edit = useScenario((s) => s.edit);
  const show = useEditorUi((s) => s.show);
  const openField = useEditorUi((s) => s.openField);
  const presets = usePresets();
  const { confirm, dialog } = useConfirm();
  if (!profile) return null;

  const entries = presets.status === "ready" ? presets.data.profiles : [];
  const match = entries.find((e) => e.profile.id === profile.id);
  const customised = match ? !sameProfile(match.profile, profile) : entries.length > 0;

  const apply = (e: ProfileEntry) => {
    if (match === e && !customised) return openField(null);
    void (customised ? confirm({ title: `Replace the lander with ${e.name}?`, consequence: `Your edits to “${profile.name}” will be lost.`, action: "Replace" }) : Promise.resolve(true)).then((ok) => {
      if (!ok) return;
      edit(["profile"], e.profile);
      openField(null);
    });
  };

  const group = (title: string | null, source: ProfileEntry["source"]) => {
    const list = entries.filter((e) => e.source === source);
    return (
      list.length > 0 && (
        <>
          {title && <p className="plan-list-group">{title}</p>}
          <ul className="plan-list">
            {list.map((e) => {
              const on = match === e;
              return (
                <li key={e.id}>
                  <button type="button" className="plan-option" aria-current={on ? "true" : undefined} onClick={() => apply(e)}>
                    <span className="plan-option-mark">{on && <Icon name="check" size={14} />}</span>
                    <span className="plan-option-text plan-option-stack">
                      <strong>
                        {landerName(e.name)}
                        {on && customised && <span className="chip chip-marginal">Edited</span>}
                      </strong>
                      {landerFacts(e.profile).map((f) => (
                        <span key={f}>{f}</span>
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )
    );
  };

  return (
    <div className="plan-pick">
      <div className="plan-pick-scroll">
        {presets.status === "loading" && (
          <p className="plan-empty">
            <Spinner size={12} /> Loading
          </p>
        )}
        {presets.status === "error" && <ServiceNotice error={presets.error} what="Lander presets" />}
        {!match && entries.length > 0 && (
          <p className="plan-empty">
            Custom: <strong>{profile.name}</strong>
          </p>
        )}
        {group(null, "catalog")}
        {group("Generic (estimates)", "generic")}
      </div>
      <div className="plan-pop-foot plan-pop-foot-end">
        <Button size="sm" icon="sliders" onClick={() => show("lander")}>
          Edit lander details
        </Button>
      </div>
      {dialog}
    </div>
  );
}
