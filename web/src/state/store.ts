import { create } from "zustand";
import { clamp } from "../lib/scale";
import { MS_DAY, MS_LUNATION } from "../lib/time";

type Theme = "dark" | "light";

interface TimeRange {
  start_ms: number;
  end_ms: number;
}

interface AppState {
  timeMs: number;
  bounds: TimeRange;
  range: TimeRange;
  playing: boolean;
  theme: Theme;
  paletteOpen: boolean;

  setTime(ms: number): void;
  setBounds(bounds: TimeRange): void;
  setRange(range: TimeRange): void;
  setPlaying(playing: boolean): void;
  setTheme(theme: Theme): void;
  setPaletteOpen(open: boolean): void;
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

const startTheme = initialTheme();
applyTheme(startTheme);

export const useApp = create<AppState>((set, get) => ({
  timeMs: now,
  bounds: { start_ms: yearStart, end_ms: yearStart + 3 * 365.25 * MS_DAY },
  range: { start_ms: now, end_ms: now + MS_LUNATION },
  playing: false,
  theme: startTheme,
  paletteOpen: false,

  setTime: (ms) => set({ timeMs: clamp(ms, get().bounds.start_ms, get().bounds.end_ms) }),
  setBounds: (bounds) => set({ bounds }),
  setRange: (range) => set({ range }),
  setPlaying: (playing) => set({ playing }),
  setTheme: (theme) => {
    try {
      localStorage.setItem("lunarnav.theme", theme);
    } catch {
    }
    applyTheme(theme);
    set({ theme });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
