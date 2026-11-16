import { useState } from "react";
import { budgetSpentProblem, isBudgetSpent, isCreditSpentProblem, type BudgetSpent } from "../agent/budget";
import { formatCost } from "../agent/format";
import { reportError } from "../api/client";
import { agentApi } from "../api/endpoints";
import { IconButton } from "../components/ui/Button";
import { toast } from "../state/toasts";
import { Chip } from "../workspaces/analyst/Chip";
import { useAsk } from "./askStore";
import { ComposeBox } from "./ComposeBox";
import { questionRoom, withContext } from "./contextBlock";
import { ContextChip, ReachState } from "./ContextChip";
import { CreditNotice } from "./CreditNotice";
import { useAskContext } from "./useAskContext";

interface Props {
  runId: string;
  running: boolean;
  onSent: () => void;
  costUsd: number | null | undefined;
  budgetUsd: number | null | undefined;
  text: string;
  onText: (text: string) => void;
}

export function FollowUp({ runId, running, onSent, costUsd, budgetUsd, text, onText }: Props) {
  const [busy, setBusy] = useState(false);
  const [ctxOn, setCtxOn] = useState(true);
  const [refused, setRefused] = useState<BudgetSpent | null>(null);
  const spent: BudgetSpent | null = isBudgetSpent(costUsd, budgetUsd) ? { costUsd: costUsd ?? undefined, budgetUsd: budgetUsd ?? undefined, detail: refused?.detail } : refused;
  const noCredit = useAsk((s) => s.access?.available === false);
  const closed = spent !== null || noCredit;
  const ctx = useAskContext();
  const lastSent = useAsk((s) => s.lastContext[runId]);
  const unchanged = ctx.block !== null && ctx.block === lastSent;
  const attach = ctxOn && ctx.block !== null && !unchanged ? ctx.block : null;

  const send = async () => {
    const prompt = text.trim();
    if (!prompt || busy || running || closed) return;
    setBusy(true);
    try {
      await agentApi.sendMessage(runId, withContext(prompt, attach));
      if (attach) useAsk.getState().rememberContext(runId, attach);
      onSent();
      onText("");
      setCtxOn(true);
    } catch (e) {
      const bs = budgetSpentProblem(e);
      if (bs) setRefused(bs);
      else if (isCreditSpentProblem(e)) useAsk.getState().markCreditSpent();
      else reportError(e, "Could not send the message");
    } finally {
      setBusy(false);
    }
  };

  const interrupt = async () => {
    try {
      await agentApi.interrupt(runId);
      toast({ kind: "info", title: "Stopping the answer" });
    } catch (e) {
      reportError(e, "Could not stop the answer");
    }
  };

  return (
    <div className="ask-follow">
      <ReachState ctx={ctx} />
      {noCredit && <CreditNotice />}
      <ComposeBox
        id="followup-text"
        label="Follow-up message"
        value={text}
        onChange={onText}
        onSubmit={() => void send()}
        placeholder={running ? "Answering…" : "Reply…"}
        maxLength={questionRoom(attach?.length ?? 0)}
        disabled={closed}
        tools={
          <>
            <ContextChip ctx={ctx} on={ctxOn} onChange={setCtxOn} unchanged={unchanged} />
            {spent && (
              <Chip tone="fail" icon="alert" data-testid="budget-spent">
                Spend cap reached
                <span className="num">
                  {formatCost(spent.costUsd)}
                  {spent.budgetUsd !== undefined && ` / ${formatCost(spent.budgetUsd)}`}
                </span>
              </Chip>
            )}
          </>
        }
        actions={
          <>
            {running ? (
              <IconButton icon="stop" size="sm" variant="primary" className="ask-send" label="Stop the answer" onClick={() => void interrupt()} />
            ) : (
              <IconButton icon="send" size="sm" variant="primary" className="ask-send" label="Send" shortcut="Enter" disabled={!text.trim() || busy || closed} onClick={() => void send()} />
            )}
          </>
        }
      />
      {spent?.detail && (
        <p className="ask-error" role="alert">
          {spent.detail}
        </p>
      )}
    </div>
  );
}
