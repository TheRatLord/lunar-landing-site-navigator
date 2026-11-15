export type TermId =
  | "near-side"
  | "far-side"
  | "wobble"
  | "crater"
  | "rim"
  | "eclipse";

export const TERMS: Record<TermId, { word: string; meaning: string }> = {
  "near-side": { word: "near side", meaning: "The half of the Moon that always faces Earth." },
  "far-side": { word: "far side", meaning: "The half of the Moon that never faces Earth." },
  wobble: {
    word: "wobble",
    meaning: "A slow rocking of the Moon that makes Earth sway a little in its sky.",
  },
  crater: { word: "crater", meaning: "A bowl punched into the ground by a space rock." },
  rim: { word: "rim", meaning: "The raised edge of a crater." },
  eclipse: { word: "eclipse", meaning: "When one world blocks the Sun's light from another." },
};

export const TERM_RE = /\{([a-z-]+)(?:\|([^}]+))?\}/g;

export function termsIn(text: string): TermId[] {
  const out: TermId[] = [];
  for (const m of text.matchAll(TERM_RE)) {
    const id = m[1] as TermId;
    if (id in TERMS && !out.includes(id)) out.push(id);
  }
  return out;
}
