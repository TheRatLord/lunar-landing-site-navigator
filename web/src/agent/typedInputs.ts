interface InputLine {
  path: string;
  value: string;
  replaced: string;
  evidence: string;
  quoted: boolean;
}

export interface InputGroup {
  intro: string;
  lines: InputLine[];
  other: string[];
}

const LINE = /^(\S+) = (.*?) \(replaced (.*); set by the assistant; (your request contains '.*'|not found in your request)\)$/s;

const INTRO = "Inputs as the assistant set them in ";

export const isInputGroup = (a: { assumption_id: string; statement: string }) => a.assumption_id.startsWith("set:") || a.statement.startsWith(INTRO);

export function parseInputGroup(statement: string): InputGroup | null {
  const [intro, ...rest] = statement.split("\n");
  const lines: InputLine[] = [];
  const other: string[] = [];
  for (const raw of rest) {
    if (!raw.trim()) continue;
    const m = raw.startsWith("- ") ? LINE.exec(raw.slice(2)) : null;
    if (m) lines.push({ path: m[1]!, value: m[2]!, replaced: m[3]!, evidence: m[4]!, quoted: m[4]!.startsWith("your request contains") });
    else other.push(raw);
  }
  return lines.length > 0 ? { intro: intro ?? "", lines, other } : null;
}

export type LimitPiece = { text: string } | { ledgerId: string };

const REFS = / \[((?:[A-Z]\d+)(?:, [A-Z]\d+)*)\]$/;

export function splitLimitRefs(text: string): LimitPiece[] {
  const out: LimitPiece[] = [];
  let plain = "";
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const nl = i < lines.length - 1 ? "\n" : "";
    const m = REFS.exec(line);
    if (!m) {
      plain += line + nl;
      return;
    }
    plain += `${line.slice(0, m.index)} [`;
    m[1]!.split(", ").forEach((id, j) => {
      if (j > 0) plain += ", ";
      out.push({ text: plain }, { ledgerId: id });
      plain = "";
    });
    plain += `]${nl}`;
  });
  if (plain) out.push({ text: plain });
  return out;
}
