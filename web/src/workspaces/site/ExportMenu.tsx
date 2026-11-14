import { SITE_ENDPOINTS, requestExport, type ExportKind, type Observer } from "../../api/site";
import { Menu, type MenuItem } from "../../components/ui/Menu";
import { downloadBlob } from "../../lib/download";
import type { Scenario } from "../../scenario/types";
import { useExportItems } from "../useExportItems";
import { fileSlug } from "./adapt";

interface ExportItem {
  kind: ExportKind;
  label: string;
}

const ITEMS: ExportItem[] = [
  { kind: "aem", label: "AEM" },
  { kind: "timeseries-csv", label: "Time series CSV" },
  { kind: "timeseries-json", label: "Time series JSON" },
  { kind: "intervals-csv", label: "Intervals CSV" },
  { kind: "metrics-csv", label: "Metrics CSV" },
  { kind: "bundle", label: "All files (zip)" },
];

export interface ExportMenuProps {
  scenario: Scenario;
  published: Set<string> | null;
  observer: Observer;
}

/** Why an export cannot run yet, as the short state shown beside it; null when the engine offers it. */
function unavailable(published: Set<string> | null, kind: ExportKind): "Checking" | "Not connected" | null {
  if (published === null) return "Checking";
  const ok = published.has(`${SITE_ENDPOINTS.exports}/{kind}`) || published.has(`${SITE_ENDPOINTS.exports}/${kind}`);
  return ok ? null : "Not connected";
}

export function ExportMenu({ scenario, published, observer }: ExportMenuProps) {
  const saveScenario = () => {
    downloadBlob(`${fileSlug(scenario.name)}.scenario.json`, new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" }));
  };

  const exports = useExportItems(
    ITEMS.map((item) => ({ ...item, hint: unavailable(published, item.kind) })),
    (item) => requestExport(item.kind, scenario, "auto", { aem_horizon: observer }),
  );

  const items: MenuItem[] = [{ id: "scenario", label: "Plan JSON", icon: "download", onSelect: saveScenario }, ...exports];

  return <Menu label="Export" icon="download" align="end" width={220} items={items} />;
}
