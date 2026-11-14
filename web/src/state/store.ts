import { create } from "zustand";
import { clamp } from "../lib/scale";
import { MS_DAY, MS_LUNATION, STEP_MS, type StepUnit } from "../lib/time";

type Theme = "dark" | "light";

export const PLAY_SPEEDS = [60, 600, 3600, 6 * 3600, 86400, 7 * 86400] as const;
type PlaySpeed = (typeof PLAY_SPEEDS)[number];

interface TimeRange {
  start_ms: number;
  end_ms: number;
}

interface AppState {
  timeMs: number;
  bounds: TimeRange;
  range: TimeRange;
  playing: boolean;
  speed: PlaySpeed;
  showMet: boolean;
  metEpochMs: number;
  theme: Theme;
  paletteOpen: boolean;
  planCollapsed: boolean;

  setTime(ms: number): void;
  stepTime(unit: StepUnit, direction: 1 | -1): void;
  setBounds(bounds: TimeRange): void;
  setRange(range: TimeRange): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: PlaySpeed): void;
  setShowMet(show: boolean): void;
  setMetEpoch(ms: number): void;
  setTheme(theme: Theme): void;
  setPaletteOpen(open: boolean): void;
  setPlanCollapsed(collapsed: boolean): void;
}

const startOfHour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000;
const now = startOfHour(Date.now());
const yearStart = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem("lunarnav.theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
  }
  return "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

const PLAN_COLLAPSED_KEY = "lunarnav.plan.collapsed";
const PLAN_AUTO_COLLAPSE_PX = 1200;

function initialPlanCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(PLAN_COLLAPSED_KEY);
    if (stored === "1" || stored === "0") return stored === "1";
  } catch {
  }
  return window.innerWidth < PLAN_AUTO_COLLAPSE_PX;
}

const startTheme = initialTheme();
applyTheme(startTheme);

export const useApp = create<AppState>((set, get) => ({
  timeMs: now,
  bounds: { start_ms: yearStart, end_ms: yearStart + 3 * 365.25 * MS_DAY },
  range: { start_ms: now, end_ms: now + MS_LUNATION },
  playing: false,
  speed: 3600,
  showMet: false,
  metEpochMs: now,
  theme: startTheme,
  paletteOpen: false,
  planCollapsed: initialPlanCollapsed(),

  setTime: (ms) => set({ timeMs: clamp(ms, get().bounds.start_ms, get().bounds.end_ms) }),
  stepTime: (unit, direction) => get().setTime(get().timeMs + direction * STEP_MS[unit]),
  setBounds: (bounds) => set({ bounds }),
  setRange: (range) => set({ range }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setShowMet: (showMet) => set({ showMet }),
  setMetEpoch: (metEpochMs) => set({ metEpochMs }),
  setTheme: (theme) => {
    try {
      localStorage.setItem("lunarnav.theme", theme);
    } catch {
    }
    applyTheme(theme);
    set({ theme });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setPlanCollapsed: (planCollapsed) => {
    try {
      localStorage.setItem(PLAN_COLLAPSED_KEY, planCollapsed ? "1" : "0");
    } catch {
    }
    set({ planCollapsed });
  },
}));
