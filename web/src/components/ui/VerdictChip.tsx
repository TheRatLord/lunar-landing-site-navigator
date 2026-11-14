import type { Verdict } from "../../contract/types";
import { formatNum, formatSignedValue, formatValue } from "../../lib/format";
import { VERDICT_LABEL } from "../../lib/verdict";
import { Icon } from "./Icon";

const GLYPH = { pass: "check", marginal: "warn", fail: "cross" } as const;

export interface VerdictChipProps {
  verdict: Verdict;
  value?: number;
  limit?: number;
  margin?: number;
  unit?: string;
  decimals?: number;
  sense?: "min" | "max";
  compact?: boolean;
}

export function VerdictChip({ verdict, value, limit, margin, unit, decimals = 2, sense, compact }: VerdictChipProps) {
  const hasNumbers = !compact && value !== undefined && limit !== undefined;
  const summary =
    `${VERDICT_LABEL[verdict]}` +
    (hasNumbers
      ? `: ${formatValue(value!, unit, decimals)}, required ${sense === "min" ? "at least" : sense === "max" ? "at most" : ""} ${formatValue(limit!, unit, decimals)}`
      : "") +
    (margin !== undefined && !compact ? `, margin ${formatSignedValue(margin, unit, decimals)}` : "");
  return (
    <span className={`chip chip-verdict chip-${verdict}`} role="status" aria-label={summary}>
      <Icon name={GLYPH[verdict]} size={12} strokeWidth={2} />
      <span className="chip-label">{VERDICT_LABEL[verdict]}</span>
      {hasNumbers && (
        <span className="chip-nums num" aria-hidden="true">
          <span>{formatNum(value!, decimals)}</span>
          <span className="chip-sep">{sense === "min" ? "≥" : sense === "max" ? "≤" : "vs"}</span>
          <span>{formatNum(limit!, decimals)}</span>
          {unit && <span className="chip-unit">{unit}</span>}
        </span>
      )}
      {margin !== undefined && !compact && (
        <span className="chip-margin num" aria-hidden="true">
          {formatSignedValue(margin, unit, decimals)}
        </span>
      )}
    </span>
  );
}
