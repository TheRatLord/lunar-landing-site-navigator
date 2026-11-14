export type TermId =
  | "horizon"
  | "orbit"
  | "axis"
  | "tilt"
  | "lunar-day"
  | "near-side"
  | "far-side"
  | "wobble"
  | "crater"
  | "rim"
  | "shadow"
  | "eclipse"
  | "solar-panel"
  | "relay-satellite"
  | "lander";

export const TERMS: Record<TermId, { word: string; meaning: string }> = {
  horizon: { word: "horizon", meaning: "The line where the ground meets the sky." },
  orbit: { word: "orbit", meaning: "The path one object takes around another." },
  axis: { word: "axis", meaning: "The imaginary pole a world spins around." },
  tilt: { word: "tilt", meaning: "How far that pole leans over." },
  "lunar-day": { word: "lunar day", meaning: "One full turn of day and night on the Moon, about 29.5 Earth days." },
  "near-side": { word: "near side", meaning: "The half of the Moon that always faces Earth." },
  "far-side": { word: "far side", meaning: "The half of the Moon that never faces Earth." },
  wobble: {
    word: "wobble",
    meaning: "A slow rocking of the Moon that makes Earth sway a little in its sky. Scientists call it libration.",
  },
  crater: { word: "crater", meaning: "A bowl punched into the ground by a space rock." },
  rim: { word: "rim", meaning: "The raised edge of a crater." },
  shadow: { word: "shadow", meaning: "A place where a hill or wall blocks the sunlight." },
  eclipse: { word: "eclipse", meaning: "When one world blocks the Sun's light from another." },
  "solar-panel": { word: "solar panel", meaning: "A flat plate that turns sunlight into electricity." },
  "relay-satellite": { word: "relay satellite", meaning: "A spacecraft that passes messages around the Moon to Earth." },
  lander: { word: "lander", meaning: "A spacecraft that sets down on the surface." },
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
