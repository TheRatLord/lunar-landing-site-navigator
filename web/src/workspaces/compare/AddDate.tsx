import { useId, useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { MS_HOUR } from "../../lib/time";
import { isYear, usePlanSearch } from "../../scenario/planSearch";
import { addDelays } from "./delays";
import { useCompareOptions } from "./options";

export function AddDate({ plannedMs }: { plannedMs: number | null }) {
  const slips = useCompareOptions((s) => s.slips_h);
  const setSlips = useCompareOptions((s) => s.setSlips);
  const landingWindow = usePlanSearch((s) => s.window);
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
        const outside = landingWindow && !isYear(landingWindow) && plannedMs !== null && r.hours.filter((h) => !slips.includes(h)).every((h) => plannedMs + h * MS_HOUR < landingWindow.first_ms || plannedMs + h * MS_HOUR > landingWindow.last_ms);
        if (outside) return setError("Outside the landing window");
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
        placeholder="10 d or 20 Mar 2027"
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
