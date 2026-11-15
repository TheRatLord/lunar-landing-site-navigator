import { useId, useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { addDelays } from "./delays";
import { useCompareOptions } from "./options";

export function AddDate({ plannedMs }: { plannedMs: number | null }) {
  const slips = useCompareOptions((s) => s.slips_h);
  const setSlips = useCompareOptions((s) => s.setSlips);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  return (
    <form
      className="cmp-add-date"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() === "") return;
        const r = addDelays(slips, text, plannedMs);
        if (!r.ok) return setError(r.error);
        setSlips(r.hours);
        setText("");
        setError(null);
      }}
    >
      <input
        className="input num cmp-add-date-input"
        aria-label="Add date"
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        placeholder="Add date: 10 d or 2027-03-20 06:00"
        spellCheck={false}
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      <IconButton type="submit" icon="plus" size="sm" variant="default" label="Add date" />
      {error && (
        <span className="cmp-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
