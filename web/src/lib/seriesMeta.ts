const int = (n: number): string => n.toLocaleString("en-US");

export interface DecimationFields {
  decimated: boolean;
  n_returned: number;
  n_total?: number;
  decimation?: string;
}

export function decimationNote(m: DecimationFields | null | undefined): string | null {
  if (!m || !m.decimated) return null;
  const of = m.n_total !== undefined ? ` of ${int(m.n_total)}` : "";
  const how = m.decimation ? `; engine: ${m.decimation}` : "";
  return `Thinned by the engine: ${int(m.n_returned)}${of} samples returned${how}.`;
}
