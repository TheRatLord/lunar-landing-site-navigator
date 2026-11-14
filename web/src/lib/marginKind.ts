export type ServedMarginKind = "worst_case" | "nominal" | "best_case";

export function kindWord(k: ServedMarginKind | null | undefined): "worst-case" | "nominal" | "heading unknown" | null {
  return k === "worst_case" ? "worst-case" : k === "nominal" ? "nominal" : k === "best_case" ? "heading unknown" : null;
}

export function kindMarginName(k: ServedMarginKind | null | undefined): "Worst-case margin" | "Nominal margin" | "Margin (heading unknown)" | "Margin" {
  return k === "worst_case" ? "Worst-case margin" : k === "nominal" ? "Nominal margin" : k === "best_case" ? "Margin (heading unknown)" : "Margin";
}

export function distinctKinds(kinds: Iterable<ServedMarginKind | null | undefined>): ServedMarginKind[] {
  const out: ServedMarginKind[] = [];
  for (const k of kinds) if (k && !out.includes(k)) out.push(k);
  return out;
}

export function mixedKindsNote(kinds: Iterable<ServedMarginKind | null | undefined>, orderedBy?: string): string | null {
  return distinctKinds(kinds).length > 1
    ? `Margins of different kinds are not on one scale${orderedBy ? `: ${orderedBy}` : ""}. Each row names its kind.`
    : null;
}
