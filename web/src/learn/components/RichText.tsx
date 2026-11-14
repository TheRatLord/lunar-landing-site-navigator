import type { ReactNode } from "react";
import type { ChapterSlug } from "../chapters";
import { TERM_RE, TERMS, type TermId } from "../glossary";
import { useLearn } from "../store";
import { Term } from "./Term";

export function RichText({ text, slug }: { text: string; slug: ChapterSlug }) {
  const termHome = useLearn((s) => s.termHome);
  const out: ReactNode[] = [];
  const used = new Set<string>();
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TERM_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const id = m[1] as TermId;
    const label = m[2] ?? TERMS[id]?.word ?? id;
    const live = id in TERMS && termHome[id] === slug && !used.has(id);
    used.add(id);
    out.push(
      live ? (
        <Term key={k++} id={id}>
          {label}
        </Term>
      ) : (
        label
      ),
    );
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
