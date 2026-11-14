import { useRef, useState, type ChangeEvent } from "react";
import { inboxApi, type InboxEntry, type InboxList } from "../../agent/api";
import { failureText, formatBytes } from "../../agent/format";
import { INBOX_EXTENSIONS, inboxExtensionError } from "../../agent/inbox";
import { ApiError } from "../../api/client";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Popover } from "../../components/ui/Popover";
import { Spinner } from "../../components/ui/Progress";
import { toast } from "../../state/toasts";
import { CopyHash, State, type LedgerPanelProps } from "./LedgerPanels";
import { useLedger } from "./useLedger";

function InboxView({ data, sourceNames, focusName }: { data: InboxList; sourceNames: Readonly<Record<string, string>>; focusName: string | null }) {
  return (
    <ul className="led-list">
      {data.files.map((f) => {
        const source = sourceNames[f.name];
        return (
          <li key={f.name} className={`led-item ${focusName === f.name ? "is-focus" : ""}`}>
            <header className="led-head">
              <Icon name="file" size={13} />
              <span className="art-path">{f.name}</span>
              <span className="grow" />
              <span className="faint num">{formatBytes(f.size_bytes)}</span>
            </header>
            {source && source !== f.name && (
              <p className="led-desc mono">
                {source} → {f.name}
              </p>
            )}
            <p className="led-desc faint mono">{f.path}</p>
            <div className="led-digests">
              <code className="hash-full" data-testid="inbox-sha256">
                {f.sha256}
              </code>
              <CopyHash value={f.sha256} label="file digest" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function InboxPanel({ runId, revision, focusId }: LedgerPanelProps) {
  const ledger = useLedger<InboxList>(runId, revision, inboxApi.list);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");

  const onPick = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    const bad = inboxExtensionError(file.name);
    if (bad) {
      setProblem(bad);
      return;
    }
    setBusy(true);
    setProblem(null);
    let stored: InboxEntry;
    try {
      stored = await inboxApi.upload(runId, file);
    } catch (e) {
      setProblem(failureText(e, "Could not upload the file."));
      setBusy(false);
      return;
    }
    setBusy(false);
    setSourceNames((m) => ({ ...m, [stored.name]: stored.source_name ?? file.name }));
    setAnnouncement(`${stored.name} added to the inbox. SHA-256 ${stored.sha256}.`);
    toast({ kind: "success", title: `Added ${stored.name} to the inbox` }, 2500);
    ledger.reload();
  };

  return (
    <div className="led">
      {!(ledger.error instanceof ApiError && ledger.error.status === 409) && (
      <div className="inbox-add">
        <input ref={input} className="sr-only" aria-label="Choose a file to add to the inbox" type="file" accept={INBOX_EXTENSIONS.join(",")} onChange={onPick} disabled={busy} tabIndex={-1} />
        <Button size="sm" icon="plus" disabled={busy} onClick={() => input.current?.click()}>
          Add file
        </Button>
        <Popover label="File types" align="start" width={220}>
          <p className="inbox-types mono">{INBOX_EXTENSIONS.join(" ")}</p>
        </Popover>
        {busy && <Spinner size={12} label="Uploading" />}
        {problem && (
          <p className="field-msg error" role="alert">
            {problem}
          </p>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
      )}
      <State ledger={ledger} what="the inbox" empty="No files yet" emptyIcon="file" count={(d) => d.files.length}>
        {(d) => <InboxView data={d} sourceNames={sourceNames} focusName={focusId} />}
      </State>
    </div>
  );
}
