import { downloadText, slug } from "../../lib/download";
import { currentSearch } from "../planSearch";
import { useScenario } from "../store";

export function exportScenarioJson(): void {
  const doc = useScenario.getState().doc;
  if (doc) downloadText(`${slug(doc.name)}.plan.json`, `${JSON.stringify({ document: doc, search: currentSearch() }, null, 2)}\n`, "application/json");
}
