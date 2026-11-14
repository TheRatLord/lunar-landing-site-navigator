import { useId, useRef, useState, type FormEvent } from "react";
import { assumptionApi, type AssumptionItem, type AssumptionList, type SignoffRequest } from "../../agent/api";
import { basisLabel, failureText } from "../../agent/format";
import { isInputGroup, parseInputGroup } from "../../agent/typedInputs";
import { STATUS_LABEL, summariseAssumptions, validateSignoff, type SignoffDraft, type SignoffErrors } from "../../agent/signoff";
import { toMs } from "../../api/types";
import { Button } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { Icon, type IconName } from "../../components/ui/Icon";
import { formatUtc } from "../../lib/time";
import { Ids } from "./AttachedLimits";
import { Chip, type ChipTone } from "./Chip";
import { ChainBanner, State, type LedgerPanelProps } from "./LedgerPanels";
import { useLedger, useScrollWhen } from "./useLedger";

const STATUS_TAG: Record<AssumptionItem["status"], { tone: ChipTone; icon: IconName | null }> = {
  pending: { tone: "marginal", icon: "warn" },
  accepted: { tone: "pass", icon: "check" },
  rejected: { tone: "fail", icon: "cross" },
  not_required: { tone: "default", icon: null },
};

function StatusTag({ status }: { status: AssumptionItem["status"] }) {
  const t = STATUS_TAG[status];
  return (
    <Chip tone={t.tone} {...(t.icon ? { icon: t.icon } : {})}>
      {STATUS_LABEL[status]}
    </Chip>
  );
}

const FIELD_ORDER = ["decision", "who", "note"] as const;

interface SignoffFormProps {
  assumptionId: string;
  defaultWho: string;
  initialDecision?: SignoffRequest["decision"];
  onSubmit: (body: SignoffRequest) => Promise<void>;
  onCancel: () => void;
}

function SignoffForm({ assumptionId, defaultWho, initialDecision, onSubmit, onCancel }: SignoffFormProps) {
  const uid = useId();
  const [draft, setDraft] = useState<SignoffDraft>({ decision: initialDecision ?? "", who: defaultWho, note: "" });
  const [errors, setErrors] = useState<SignoffErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const decisionRef = useRef<HTMLInputElement>(null);
  const whoRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const id = (f: string) => `${uid}-${f}`;
  const describedBy = (f: keyof SignoffErrors) => (errors[f] ? id(`${f}-err`) : undefined);
  const message = (f: keyof SignoffErrors) =>
    errors[f] && (
      <p id={id(`${f}-err`)} className="field-msg error">
        {errors[f]}
      </p>
    );

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const found = validateSignoff(draft);
    setErrors(found);
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) {
      ({ decision: decisionRef, who: whoRef, note: noteRef })[first].current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit({ decision: draft.decision as SignoffRequest["decision"], who: draft.who.trim(), note: draft.note.trim() });
    } catch (e) {
      setFailure(failureText(e, "Could not record the sign-off."));
      setBusy(false);
    }
  };

  return (
    <form className="signoff" noValidate onSubmit={submit} aria-label={`Sign-off for ${assumptionId}`}>
      <fieldset className="signoff-decision" aria-describedby={describedBy("decision")}>
        <legend className="sr-only">Decision</legend>
        <label className={`signoff-choice ${draft.decision === "accepted" ? "is-on is-accept" : ""}`}>
          <input ref={decisionRef} type="radio" name={id("decision")} value="accepted" checked={draft.decision === "accepted"} aria-invalid={Boolean(errors.decision)} onChange={() => setDraft({ ...draft, decision: "accepted" })} />
          <Icon name="check" size={12} /> Accept
        </label>
        <label className={`signoff-choice ${draft.decision === "rejected" ? "is-on is-reject" : ""}`}>
          <input type="radio" name={id("decision")} value="rejected" checked={draft.decision === "rejected"} aria-invalid={Boolean(errors.decision)} onChange={() => setDraft({ ...draft, decision: "rejected" })} />
          <Icon name="cross" size={12} /> Reject
        </label>
        {message("decision")}
      </fieldset>
      <div className="field">
        <label className="sr-only" htmlFor={id("who")}>
          Who decides
        </label>
        <input
          ref={whoRef}
          id={id("who")}
          className="input"
          value={draft.who}
          autoComplete="name"
          placeholder="Name or role"
          aria-required="true"
          aria-invalid={Boolean(errors.who)}
          aria-describedby={describedBy("who")}
          onChange={(e) => setDraft({ ...draft, who: e.target.value })}
        />
        {message("who")}
      </div>
      <div className="field">
        <label className="sr-only" htmlFor={id("note")}>
          Reason
        </label>
        <textarea
          ref={noteRef}
          id={id("note")}
          className="signoff-note"
          rows={3}
          placeholder="Reason"
          value={draft.note}
          aria-required="true"
          aria-invalid={Boolean(errors.note)}
          aria-describedby={describedBy("note")}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
        {message("note")}
      </div>
      {failure && (
        <p className="field-msg error" role="alert">
          {failure}
        </p>
      )}
      <div className="signoff-actions">
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          {busy ? "Recording…" : "Record decision"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function InputsTable({ statement }: { statement: string }) {
  const g = parseInputGroup(statement);
  if (!g) return <p className="led-statement ev-limit-text">{statement}</p>;
  return (
    <>
      <p className="led-statement">{g.intro}</p>
      <ul className="ev-inputs" data-testid="inputs-table">
        {g.lines.map((l) => (
          <li key={l.path} data-quoted={l.quoted ? "yes" : "no"}>
            <span className="mono ev-inputs-path">{l.path}</span>
            <span className="mono">{l.value}</span>
            <span className="mono faint">← {l.replaced}</span>
            {l.quoted ? <span className="faint ev-inputs-quote">{l.evidence.replace(/^your request contains /, "")}</span> : <Chip>Not quoted</Chip>}
          </li>
        ))}
      </ul>
      {g.other.length > 0 && <p className="ev-limit-text">{g.other.join("\n")}</p>}
    </>
  );
}

interface RowProps {
  a: AssumptionItem;
  focused: boolean;
  defaultWho: string;
  onSignoff: (id: string, body: SignoffRequest) => Promise<void>;
  onOpenLedger: (ledgerId: string) => void;
}

function AssumptionRow({ a, focused, defaultWho, onSignoff, onOpenLedger }: RowProps) {
  const ref = useScrollWhen(focused);
  const [form, setForm] = useState<SignoffRequest["decision"] | "open" | null>(null);
  const decided = a.signoffs.length > 0;
  const rejected = a.status === "rejected";
  return (
    <li
      ref={ref}
      id={`assumption-${a.assumption_id}`}
      className={`led-item ${focused ? "is-focus" : ""} ${a.status === "pending" ? "needs-signoff" : ""} ${rejected ? "is-error" : ""}`}
    >
      <header className="led-head">
        <span className="led-id">{a.assumption_id}</span>
        <StatusTag status={a.status} />
        {rejected && (
          <Chip tone="fail" icon="shield" role="note">
            Blocking
          </Chip>
        )}
      </header>
      {isInputGroup(a) ? <InputsTable statement={a.statement} /> : <p className="led-statement">{a.statement}</p>}
      {a.used_by.length > 0 && (
        <p className="led-used-line">
          <span className="faint">Used by</span>
          <Ids ids={a.used_by} onOpen={onOpenLedger} className="ev-link led-used" />
        </p>
      )}
      <Disclosure title="Basis and impact">
        <dl className="ev-kv">
          <dt>Basis</dt>
          <dd>{basisLabel(a.basis)}</dd>
          <dt>Impact</dt>
          <dd>{a.impact}</dd>
        </dl>
      </Disclosure>
      {decided && (
        <ol className="led-signoffs" aria-label="Sign-off history">
          {a.signoffs.map((s, i) => {
            const ms = toMs(s.ts);
            return (
              <li key={i}>
                <Chip tone={s.decision === "accepted" ? "pass" : "fail"}>{s.decision === "accepted" ? "Accepted" : "Rejected"}</Chip>
                <span>{s.who}</span>
                {ms !== undefined && <span className="faint num">{formatUtc(ms, { seconds: true })}</span>}
                <div className="dim led-signoff-note">{s.note}</div>
              </li>
            );
          })}
        </ol>
      )}
      {a.needs_signoff &&
        (form !== null ? (
          <SignoffForm
            assumptionId={a.assumption_id}
            defaultWho={defaultWho}
            {...(form !== "open" ? { initialDecision: form } : {})}
            onCancel={() => setForm(null)}
            onSubmit={async (body) => {
              await onSignoff(a.assumption_id, body);
              setForm(null);
            }}
          />
        ) : decided ? (
          <div className="signoff-actions">
            <Button size="sm" aria-label={`Change decision on ${a.assumption_id}`} onClick={() => setForm("open")}>
              Change decision
            </Button>
          </div>
        ) : (
          <div className="signoff-actions">
            <Button size="sm" icon="check" aria-label={`Accept ${a.assumption_id}`} onClick={() => setForm("accepted")}>
              Accept
            </Button>
            <Button size="sm" icon="cross" aria-label={`Reject ${a.assumption_id}`} onClick={() => setForm("rejected")}>
              Reject
            </Button>
          </div>
        ))}
    </li>
  );
}

export function AssumptionsPanel({ runId, revision, focusId, onOpenLedger }: LedgerPanelProps & { onOpenLedger: (ledgerId: string) => void }) {
  const ledger = useLedger<AssumptionList>(runId, revision, assumptionApi.list);
  const [who, setWho] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const sign = async (id: string, body: SignoffRequest) => {
    await assumptionApi.signoff(runId, id, body);
    setWho(body.who);
    setAnnouncement(`Assumption ${id} ${body.decision} by ${body.who}.`);
    ledger.reload();
  };

  return (
    <div className="led">
      <State ledger={ledger} what="assumptions" empty="No assumptions" emptyIcon="list" count={(d) => d.assumptions.length}>
        {(d) => {
          const s = summariseAssumptions(d.assumptions);
          return (
            <>
              <div className="ev-chain" data-testid="assumption-summary">
                <Chip className="num">{s.total}</Chip>
                {(
                  [
                    ["marginal", s.pending, "pending"],
                    ["pass", s.accepted, "accepted"],
                    ["fail", s.rejected, "rejected"],
                  ] as const
                ).map(([tone, n, what]) =>
                  n > 0 ? (
                    <Chip key={what} tone={tone} className="num">
                      {n} {what}
                    </Chip>
                  ) : null,
                )}
                <ChainBanner chain={d.chain} />
              </div>
              <p className="sr-only" role="status" aria-live="polite">
                {announcement}
              </p>
              <ul className="led-list">
                {d.assumptions.map((a) => (
                  <AssumptionRow key={a.assumption_id} a={a} focused={focusId === a.assumption_id} defaultWho={who} onSignoff={sign} onOpenLedger={onOpenLedger} />
                ))}
              </ul>
            </>
          );
        }}
      </State>
    </div>
  );
}
