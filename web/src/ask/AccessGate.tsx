import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { agentApi } from "../api/endpoints";
import { Button, IconButton } from "../components/ui/Button";
import { Field } from "../components/ui/Fields";
import { Toolstrip } from "../components/ui/Toolstrip";
import { useAsk } from "./askStore";

export function AccessGate() {
  const { open, mode } = useAsk();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      useAsk.getState().setAccess(await agentApi.unlock(code.trim()));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(status === 403 ? "That code isn't recognised." : status === 429 ? "Too many tries. Wait a minute and try again." : "Could not check the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ask-dock" id="ask-dock" tabIndex={-1} role="complementary" data-mode={mode} hidden={!open} aria-label="Ask">
      <div className="ask-bar">
        <h2 className="ask-title">Ask</h2>
        <span className="grow" />
        <Toolstrip>
          <IconButton icon="close" size="sm" label="Close Ask" shortcut="Alt+A" onClick={() => useAsk.getState().setOpen(false)} />
        </Toolstrip>
      </div>
      <form className="analyst-center" onSubmit={submit}>
        <p>The assistant is open to invited reviewers. Enter your access code to use it.</p>
        <Field label="Access code" htmlFor="ask-access-code" error={error}>
          <input
            id="ask-access-code"
            className="input"
            type="password"
            autoComplete="off"
            maxLength={200}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-describedby={error ? "ask-access-code-msg" : undefined}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={busy || !code.trim()}>
            Unlock
          </Button>
        </div>
      </form>
    </section>
  );
}
