const PHONE = "(max-width: 759px)";

const media = (q: string) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);

export const prefersReducedMotion = (): boolean => media("(prefers-reduced-motion: reduce)")?.matches ?? false;
export const isPhoneLayout = (): boolean => media(PHONE)?.matches ?? false;
