export type PropId =
  | "lm-descent"
  | "us-flag"
  | "lrrr"
  | "easep"
  | "change4-lander"
  | "yutu2"
  | "blueghost-lander"
  | "shackleton";

export interface Fact {
  title: string;
  body: string;
  source: { title: string; url: string };
}

const NSSDCA_A11 = {
  title: "NASA NSSDCA, Apollo 11 Lunar Module / EASEP (1969-059C)",
  url: "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C",
};
const PLANETARY_CE4 = { title: "The Planetary Society, Chang'e-4", url: "https://www.planetary.org/space-missions/change-4" };

export const FACTS: Record<PropId, Fact> = {
  "lm-descent": {
    title: "Eagle's descent stage",
    body: "This is the bottom half of the lunar module Eagle, which landed here on 20 July 1969. When Armstrong and Aldrin left, it stayed behind as the launch pad for the top half that flew them back up.",
    source: NSSDCA_A11,
  },
  "us-flag": {
    title: "The Apollo 11 flag",
    body: "Buzz Aldrin reported that the blast of the engine at takeoff blew this flag over. Later crews planted their flags farther from the lander.",
    source: { title: "Wikipedia, Lunar Flag Assembly", url: "https://en.wikipedia.org/wiki/Lunar_Flag_Assembly" },
  },
  lrrr: {
    title: "Laser mirror",
    body: "A panel of mirrors that sends light straight back where it came from. Observatories on Earth fire lasers at it and time the echo to measure how far away the Moon is. The first echoes came back on 1 August 1969.",
    source: { title: "Wikipedia, Lunar Laser Ranging experiments", url: "https://en.wikipedia.org/wiki/Lunar_Laser_Ranging_experiments" },
  },
  easep: {
    title: "Moonquake detector",
    body: "A seismometer that listened for moonquakes, with a dust detector. It ran on two solar panels, so it could only work during the lunar day.",
    source: NSSDCA_A11,
  },
  "change4-lander": {
    title: "Chang'e 4 lander",
    body: "In January 2019 China's Chang'e 4 made the first landing ever on the Moon's far side, in Von Kármán crater. Earth is never in the sky here, so it talks to Earth through the Queqiao relay satellite.",
    source: PLANETARY_CE4,
  },
  yutu2: {
    title: "Yutu-2 rover",
    body: "Chang'e 4 carried this small rover, Yutu-2 (\"Jade Rabbit 2\"). It rolled off the lander and has since driven away to explore the crater floor.",
    source: PLANETARY_CE4,
  },
  "blueghost-lander": {
    title: "Blue Ghost lander",
    body: "Firefly's Blue Ghost landed in Mare Crisium on 2 March 2025 with 10 NASA instruments. It worked for more than 14 days of sunlight, then just over 5 hours into the lunar night.",
    source: { title: "Firefly Aerospace, Blue Ghost Mission 1", url: "https://fireflyspace.com/missions/blue-ghost-mission-1/" },
  },
  shackleton: {
    title: "Shackleton crater",
    body: "This crater is 21 km wide and 4.2 km deep, and the Moon's south pole sits on its rim. Lunar Prospector measured extra hydrogen here, which may mean water ice frozen in the crater's never-lit shadows.",
    source: { title: "Wikipedia, Shackleton (crater)", url: "https://en.wikipedia.org/wiki/Shackleton_(crater)" },
  },
};
