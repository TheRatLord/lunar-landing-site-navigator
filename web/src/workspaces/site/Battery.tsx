import type { EvaluateResult } from "../../api/site";
import { Button } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { useScenario } from "../../scenario/store";
import type { Limit, Scenario } from "../../scenario/types";
import { batteryOutlook } from "./adapt";

export function BatteryWarning({ doc, evaluated, result }: { doc: Scenario; evaluated: Scenario | null; result: EvaluateResult }) {
  const edit = useScenario((s) => s.edit);
  if (doc.constraints.min_state_of_charge) return null;
  const outlook = batteryOutlook(result, evaluated);
  if (!outlook) return null;
  const require = () => {
    const limit: Limit = { min: outlook.suggestedMin, max: null, unit: "", label: "Minimum battery state of charge", origin: { basis: "user", label: "", source_url: null, note: "" }, margin_scale: 1 };
    edit(["constraints", "min_state_of_charge"], limit);
  };
  return (
    <Popover label={outlook.text} icon="battery" iconOnly tone="marginal" align="end" width={300}>
      <div className="battery-pop">
        <p>{outlook.text}.</p>
        <p className="battery-pop-basis">{outlook.basis}. Not a requirement, so the verdict ignores it.</p>
        <Button size="sm" onClick={require}>
          Make it a requirement
        </Button>
      </div>
    </Popover>
  );
}
