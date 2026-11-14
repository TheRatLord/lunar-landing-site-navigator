export type HrefClass =
  | { kind: "external"; href: string }
  | { kind: "fragment"; href: string }
  | { kind: "relative"; href: string }
  | { kind: "blocked" };

export function classifyHref(href: string): HrefClass {
  const h = href.trim();
  if (h === "" || [...h].some((c) => c.charCodeAt(0) < 32)) return { kind: "blocked" };
  if (h.startsWith("#")) return { kind: "fragment", href: h };
  if (h.startsWith("//") || h.startsWith("\\")) return { kind: "blocked" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
    try {
      const u = new URL(h);
      return u.protocol === "http:" || u.protocol === "https:" ? { kind: "external", href: u.href } : { kind: "blocked" };
    } catch {
      return { kind: "blocked" };
    }
  }
  return { kind: "relative", href: h };
}

const isSameOriginPath = (url: string): boolean => url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");

export function imageSource(src: string, resolveImage: ((src: string) => string) | undefined): string | null {
  if (!resolveImage) return null;
  const resolved = resolveImage(src);
  return isSameOriginPath(resolved) ? resolved : null;
}
