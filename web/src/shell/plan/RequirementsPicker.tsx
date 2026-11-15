import { ConstraintsSection } from "../../scenario/editor/ConstraintsSection";
import { RankControl } from "./Widen";

export function RequirementsPicker() {
  return (
    <div className="plan-pick">
      <div className="plan-pick-scroll plan-pick-form">
        <RankControl />
        <ConstraintsSection />
      </div>
    </div>
  );
}
