export type ServedMarginKind = "worst_case" | "nominal" | "best_case";

export function kindWord(k: ServedMarginKind | null | undefined): "worst-case" | "nominal" | "heading unknown" | null {
  return k === "worst_case" ? "worst-case" : k === "nominal" ? "nominal" : k === "best_case" ? "heading unknown" : null;
}
