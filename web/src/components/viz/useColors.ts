import { useMemo } from "react";
import { useApp } from "../../state/store";
import { syncFonts, type ThemeColors } from "./draw";

export function useColors(): ThemeColors {
  const theme = useApp((s) => s.theme);
  return useMemo<ThemeColors>(() => {
    void theme;
    syncFonts();
    const cache = new Map<string, string>();
    const style = getComputedStyle(document.documentElement);
    const get = (token: string) => {
      let v = cache.get(token);
      if (v === undefined) {
        v = style.getPropertyValue(`--${token}`).trim() || "#888";
        cache.set(token, v);
      }
      return v;
    };
    return { get, station: (i) => get(`c-station-${((i % 4) + 4) % 4}`) };
  }, [theme]);
}
