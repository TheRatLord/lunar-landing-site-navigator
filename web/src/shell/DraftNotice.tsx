import { Button, IconButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Popover } from "../components/ui/Popover";
import { useScenario } from "../scenario/store";

const MAX_LINES = 8;

export function DraftNotice() {
  const problem = useScenario((s) => s.draftProblem);
  const dropped = useScenario((s) => s.droppedFields);
  const discardDraft = useScenario((s) => s.discardDraft);
  const dismiss = useScenario((s) => s.dismissDroppedFields);
  const elsewhere = useScenario((s) => s.draftElsewhere);
  const conflict = useScenario((s) => s.conflictVersion);
  const saved = useScenario((s) => s.saved);
  const name = useScenario((s) => s.doc?.name);
  const { keepThisTab, takeOtherTabDraft, load, saveAsNew } = useScenario.getState();
  if (!problem && !dropped && !elsewhere && (conflict === null || !saved)) return null;
  return (
    <>
      {elsewhere && (
        <div className="draft-notice" data-tone="marginal" role="alert">
          <Icon name="warn" size={14} />
          <strong>This plan was edited in another tab</strong>
          <span className="draft-notice-text">Both tabs share one plan. Pick which edits to keep.</span>
          <Button size="sm" onClick={takeOtherTabDraft}>
            Use other tab's edits
          </Button>
          <Button size="sm" onClick={keepThisTab}>
            Keep mine
          </Button>
        </div>
      )}
      {conflict !== null && saved && (
        <div className="draft-notice" data-tone="marginal" role="alert">
          <Icon name="warn" size={14} />
          <strong className="num">
            v{conflict} was saved while you edited v{saved.version}
          </strong>
          <span className="draft-notice-text" />
          <Button size="sm" onClick={() => void load(saved.id)}>
            Open v{conflict}
          </Button>
          <Button size="sm" onClick={() => void saveAsNew(`${name ?? "Plan"} (mine)`)}>
            Save mine as a new plan
          </Button>
        </div>
      )}
      {problem && (
        <div className="draft-notice" data-tone="fail" role="alert" data-testid="draft-problem">
          <Icon name="warn" size={14} />
          <strong>Could not reopen your last plan</strong>
          <span className="draft-notice-text" title={problem.summary}>
            {problem.summary}
          </span>
          {problem.details.length > 0 && (
            <Popover label={`${problem.details.length} details`} align="end" width={420}>
              <ul className="draft-notice-list">
                {problem.details.slice(0, MAX_LINES).map((d) => (
                  <li key={d}>
                    <code>{d}</code>
                  </li>
                ))}
                {problem.details.length > MAX_LINES && <li className="faint">+{problem.details.length - MAX_LINES}</li>}
              </ul>
            </Popover>
          )}
          <Button size="sm" onClick={discardDraft}>
            Discard draft
          </Button>
        </div>
      )}
      {dropped && (
        <div className="draft-notice" role="status" data-testid="dropped-fields">
          <Icon name="info" size={14} />
          <strong>Some fields were ignored</strong>
          <span className="draft-notice-text" title={`${dropped.source}: ${dropped.fields.join(", ")}`}>
            {dropped.source}: {dropped.fields.slice(0, MAX_LINES).join(", ")}
            {dropped.fields.length > MAX_LINES ? ` +${dropped.fields.length - MAX_LINES}` : ""}
          </span>
          <IconButton icon="close" size="sm" label="Dismiss" onClick={dismiss} />
        </div>
      )}
    </>
  );
}
