import { useLayoutEffect, useRef, type RefObject } from "react";

export function useThumb<T extends HTMLElement>(selector: string, dep: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>(selector);
      el.style.setProperty("--thumb-x", `${on?.offsetLeft ?? 0}px`);
      el.style.setProperty("--thumb-w", `${on?.offsetWidth ?? 0}px`);
      el.dataset["thumb"] = on ? "on" : "off";
    };
    place();
    const ready = requestAnimationFrame(() => {
      el.dataset["thumbReady"] = "true";
    });
    const ro = new ResizeObserver(place);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      cancelAnimationFrame(ready);
      ro.disconnect();
    };
  }, [selector, dep]);
  return ref;
}
