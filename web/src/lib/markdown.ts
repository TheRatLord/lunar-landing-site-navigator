import GithubSlugger from "github-slugger";

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

export function extractToc(source: string): TocEntry[] {
  const slugger = new GithubSlugger();
  const out: TocEntry[] = [];
  let fence: string | null = null;
  for (const line of source.split("\n")) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1]!;
      else if (f[1]!.startsWith(fence[0]!)) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*+/g, "").replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, "");
    out.push({ level: m[1]!.length, text, id: slugger.slug(text) });
  }
  return out;
}

export function resolveRelative(docPath: string, ref: string): string | null {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
  const clean = ref.split(/[?#]/, 1)[0] ?? "";
  const parts = docPath.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
