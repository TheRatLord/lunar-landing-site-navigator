import { useSyncExternalStore } from "react";

const PHONE = "(max-width: 759px)";

const media = (q: string) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);

const subPhone = (cb: () => void) => {
  const m = media(PHONE);
  m?.addEventListener("change", cb);
  return () => m?.removeEventListener("change", cb);
};

export const prefersReducedMotion = (): boolean => media("(prefers-reduced-motion: reduce)")?.matches ?? false;
export const isPhoneLayout = (): boolean => media(PHONE)?.matches ?? false;

export function useIsPhone(): boolean {
  return useSyncExternalStore(subPhone, isPhoneLayout, () => false);
}
