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
  source: string;
}

const NSSDCA_A11 = "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C";
const PLANETARY_CE4 = "https://www.planetary.org/space-missions/change-4";

export const FACTS: Record<PropId, Fact> = {
  "lm-descent": {
    title: "Eagle's descent stage",
    body: "The bottom half of the lunar module Eagle. It landed here on 20 July 1969 and stayed behind as the launch pad for the top half. A plaque on its ladder leg says the crew came \"in peace for all mankind\".",
    source: "https://en.wikipedia.org/wiki/Apollo_11",
  },
  "us-flag": {
    title: "The Apollo 11 flag",
    body: "Armstrong and Aldrin planted it on 20 July 1969. A rod along the top holds it out, since there is no wind. Aldrin said the engine blast at takeoff later blew it over.",
    source: "https://en.wikipedia.org/wiki/Lunar_Flag_Assembly",
  },
  lrrr: {
    title: "Laser mirror",
    body: "Scientists on Earth bounce lasers off this mirror to measure how far away the Moon is. The first echo came back on 1 August 1969.",
    source: "https://en.wikipedia.org/wiki/Lunar_Laser_Ranging_experiments",
  },
  easep: {
    title: "Moonquake detector",
    body: "It listened for moonquakes. It ran on two solar panels, so it only worked in daylight.",
    source: NSSDCA_A11,
  },
  "change4-lander": {
    title: "Chang'e 4 lander",
    body: "In January 2019 it made the first landing on the Moon's far side. Earth is never in the sky here, so it talks home through a relay satellite.",
    source: PLANETARY_CE4,
  },
  yutu2: {
    title: "Yutu-2 rover",
    body: "Chang'e 4 carried this small rover, Yutu-2 (\"Jade Rabbit 2\"). It rolled off the lander and drove off to explore the crater floor.",
    source: PLANETARY_CE4,
  },
  "blueghost-lander": {
    title: "Blue Ghost lander",
    body: "It landed here on 2 March 2025 with 10 NASA instruments. It worked for more than 14 days of sunlight, then just over 5 hours into the night.",
    source: "https://fireflyspace.com/missions/blue-ghost-mission-1/",
  },
  shackleton: {
    title: "Shackleton crater",
    body: "21 km wide and 4.2 km deep, with the south pole on its rim. Its never-lit floor may hold frozen water.",
    source: "https://en.wikipedia.org/wiki/Shackleton_(crater)",
  },
};
