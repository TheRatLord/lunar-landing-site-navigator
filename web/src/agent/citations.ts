import type { SourceKind } from "../api/types";

const ID = /^[LSAFD]\d{3,6}(?:#[A-Za-z0-9_.:/-]{1,80})?$/;
const TAG = /\[([^[\]\n]{1,100})\]/g;

export type CitationTarget = "ledger" | "assumption" | "artifact";

export function citationTarget(id: string): CitationTarget | undefined {
  switch (id[0]) {
    case "L":
    case "S":
      return "ledger";
    case "A":
      return "assumption";
    case "F":
      return "artifact";
    default:
      return undefined;
  }
}

function parseCitation(token: string): { id: string; row: string | null } {
  const [id = "", ...rest] = token.split("#");
  return { id, row: rest.length > 0 ? rest.join("#") : null };
}

export function citationHref(token: string): string {
  const { id, row } = parseCitation(token);
  return `#${citationTarget(id) ?? "cite"}-${id}${row === null ? "" : `/${row}`}`;
}

export type CitationPart = { kind: "text"; text: string } | { kind: "cite"; id: string } | { kind: "flag"; text: string };

export function splitCitations(text: string): CitationPart[] {
  const out: CitationPart[] = [];
  let last = 0;
  const push = (s: string) => {
    if (s === "") return;
    const prev = out[out.length - 1];
    if (prev?.kind === "text") prev.text += s;
    else out.push({ kind: "text", text: s });
  };
  for (const m of text.matchAll(TAG)) {
    const tokens = m[1]!.split(/[,;\s]+/).filter(Boolean);
    const ok = tokens.length > 0 && tokens.every((t) => ID.test(t) || /^(u|user|unverified|illustrative)$/i.test(t));
    if (!ok) continue;
    push(text.slice(last, m.index));
    push("[");
    for (const piece of m[1]!.match(/[^\s,;]+|[\s,;]+/g) ?? []) {
      if (ID.test(piece)) out.push({ kind: "cite", id: piece });
      else if (/^[^\s,;]+$/.test(piece)) out.push({ kind: "flag", text: piece });
      else push(piece);
    }
    push("]");
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}

export const SOURCE_LABEL: Record<SourceKind, string> = {
  engine_result: "engine result",
  input: "tool input",
  script_value: "script-reported value",
  assumption: "assumption",
  document: "your document",
  user_request: "your request",
};
