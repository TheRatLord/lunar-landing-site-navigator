import { downloadText, slug } from "../../lib/download";
import { useScenario } from "../store";

export function exportScenarioJson(): void {
  const doc = useScenario.getState().doc;
  if (doc) downloadText(`${slug(doc.name)}.scenario.json`, `${JSON.stringify(doc, null, 2)}\n`, "application/json");
}
