import { dayOfIso } from "./geometry";
import type { SiteId } from "./sites";

export type ChapterSlug = "day" | "earth" | "pole" | "crater" | "timing" | "explore";
export type ViewKind = "space" | "ground" | "crater";
export type ControlKind = "none" | "nearFar" | "latitude" | "rimFloor" | "landing" | "explore";
export type Follow = "sun" | "earth" | "free";
export type TickKind = "sunrise" | "sunset" | "eclipse";
type ChipKind = "sun" | "earth" | "power";

export interface QuizCheck {
  question: string;
  options: string[];
  correct: number;
  hint: string;
  explain: string;
}

export type BigNumber =
  | { kind: "static"; value: string; caption: string; compare?: string; lean?: boolean }
  | { kind: "headline"; value: string }
  | { kind: "sunnyDays" }
  | { kind: "none" };

export interface Chapter {
  slug: ChapterSlug;
  n: number;
  title: string;
  short: string;
  copy: string;
  prompt: string;
  epoch: string;
  epochD: number;
  spanDays: number;
  defaultSite: SiteId;
  view: ViewKind;
  control: ControlKind;
  speed: number;
  follow: Follow;
  inset: "ground" | null;
  trail: "earth" | "sunpath" | null;
  ticks: TickKind[];
  chips: ChipKind[];
  big: BigNumber;
  takeaway: string;
  check: QuizCheck | null;
}

const ch = (c: Omit<Chapter, "epochD">): Chapter => ({ ...c, epochD: dayOfIso(c.epoch) });

const LANDING_HOUR = (8 + 34 / 60) / 24;

export const CHAPTERS: Chapter[] = [
  ch({
    slug: "explore",
    n: 0,
    title: "Explore the Moon",
    short: "Explore",
    copy: "Pick a place and a way to look, then let a whole year go by. On the Moon, a few steps or a few days can mean light or dark.",
    prompt: "Try this: pick the Shackleton rim, choose Fast, and watch a whole year.",
    epoch: "2026-01-01T00:00:00Z",
    spanDays: 365,
    defaultSite: "apollo11",
    view: "space",
    control: "explore",
    speed: 2,
    follow: "sun",
    inset: null,
    trail: null,
    ticks: ["sunrise", "sunset"],
    chips: ["sun", "earth"],
    big: { kind: "none" },
    takeaway: "",
    check: null,
  }),
  ch({
    slug: "day",
    n: 1,
    title: "A day on the Moon lasts a month",
    short: "A Moon day lasts a month",
    copy: "On Earth, the Sun comes up every day. On the Moon, it comes up only about once a month. So you get two weeks of sunshine, then two weeks of night. Apollo 11 landed early in the Moon's morning, when long {shadow|shadows} made rocks easy to see and it wasn't too hot yet.",
    prompt: "Press play and watch the pin move from day into night.",
    epoch: "1969-07-20T20:17:00Z",
    spanDays: 30,
    defaultSite: "apollo11",
    view: "space",
    control: "none",
    speed: 2,
    follow: "sun",
    inset: "ground",
    trail: null,
    ticks: ["sunrise", "sunset"],
    chips: ["sun"],
    big: { kind: "static", value: "≈ 15 days", caption: "of sunshine, then about 15 days of night" },
    takeaway: "One Moon day is about one Earth month: two weeks of light, then two weeks of dark.",
    check: {
      question: "The Sun just came up at Apollo 11. When will it go down?",
      options: ["In about 12 hours", "In about two weeks", "In about a year"],
      correct: 1,
      hint: "How long does the Moon take to turn around once?",
      explain: "The Moon turns around once a month, so the Sun stays up for about two weeks.",
    },
  }),
  ch({
    slug: "earth",
    n: 2,
    title: "Earth stays in one spot",
    short: "Earth stays in one spot",
    copy: "The Moon always shows Earth the same face, called the {near-side|near side}. Stand there, and Earth hangs in your sky and hardly moves, just a little {wobble}. On the {far-side|far side}, you never see Earth at all. China's Chang'e 4 landed there in 2019 and needed a {relay-satellite|relay satellite} to send messages home.",
    prompt: "Watch Earth stay still while the Sun moves. Then try the far side.",
    epoch: "2026-01-12T00:00:00Z",
    spanDays: 30,
    defaultSite: "apollo11",
    view: "ground",
    control: "nearFar",
    speed: 2,
    follow: "earth",
    inset: null,
    trail: "earth",
    ticks: ["sunrise", "sunset"],
    chips: ["earth"],
    big: { kind: "headline", value: "Earth stays in the same spot all month" },
    takeaway: "Where you land decides whether you can see Earth and talk to it directly.",
    check: {
      question: "Your rover is on the far side. Can it radio Earth directly?",
      options: ["Yes, at night", "Only when Earth comes up", "No, it needs a helper satellite"],
      correct: 2,
      hint: "Switch to the far side and look for Earth.",
      explain: "From the far side, Earth is always below the horizon, so messages have to go through a relay satellite.",
    },
  }),
  ch({
    slug: "pole",
    n: 3,
    title: "At the pole, the Sun stays low",
    short: "The Sun stays low at the pole",
    copy: "Earth is tipped over a lot, and that gives us seasons. The Moon is tipped only a tiny bit. So near the Moon's poles, the Sun never climbs high. It circles around you just above the {horizon}, like a lamp sitting on the floor. The ground here is flat on purpose, so only the tilt matters.",
    prompt: "Walk toward the south pole and watch the Sun's path get flatter.",
    epoch: "2026-01-05T00:00:00Z",
    spanDays: 30,
    defaultSite: "custom",
    view: "ground",
    control: "latitude",
    speed: 2,
    follow: "sun",
    inset: null,
    trail: "sunpath",
    ticks: [],
    chips: ["sun"],
    big: { kind: "static", value: "1.5°", caption: "how far the Moon is tipped", compare: "Earth is tipped 23°", lean: true },
    takeaway: "Near the poles the Sun is always low, so even a small hill can block it.",
    check: {
      question: "Why does the Sun stay so low at the south pole?",
      options: ["The Sun is dimmer there", "The Moon is barely tipped, so the Sun circles near the horizon", "Earth is in the way"],
      correct: 1,
      hint: "Compare how far the Moon is tipped with how far Earth is.",
      explain: "The Moon is barely tipped, so at the pole the Sun goes around you instead of up and over.",
    },
  }),
  ch({
    slug: "crater",
    n: 4,
    title: "A short walk changes everything",
    short: "A short walk matters",
    copy: "Near the pole, a {crater} wall is like a giant fence that blocks the low Sun. Up on the {rim}, you are above the fence, so you get sunshine most of the time. Down on the floor, the wall is always taller than the Sun. It has been dark there for billions of years, cold enough to keep ice. That is why missions want to land nearby.",
    prompt: "Switch between the rim and the floor, then press play.",
    epoch: "2026-01-05T00:00:00Z",
    spanDays: 30,
    defaultSite: "rim",
    view: "crater",
    control: "rimFloor",
    speed: 2,
    follow: "sun",
    inset: "ground",
    trail: null,
    ticks: ["sunrise", "sunset"],
    chips: ["sun", "earth"],
    big: { kind: "static", value: "11 km", caption: "from rim to floor, about a two-hour walk" },
    takeaway: "At the pole, a short drive can take you from sunny to dark forever.",
    check: {
      question: "The rim and the floor are about 11 km apart. Which one gets sunlight?",
      options: ["The rim", "The floor", "Both the same"],
      correct: 0,
      hint: "The Sun is very low here. What does a tall wall do to low light?",
      explain: "The rim is above the crater wall, so the low Sun reaches it. The floor is always in shadow.",
    },
  }),
  ch({
    slug: "timing",
    n: 5,
    title: "Land on the right day",
    short: "Land on the right day",
    copy: "In 2025, the Blue Ghost {lander} touched down in the Sea of Crises just after sunrise. That gave it two full weeks of sunshine to work. One week late, and it would have had half as long. Two weeks late, and it would have landed at sunset. On 14 March, Earth passed in front of the Sun for a few hours: an {eclipse}.",
    prompt: "Pick a landing day and watch the battery. {solar-panel|Solar panels} only charge in sunlight.",
    epoch: "2025-03-01T00:00:00Z",
    spanDays: 30,
    defaultSite: "blueghost",
    view: "ground",
    control: "landing",
    speed: 1,
    follow: "sun",
    inset: null,
    trail: null,
    ticks: ["sunrise", "eclipse", "sunset"],
    chips: ["sun", "power"],
    big: { kind: "sunnyDays" },
    takeaway: "Missions land just after sunrise. Every day late is a day of sunshine lost.",
    check: {
      question: "Your launch is one week late. What happens at a sunny spot near the equator?",
      options: ["Nothing changes", "You get about half as many sunny days", "You get more sun"],
      correct: 1,
      hint: "Does the Sun wait for you? Try the landing day cards.",
      explain: "Sunset comes on the same day no matter when you arrive, so landing late means fewer sunny days.",
    },
  }),
];

export const STORY = CHAPTERS.filter((c) => c.slug !== "explore");

export const learnPath = (slug: ChapterSlug): string => (slug === "explore" ? "/learn" : `/learn/${slug}`);

export function chapterBySlug(slug: string | undefined): Chapter | null {
  return CHAPTERS.find((c) => c.slug === slug) ?? null;
}

export const landingT = (offset: number): number => 1 + LANDING_HOUR + offset;
