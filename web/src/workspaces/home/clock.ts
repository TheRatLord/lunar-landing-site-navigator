import { useEffect } from "react";
import { create } from "zustand";
import { MS_DAY } from "../../lib/time";

export interface Stay {
  start_ms: number;
  end_ms: number;
}

interface Clock {
  t_ms: number | null;
  playing: boolean;
  setPlaying(playing: boolean): void;
}

const reduced = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export const useClock = create<Clock>((set) => ({
  t_ms: null,
  playing: !reduced(),
  setPlaying: (playing) => set({ playing }),
}));

const FAR_MS = 30 * MS_DAY;
const LEAD_MS = 8 * MS_DAY;
const HOLD_S = 0.6;
const REST_S = 1.2;
const STAY_S_PER_14D = 11;
const ease = (f: number): number => (f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Phase = "travel" | "hold" | "play" | "rest";

export function useClockDriver(stay: Stay | null): void {
  const playing = useClock((s) => s.playing);
  const start = stay?.start_ms ?? null;
  const end = stay?.end_ms ?? null;
  useEffect(() => {
    if (start === null || end === null) return;
    const set = (t: number) => useClock.setState({ t_ms: t });
    const cur = useClock.getState().t_ms;
    const inside = cur !== null && cur >= start && cur <= end;
    if (!playing) {
      if (!inside) set(start);
      return;
    }
    const stayS = clamp((STAY_S_PER_14D * (end - start)) / (14 * MS_DAY), 5, 20);
    const rate = (end - start) / stayS;
    let from = cur ?? start;
    if (Math.abs(start - from) > FAR_MS) from = start - LEAD_MS;
    const travelS = clamp(0.5 + (Math.abs(start - from) / MS_DAY) * 0.04, 0.5, 1.6);
    let phase: Phase = inside ? "play" : from === start ? "hold" : "travel";
    let t = inside ? cur : from;
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      elapsed += dt;
      if (phase === "travel") {
        const f = Math.min(1, elapsed / travelS);
        t = from + (start - from) * ease(f);
        if (f >= 1) {
          phase = "hold";
          elapsed = 0;
        }
      } else if (phase === "hold") {
        t = start;
        if (elapsed >= HOLD_S) {
          phase = "play";
          elapsed = 0;
        }
      } else if (phase === "play") {
        t = Math.min(end, t + dt * rate);
        if (t >= end) {
          phase = "rest";
          elapsed = 0;
        }
      } else if (elapsed >= REST_S) {
        t = start;
        phase = "hold";
        elapsed = 0;
      }
      set(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, end, playing]);
}
