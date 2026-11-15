import { Segmented } from "../../components/ui/Segmented";
import { usePlanSearch } from "../../scenario/planSearch";
import type { Scenario } from "../../scenario/types";
import { questionOf, useQuestion, type Question } from "./question";

const OPTIONS: Array<{ value: Question; label: string; title: string }> = [
  { value: "when", label: "When to land here", title: "Which landing dates work at this site" },
  { value: "near", label: "Where nearby", title: "Which spots near this site work at the plan's landing time" },
  { value: "window", label: "Where in a window", title: "Which spots near this site work, and when, across a landing window" },
];

export function AskSwitch({ doc }: { doc: Scenario }) {
  const ask = useQuestion((s) => s.ask);
  const choose = useQuestion((s) => s.choose);
  const window = usePlanSearch((s) => s.window);
  return (
    <div className="home-ask" data-theme="dark">
      <Segmented
        size="sm"
        label="Question"
        value={questionOf(ask, window)}
        onChange={(v) => choose(v as Question, doc)}
        options={OPTIONS.map((o) => ({ value: o.value, label: <span title={o.title}>{o.label}</span> }))}
      />
    </div>
  );
}
