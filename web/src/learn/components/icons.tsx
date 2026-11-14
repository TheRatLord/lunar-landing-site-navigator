import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
});

const RAYS = "M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5";

export function SunIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="4.4" fill="currentColor" />
      <path d={RAYS} />
    </svg>
  );
}

export function NightIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="6" strokeDasharray="2.6 2.4" />
      <path d="M3 18.5h18" />
    </svg>
  );
}

export function BehindHillIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="13" cy="10" r="4.2" fill="currentColor" />
      <path d="M2.5 19.5 9 11l4 4.5 2.5-2.5 6 6.5z" fill="var(--panel)" />
    </svg>
  );
}

export function EclipseIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d={RAYS} />
      <circle cx="12" cy="12" r="5" fill="currentColor" />
      <circle cx="13.6" cy="11" r="4.6" fill="var(--text)" stroke="var(--panel)" strokeWidth="1.2" />
    </svg>
  );
}

export function PeekIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M7 16a5 5 0 0 1 10 0" fill="currentColor" />
      <path d="M12 5.5v2.2M5.3 9.3l1.5 1.5M18.7 9.3l-1.5 1.5M2.5 16h19" />
    </svg>
  );
}

export function GlobeIcon({ size, hollow, ...p }: P & { hollow?: boolean }) {
  return (
    <svg {...base(size)} {...p}>
      <circle
        cx="12"
        cy="12"
        r="8"
        fill={hollow ? "none" : "currentColor"}
        fillOpacity={hollow ? 0 : 0.22}
        strokeDasharray={hollow ? "2.6 2.4" : undefined}
      />
      {!hollow && <path d="M4.5 9.5h15M4.5 14.5h15M12 4c-3 3.5-3 12.5 0 16M12 4c3 3.5 3 12.5 0 16" strokeWidth="1.3" />}
    </svg>
  );
}

export function BatteryIcon({ segments, size = 30, ...p }: P & { segments: number }) {
  return (
    <svg {...base(size)} viewBox="0 0 30 24" {...p}>
      <rect x="1.5" y="6" width="24" height="12" rx="2.5" />
      <path d="M27.5 10v4" strokeWidth="2.2" />
      {Array.from({ length: 5 }, (_, i) => (
        <rect
          key={i}
          x={3.8 + i * 4.3}
          y="8.3"
          width="3.3"
          height="7.4"
          rx="0.8"
          fill={i < segments ? "currentColor" : "none"}
          stroke={i < segments ? "none" : "currentColor"}
          strokeOpacity={0.3}
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

export function PlayIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <rect x="6.5" y="5.5" width="3.8" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.7" y="5.5" width="3.8" height="13" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.4} {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function SunriseIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M7 17a5 5 0 0 1 10 0" fill="currentColor" fillOpacity="0.9" />
      <path d="M3 17h18M12 3.5v5M9.5 6 12 3.5 14.5 6" />
    </svg>
  );
}

export function SunsetIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M7 17a5 5 0 0 1 10 0" fill="currentColor" fillOpacity="0.4" />
      <path d="M3 17h18M12 3.5v5M9.5 6 12 8.5 14.5 6" />
    </svg>
  );
}

export function LanderIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M8 6h8l1.5 6h-11z" fill="currentColor" fillOpacity="0.25" />
      <path d="M6.5 12 4 19M17.5 12 20 19M2.5 19h3M18.5 19h3M12 12v4M10 16h4M12 6V3.5" />
    </svg>
  );
}

export function ArrowLeftIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function ArrowRightIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowDownIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M12 4v15M6 13l6 6 6-6" />
    </svg>
  );
}

export function ArrowUpIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M12 20V5M6 11l6-6 6 6" />
    </svg>
  );
}

export function InfoIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.1" strokeWidth="2.2" />
    </svg>
  );
}

export function CrosshairIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </svg>
  );
}

export function MoonMark({ size = 26, ...p }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable={false} {...p}>
      <circle cx="16" cy="16" r="13" fill="var(--text-3)" opacity="0.35" />
      <path d="M16 3a13 13 0 0 1 0 26z" fill="var(--text)" />
      <circle cx="21" cy="11" r="2.2" fill="var(--text-3)" opacity="0.6" />
      <circle cx="19.5" cy="20" r="3" fill="var(--text-3)" opacity="0.5" />
    </svg>
  );
}

export function CloseIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
