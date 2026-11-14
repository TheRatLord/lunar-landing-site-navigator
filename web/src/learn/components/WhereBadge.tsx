import { walkWords } from "../sites";

export function WhereBadge({ lat }: { lat: number }) {
  const R = 30;
  const cx = 40;
  const cy = 40;
  const y = cy - R * Math.sin((lat * Math.PI) / 180);
  const x = cx + R * 0.0 * Math.cos((lat * Math.PI) / 180);
  return (
    <figure className="l-where" aria-label={`Where am I? ${walkWords(lat)}.`}>
      <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden>
        <circle cx={cx} cy={cy} r={R} fill="#3a3b40" stroke="#8a8d94" strokeWidth="1" />
        <path d={`M${cx} ${cy - R} A${R} ${R} 0 0 1 ${cx} ${cy + R}`} fill="#9a9a9c" opacity="0.5" />
        <ellipse cx={cx} cy={cy} rx={R} ry={R * 0.22} fill="none" stroke="#c9ccd4" strokeDasharray="3 3" strokeWidth="1" />
        <line x1={cx} y1={cy - R - 6} x2={cx} y2={cy + R + 6} stroke="#c9ccd4" strokeWidth="1" opacity="0.7" />
        <path
          d={`M${cx} ${cy - R} A${R * 0.22} ${R} 0 0 1 ${cx} ${cy + R}`}
          fill="none"
          stroke="#c9ccd4"
          strokeWidth="1"
          opacity="0.5"
        />
        <circle cx={x + R * 0.22 * Math.cos((lat * Math.PI) / 180)} cy={y} r="5.5" fill="#ffc35c" stroke="#05060a" strokeWidth="1.5" />
      </svg>
      <figcaption>Where am I?</figcaption>
    </figure>
  );
}
