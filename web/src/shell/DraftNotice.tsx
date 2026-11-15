import { Button, IconButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { BLANK_LINK, DEMO_LINK, RESET_LINK, useScenario } from "../scenario/store";
import { runPlanAction } from "./PlanSwitcher";

const ACTION_TEXT: Record<string, string> = {
  [DEMO_LINK]: "This opens the demo plan.",
  [BLANK_LINK]: "This starts a blank plan.",
  [RESET_LINK]: "This resets and opens the demo plan.",
};

const MAX_LINES = 8;

export function DraftNotice() {
  const problem = useScenario((s) => s.draftProblem);
  const dropped = useScenario((s) => s.droppedFields);
  const elsewhere = useScenario((s) => s.draftElsewhere);
  const conflict = useScenario((s) => s.conflictVersion);
  const saved = useScenario((s) => s.saved);
  const pendingLink = useScenario((s) => s.pendingLink);
  const { keepThisTab, takeOtherTabDraft, load, saveAsNew, dismissDroppedFields, dismissDraftProblem } = useScenario.getState();
  if (!problem && !dropped && !elsewhere && !pendingLink && (conflict === null || !saved)) return null;
  return (
    <>
      {pendingLink && (
        <div className="draft-notice" data-tone="marginal" role="alert">
          <Icon name="link" size={14} />
          <strong>{ACTION_TEXT[pendingLink] ?? "This link opens another plan."}</strong>
          <span className="draft-notice-text">Your unsaved edits will be lost.</span>
          <Button size="sm" onClick={() => void (pendingLink === DEMO_LINK || pendingLink === BLANK_LINK || pendingLink === RESET_LINK ? runPlanAction(pendingLink) : load(pendingLink))}>
            Open it
          </Button>
          <Button size="sm" onClick={() => useScenario.setState({ pendingLink: null })}>
            Keep mine
          </Button>
        </div>
      )}
      {elsewhere && (
        <div className="draft-notice" data-tone="marginal" role="alert">
          <Icon name="warn" size={14} />
          <strong>Edited in another tab.</strong>
          <span className="draft-notice-text" />
          <Button size="sm" onClick={takeOtherTabDraft}>
            Use theirs
          </Button>
          <Button size="sm" onClick={keepThisTab}>
            Keep mine
          </Button>
        </div>
      )}
      {conflict !== null && saved && (
        <div className="draft-notice" data-tone="marginal" role="alert">
          <Icon name="warn" size={14} />
          <strong>Saved elsewhere while you edited.</strong>
          <span className="draft-notice-text" />
          <Button size="sm" onClick={() => void load(saved.id)}>
            Open theirs
          </Button>
          <Button size="sm" onClick={() => void saveAsNew()}>
            Save mine as a copy
          </Button>
        </div>
      )}
      {problem && (
        <div className="draft-notice" data-tone="fail" role="alert" data-testid="draft-problem">
          <Icon name="warn" size={14} />
          <strong>Your last plan could not be reopened.</strong>
          <span className="draft-notice-text" title={[problem.summary, ...problem.details].join(" ")}>
            {problem.summary}
          </span>
          <IconButton icon="close" size="sm" label="Dismiss" onClick={dismissDraftProblem} />
        </div>
      )}
      {dropped && (
        <div className="draft-notice" role="status" data-testid="dropped-fields">
          <Icon name="info" size={14} />
          <strong>Some fields were ignored</strong>
          <span className="draft-notice-text" title={dropped.fields.join(", ")}>
            {dropped.fields.slice(0, MAX_LINES).join(", ")}
            {dropped.fields.length > MAX_LINES ? ` +${dropped.fields.length - MAX_LINES}` : ""}
          </span>
          <IconButton icon="close" size="sm" label="Dismiss" onClick={dismissDroppedFields} />
        </div>
      )}
    </>
  );
}
