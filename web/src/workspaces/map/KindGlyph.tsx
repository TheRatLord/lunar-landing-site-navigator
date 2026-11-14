import { KIND_STYLE, type Shape, type SiteKind } from "./sites";

const SHAPES: Record<Shape, string> = {
  triangle: "M8 2 14 13H2z",
  diamond: "M8 1.5 14.5 8 8 14.5 1.5 8z",
  square: "M3 3h10v10H3z",
  cross: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  ring: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z",
  dot: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
};

export function KindGlyph({ kind, hollow, size = 14 }: { kind: SiteKind; hollow?: boolean; size?: number }) {
  const st = KIND_STYLE[kind];
  const line = st.shape === "cross" || st.shape === "ring";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="map-glyph" style={{ color: `var(--${st.token})` }}>
      <path d={SHAPES[st.shape]} fill={hollow || line ? "none" : "currentColor"} stroke="currentColor" strokeWidth={st.shape === "cross" ? 2.2 : 1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
