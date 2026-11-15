import type { SiteId } from "./sites";

export interface Person {
  name: string;
  role: string;
}

export interface SiteStory {
  title: string;
  when: string;
  crew?: Person[];
  quote?: { text: string; by: string };
  facts: string[];
  sources: { label: string; url: string }[];
}

const SHACKLETON_SOURCES = [
  { label: "Scientific American", url: "https://www.scientificamerican.com/article/new-nasa-image-of-the-moons-shackleton-crater/" },
  { label: "Wikipedia: Shackleton (crater)", url: "https://en.wikipedia.org/wiki/Shackleton_(crater)" },
];

export const SITE_STORIES: Partial<Record<SiteId, SiteStory>> = {
  apollo11: {
    title: "Apollo 11: the first people on the Moon",
    when: "Landed 20 July 1969, Sea of Tranquility",
    crew: [
      { name: "Neil Armstrong", role: "Commander. The first person to walk on the Moon." },
      { name: "Buzz Aldrin", role: "Lunar module pilot. Followed Armstrong out about 20 minutes later." },
      { name: "Michael Collins", role: "Command module pilot. Circled the Moon alone in Columbia while the others landed." },
    ],
    quote: { text: "That's one small step for man, one giant leap for mankind.", by: "Neil Armstrong, stepping onto the Moon" },
    facts: [
      "A Saturn V rocket launched the crew from Kennedy Space Center on 16 July 1969.",
      "The lander Eagle touched down with Armstrong's words: \"Houston, Tranquility Base here. The Eagle has landed.\"",
      "Armstrong and Aldrin spent about two and a half hours walking outside, planted the US flag, set up experiments and collected about 21.5 kg of rocks and soil.",
      "A plaque on the lander's leg reads: \"Here men from the planet Earth first set foot upon the Moon, July 1969, A.D. We came in peace for all mankind.\"",
      "The crew splashed down in the Pacific on 24 July and were picked up by the USS Hornet.",
    ],
    sources: [
      { label: "NASA: Apollo 11 mission overview", url: "https://www.nasa.gov/missions/apollo/apollo-11-mission-overview/" },
      { label: "Wikipedia: Apollo 11", url: "https://en.wikipedia.org/wiki/Apollo_11" },
    ],
  },
  blueghost: {
    title: "Blue Ghost Mission 1: a company lands on the Moon",
    when: "Landed 2 March 2025, Mare Crisium",
    facts: [
      "Firefly Aerospace's Blue Ghost was the first fully successful commercial Moon landing: it touched down upright, within its 100 m target near Mons Latreille.",
      "It carried 10 NASA instruments to study the lunar soil, the heat coming from inside the Moon and Earth's magnetic bubble, and to test new technology.",
      "On 14 March 2025 it photographed a total solar eclipse from the Moon: Earth passed in front of the Sun, and Blue Ghost caught the \"diamond ring\".",
      "It worked through 14 days of sunlight, watched the sunset on 16 March, and kept going about 5 hours into the lunar night.",
    ],
    sources: [
      { label: "Firefly Aerospace", url: "https://fireflyspace.com/news/firefly-aerospace-becomes-first-commercial-company-to-successfully-land-on-the-moon/" },
      { label: "SpacePolicyOnline: the eclipse", url: "https://spacepolicyonline.com/news/fireflys-dazzling-images-of-earth-eclipsing-the-sun/" },
      { label: "CBS News: sunset on the Moon", url: "https://www.cbsnews.com/news/sunset-on-the-moon-blue-ghost-lander-firefly-aerospace-nasa" },
    ],
  },
  rim: {
    title: "Shackleton rim: sunlight at the south pole",
    when: "No one has landed here yet",
    facts: [
      "The crater is named after the Antarctic explorer Ernest Shackleton.",
      "Because the Sun stays near the horizon at the pole, high ground on the rim is lit much of the time, which makes it a good place for solar power.",
      "The region was picked as a candidate landing area for NASA's Artemis III crewed mission.",
      "Orbiters have mapped it closely: NASA's Lunar Reconnaissance Orbiter photographs the rim, and ShadowCam on Korea's Danuri sees into the dark floor.",
    ],
    sources: SHACKLETON_SOURCES,
  },
  floor: {
    title: "Shackleton floor: never touched by sunlight",
    when: "No one has landed here yet",
    facts: [
      "The crater floor is in permanent shadow: direct sunlight never reaches it.",
      "It is extremely cold down here, around −183 °C on average.",
      "Scientists think the cold could keep water ice frozen in the floor, which future explorers could use for drinking water, air and rocket fuel.",
      "Exploring a shadowed region like this is one of the goals of NASA's Artemis III mission.",
    ],
    sources: SHACKLETON_SOURCES,
  },
  change4: {
    title: "Chang'e 4: the first landing on the far side",
    when: "Landed 3 January 2019, Von Kármán crater",
    facts: [
      "China's Chang'e 4 was the first spacecraft ever to land on the Moon's far side, the side that never faces Earth.",
      "It landed in Von Kármán crater, inside the huge South Pole–Aitken basin, where an ancient impact may have dug up deep material.",
      "Earth is never in the sky here, so all messages go through the Queqiao relay satellite, launched in May 2018 to a spot beyond the Moon.",
      "The Yutu-2 rover rolled down its ramp about 12 hours after landing.",
      "Cotton seeds in a small sealed garden on the lander sprouted on 15 January 2019, the first plants to sprout on the Moon. They died in the cold lunar night.",
    ],
    sources: [
      { label: "Wikipedia: Chang'e 4", url: "https://en.wikipedia.org/wiki/Chang%27e_4" },
      { label: "Science News Explores", url: "https://www.snexplores.org/?p=3892" },
    ],
  },
};
