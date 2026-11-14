import type { ReactNode } from "react";

export interface StatProps {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "default" | "pass" | "marginal" | "fail";
  sub?: ReactNode;
}

export function Stat({ label, value, unit, tone = "default", sub }: StatProps) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value num">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </span>
      {sub && <span className="stat-sub num">{sub}</span>}
    </div>
  );
}
