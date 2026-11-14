import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Popover } from "../components/ui/Popover";
import { useScenario } from "../scenario/store";
import { Chip } from "../workspaces/analyst/Chip";
import type { AskContext } from "./useAskContext";

interface Props {
  ctx: AskContext;
  on: boolean;
  onChange: (on: boolean) => void;
  unchanged: boolean;
}

export function ReachState({ ctx }: { ctx: AskContext }) {
  const saving = useScenario((s) => s.phase === "saving");
  if (!ctx.reach || ctx.reach === "stored") return null;
  return (
    <div className="ask-reach" data-reach={ctx.reach}>
      <Chip tone="marginal" icon="alert">
        {ctx.reach === "edited" ? "Unsaved edits" : "Plan not saved"}
      </Chip>
      <Button size="sm" icon="save" disabled={saving} onClick={() => void useScenario.getState().save()}>
        Save
      </Button>
    </div>
  );
}

export function ContextChip({ ctx, on, onChange, unchanged }: Props) {
  if (ctx.block === null) return null;
  const where = ctx.screen ? [ctx.screen.where, ctx.screen.summary].filter(Boolean).join(" · ") : "Plan";
  return (
    <div className="ask-ctx" data-on={on ? "yes" : "no"}>
      <button type="button" className="chip ask-ctx-chip" aria-pressed={on} aria-label={`Attach context: ${where}`} onClick={() => onChange(!on)}>
        <Icon name={on ? "eye" : "eyeOff"} size={12} />
        <span className="ask-ctx-text">{where}</span>
      </button>
      <Popover iconOnly icon="info" label="Attached context" width={360}>
        <div className="ask-ctx-head">
          <Chip tone={on ? "pass" : "default"} icon={on ? "check" : "eyeOff"}>
            {on ? "Attached" : "Not attached"}
          </Chip>
          {on && unchanged && <Chip>Already sent</Chip>}
        </div>
        <pre className="ask-ctx-pre" tabIndex={0} aria-label="Context text">
          {ctx.block}
        </pre>
      </Popover>
    </div>
  );
}
