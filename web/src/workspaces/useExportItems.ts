import { useState } from "react";
import { reportError } from "../api/client";
import type { ExportedFile } from "../api/exports";
import type { MenuItem } from "../components/ui/Menu";
import { downloadBlob } from "../lib/download";
import { toast } from "../state/toasts";

/** Menu entries that each download one export; all are disabled while one runs. */
export function useExportItems<T extends { kind: string; label: string; hint?: string | null }>(items: readonly T[], files: (item: T) => Promise<ExportedFile[]>): MenuItem[] {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (item: T) => {
    setBusy(item.kind);
    try {
      const got = await files(item);
      for (const f of got) downloadBlob(f.filename, f.blob);
      toast({
        kind: "success",
        title: `${item.label} downloaded`,
        detail: got.map((f) => f.filename + (f.sha256 ? ` · sha256 ${f.sha256.slice(0, 12)}…` : "")).join("\n"),
      });
    } catch (e) {
      reportError(e, `Could not export ${item.label}`);
    } finally {
      setBusy(null);
    }
  };
  return items.map((item) => ({
    id: item.kind,
    label: item.label,
    icon: "download",
    disabled: busy !== null || (item.hint ?? null) !== null,
    hint: item.hint ?? undefined,
    onSelect: () => void run(item),
  }));
}
