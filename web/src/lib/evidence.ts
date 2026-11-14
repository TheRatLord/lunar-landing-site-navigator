import type { TocEntry } from "./markdown";

export const evidenceHref = (doc: string, section?: string | null) => "/evidence?doc=" + encodeURIComponent(doc) + (section ? "&section=" + encodeURIComponent(section) : "");

export function validationSourceHref(source: string): string | null {
  const m = /^\s*([A-Za-z0-9_-]+)\.md\b/.exec(source);
  if (!m) return null;
  const section = /^\s*[A-Za-z0-9_-]+\.md\b(?:\s+section\s+(.+?))?\s*$/.exec(source)?.[1];
  return evidenceHref(`validation/${m[1]}`, section);
}

const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019\u201c\u201d"\x27`*]/g, "").replace(/\s+/g, " ").trim();

export function resolveSection(section: string, toc: readonly TocEntry[]): TocEntry | null {
  const spec = section.trim();
  const quoted = /^[\x27\u2018"\u201c](.+?)[\x27\u2019"\u201d](?:\s*,.*)?$/.exec(spec);
  if (quoted) {
    const want = norm(quoted[1]!);
    return toc.find((t) => norm(t.text) === want) ?? toc.find((t) => norm(t.text).startsWith(want)) ?? null;
  }
  const num = /^(\d+(?:\.\d+)*)\b/.exec(spec);
  if (num) {
    const n = num[1]!.replace(/\./g, "\\.");
    const re = new RegExp("^(?:\u00a7\\s*)?" + n + "(?!\\d)(?:\\.(?!\\d))?(?=\\s|$|[:)])");
    return toc.find((t) => re.test(t.text.trim())) ?? null;
  }
  const want = norm(spec);
  return toc.find((t) => norm(t.text) === want) ?? null;
}
