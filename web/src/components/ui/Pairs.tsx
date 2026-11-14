import type { ReactNode } from "react";

export type Pair = [label: string, value: ReactNode];

export function Pairs({ rows, className }: { rows: Array<Pair | null | false | undefined>; className: string }) {
  return (
    <dl className={className}>
      {rows.map((r) =>
        r ? (
          <div key={r[0]} className={`${className}-row`}>
            <dt>{r[0]}</dt>
            <dd className="num">{r[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}
