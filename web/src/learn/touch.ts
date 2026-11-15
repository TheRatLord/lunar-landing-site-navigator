import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

const query = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(QUERY) : null);

const subscribe = (cb: () => void) => {
  const m = query();
  m?.addEventListener("change", cb);
  return () => m?.removeEventListener("change", cb);
};

export function useIsTouch(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false);
}
