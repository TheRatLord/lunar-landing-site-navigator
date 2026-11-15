import { useEffect } from "react";

export type Mode = "planner" | "explorer";

const KEY = "lunarnav.mode";

export function lastMode(): Mode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "planner" || v === "explorer" ? v : null;
  } catch {
    return null;
  }
}

export function useRememberMode(mode: Mode | null): void {
  useEffect(() => {
    if (!mode) return;
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      return;
    }
  }, [mode]);
}
