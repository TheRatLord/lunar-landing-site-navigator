import type { SVGProps } from "react";

const PATHS = {
  map: "M2 3.5 6 2l4 1.5L14 2v10.5L10 14l-4-1.5L2 14zM6 2v10.5M10 3.5V14",
  site: "M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  calendar: "M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3",
  compare: "M3 13V7M8 13V3M13 13V9",
  ellipse: "M8 4c3.3 0 6 1.8 6 4s-2.7 4-6 4-6-1.8-6-4 2.7-4 6-4zM8 8h.01",
  analyst: "M3 3.5h10v7H8.5L5.5 13v-2.5H3zM5.5 6h5M5.5 8h3",
  evidence: "M4 1.5h6l3 3v10H4zM10 1.5v3h3M6 8h5M6 10.5h5",
  play: "M5 3l8 5-8 5z",
  pause: "M5 3v10M11 3v10",
  stepBack: "M10.5 3 5 8l5.5 5M3 3v10",
  stepFwd: "M5.5 3 11 8l-5.5 5M13 3v10",
  sun: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M13 3l-1.4 1.4M4.4 11.6 3 13",
  moon: "M12.5 9.5A5.5 5.5 0 0 1 6.5 3.5a5.5 5.5 0 1 0 6 6z",
  search: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.5 10.5 14 14",
  check: "M3 8.5l3.2 3L13 4.5",
  warn: "M8 2 14.5 13.5h-13zM8 6.5v3.2M8 11.6v.01",
  cross: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  chevronDown: "M3.5 6l4.5 4.5L12.5 6",
  chevronRight: "M6 3.5 10.5 8 6 12.5",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  reset: "M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3",
  command: "M5.5 3.5a2 2 0 1 0-2 2h9a2 2 0 1 0-2-2v9a2 2 0 1 0 2-2h-9a2 2 0 1 0 2 2z",
  info: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 7.2V11M8 5v.01",
  plug: "M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3",
  clock: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 4.8V8l2.2 1.5",
  stop: "M4 4h8v8H4z",
  send: "M2 8 14 2l-3.5 12-3-4.5zM7.5 9.5 14 2",
  file: "M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13",
  image: "M2 3h12v10H2zM2 11l3.5-3.5L9 11l2-2 3 3M10.5 6a1 1 0 1 0 0 .01",
  code: "M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 3l-2 10",
  shield: "M8 1.5 13.5 3.5v4.2c0 3.2-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.6-5.5-6.8V3.5z",
  copy: "M5.5 5.5h8v8h-8zM3 10.5V2.5h8",
  download: "M8 2v8M4.5 7 8 10.5 11.5 7M3 13.5h10",
  list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01",
  link: "M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8",
  panelRight: "M2 3h12v10H2zM10 3v10",
  ruler: "M1.5 10.5l9-9 4 4-9 9zM5 7l1.5 1.5M7 5l1.5 1.5M9 3l1.5 1.5",
  expand: "M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9",
  collapse: "M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  filter: "M2 3.5h12L9.5 9v4.5l-3-1.5V9z",
  layers: "M8 2 14 5.2 8 8.4 2 5.2zM2 8.2l6 3.2 6-3.2M2 11l6 3.2 6-3.2",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
  eyeOff: "M2 2l12 12M6.4 3.7a6 6 0 0 1 1.6-.2c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-2 2.6M9.6 9.6a1.8 1.8 0 0 1-3.2-3.2M4 5.4A11 11 0 0 0 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7",
  chevronLeft: "M10 3.5 5.5 8l4.5 4.5",
  chevronUp: "M3.5 10 8 5.5 12.5 10",
  external: "M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5V13H3V4h3.5",
  settings: "M6.8 1.8h2.4l.4 1.8 1.2.7 1.8-.6 1.2 2.1-1.4 1.2v1.4l1.4 1.2-1.2 2.1-1.8-.6-1.2.7-.4 1.8H6.8l-.4-1.8-1.2-.7-1.8.6-1.2-2.1 1.4-1.2V7.3L2.2 6.1l1.2-2.1 1.8.6 1.2-.7zM8 6.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z",
  sliders: "M2 4.5h7M12 4.5h2M9 3v3h3V3zM2 11.5h2M7 11.5h7M4 10v3h3v-3z",
  trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.6 9.5h6.8L12 4M6.8 6.5v4.5M9.2 6.5v4.5",
  save: "M2.5 2.5h8.5l2.5 2.5v8.5h-11zM5 2.5v3.5h5V2.5M5 13.5V9h6v4.5",
  folder: "M1.5 3.5h4.5l1.5 1.5h7v8h-13z",
  history: "M2.5 8a5.5 5.5 0 1 0 1.8-4.1M2.5 2.5v3h3M8 5v3.2l2 1.3",
  target: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 8h.01",
  pin: "M8 14.5s4.5-4.2 4.5-7.8a4.5 4.5 0 1 0-9 0c0 3.6 4.5 7.8 4.5 7.8zM8 5.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z",
  alert: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.5M8 10.8v.01",
  earth: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c2 1.8 2.8 3.8 2.8 6S10 12.2 8 14C6 12.2 5.2 10.2 5.2 8S6 3.8 8 2z",
  battery: "M1.5 5h10.5v6H1.5zM12 7h2v2h-2zM7.2 6 5.5 8.2h2.2L6.2 10",
  antenna: "M8 8v6.5M5.5 14.5h5M8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4.7 3.2a4.7 4.7 0 0 0 0 5.6M11.3 3.2a4.7 4.7 0 0 1 0 5.6",
  refresh: "M13.5 8a5.5 5.5 0 0 1-9.6 3.7M2.5 8a5.5 5.5 0 0 1 9.6-3.7M12.5 1.8v2.7H9.8M3.5 14.2v-2.7h2.7",
  share: "M11.5 5.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM4.5 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM11.5 14.1a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM6.1 7.1l4-1.9M6.1 8.9l4 1.9",
  table: "M2 3h12v10H2zM2 6.5h12M2 10h12M6.5 6.5V13",
  terrain: "M1.5 13.5 5.5 6l3 5 2-3 4 5.5z",
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
