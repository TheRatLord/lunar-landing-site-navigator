import { useState } from "react";
import { budgetFieldError, parseBudgetInput } from "../../agent/budget";
import { useServiceInstructions } from "../../agent/useRuns";
import { ApiError, reportError } from "../../api/client";
import { agentApi } from "../../api/endpoints";
import { useAsk } from "../../ask/askStore";
import { ComposeBox } from "../../ask/ComposeBox";
import { questionRoom, withContext } from "../../ask/contextBlock";
import { ContextChip, ReachState } from "../../ask/ContextChip";
import { useAskContext } from "../../ask/useAskContext";
import { ServiceNotice } from "../../components/ServiceNotice";
import { IconButton } from "../../components/ui/Button";
import { Field, Select } from "../../components/ui/Fields";
import { Popover } from "../../components/ui/Popover";
import { Chip } from "./Chip";

const MODELS = [
  { value: "", label: "Default model" },
  { value: "claude-sonnet-5-5", label: "claude-sonnet-5-5" },
  { value: "claude-opus-5-5", label: "claude-opus-5-5" },
  { value: "sonnet", label: "sonnet" },
  { value: "opus", label: "opus" },
  { value: "haiku", label: "haiku" },
];

export function Composer({ prompt, onPrompt, onStarted }: { prompt: string; onPrompt: (text: string) => void; onStarted: (runId: string) => void }) {
  const [model, setModel] = useState("");
  const [budget, setBudget] = useState("");
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [ctxOn, setCtxOn] = useState(true);
  const ctx = useAskContext();
  const { instructions } = useServiceInstructions();
  const defaultCap = typeof instructions?.max_budget_usd === "number" ? instructions.max_budget_usd : null;
  const attach = ctxOn ? ctx.block : null;

  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    const cap = parseBudgetInput(budget);
    setBudgetError(cap.error);
    if (cap.error) return;
    setBusy(true);
    setError(null);
    try {
      const run = await agentApi.createRun(withContext(text, attach), model || undefined, cap.value);
      if (attach) useAsk.getState().rememberContext(run.run_id, attach);
      onPrompt("");
      onStarted(run.run_id);
    } catch (e) {
      const onField = budgetFieldError(e);
      if (onField) setBudgetError(onField);
      else {
        if (e instanceof ApiError) setError(e);
        reportError(e, "Could not start the thread");
      }
    } finally {
      setBusy(false);
    }
  };

  const chosen = [model, budget.trim() ? `$${budget.trim()}` : ""].filter(Boolean).join(" · ");

  return (
    <div className="ask-new">
      <ReachState ctx={ctx} />
      <ComposeBox
        id="composer-prompt"
        label="Question for the assistant"
        value={prompt}
        onChange={onPrompt}
        onSubmit={() => void submit()}
        placeholder="Ask about this plan…"
        maxLength={questionRoom(attach?.length ?? 0)}
        rows={6}
        fill
        tools={
          <>
            <ContextChip ctx={ctx} on={ctxOn} onChange={setCtxOn} unchanged={false} />
            {chosen && <Chip className="num">{chosen}</Chip>}
            <Popover iconOnly icon="settings" label="Model and spend cap" width={260}>
              <Field label="Model" htmlFor="composer-model">
                <Select id="composer-model" aria-label="Model" value={model} options={MODELS} onChange={setModel} />
              </Field>
              <Field label="Spend cap" htmlFor="composer-budget">
                <div className="input-group">
                  <input
                    id="composer-budget"
                    className="input"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={defaultCap === null ? "default" : defaultCap.toFixed(2)}
                    value={budget}
                    aria-invalid={budgetError ? true : undefined}
                    aria-describedby={budgetError ? "composer-budget-msg" : undefined}
                    onChange={(e) => {
                      setBudget(e.target.value);
                      setBudgetError(null);
                    }}
                  />
                  <span className="input-unit">USD</span>
                </div>
              </Field>
            </Popover>
          </>
        }
        actions={<IconButton icon="send" size="sm" variant="primary" label="Ask" shortcut="Ctrl+Enter" disabled={!prompt.trim() || busy} onClick={() => void submit()} />}
      />
      {budgetError && (
        <p id="composer-budget-msg" className="ask-error" role="alert">
          {budgetError}
        </p>
      )}
      {error && <ServiceNotice error={error} what="a new thread" onRetry={() => void submit()} />}
    </div>
  );
}
