import { Button } from "../../components/ui/Button";
import { ConstraintsSection } from "../../scenario/editor/ConstraintsSection";
import { useEditorUi } from "../../scenario/editor/editorUi";
import { RankControl } from "./Widen";

export function RequirementsPicker() {
  const show = useEditorUi((s) => s.show);
  return (
    <div className="plan-pick">
      <div className="plan-pick-scroll plan-pick-form">
        <p className="sc-about">A site and date pass only if every requirement switched on here is met. Switch one on, then set its limit.</p>
        <RankControl />
        <ConstraintsSection />
      </div>
      <div className="plan-pop-foot">
        <span className="faint">Results update as you edit.</span>
        <Button size="sm" icon="sliders" onClick={() => show("constraints")}>
          Open in Mission setup
        </Button>
      </div>
    </div>
  );
}
