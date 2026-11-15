export type MissionId = "yutu" | "yutu2" | "pragyan" | "soraq" | "jinchan";

export interface MissionSpot {
  x: number;
  z: number;
}

export interface MissionTask {
  goal: string;
  action: string | null;
  found: string;
}

export interface Mission {
  id: MissionId;
  rover: string;
  mission: string;
  year: number;
  where: string;
  brief: string;
  tasks: MissionTask[];
  ending: string;
  source: string;
}

export const MISSION_SPOTS: MissionSpot[] = [
  { x: 14, z: 7 },
  { x: 30, z: -12 },
  { x: 12, z: -34 },
];

export const MISSIONS: Mission[] = [
  {
    id: "yutu",
    rover: "Yutu",
    mission: "Chang'e 3",
    year: 2013,
    where: "worked in Mare Imbrium, on the near side",
    brief: "China's first Moon rover. Drive it off the lander, look under the ground with radar, and keep going as long as the wheels allow.",
    tasks: [
      { goal: "Drive to the first stop", action: null, found: "Yutu rolled off its lander in December 2013 and set out across Mare Imbrium." },
      {
        goal: "Scan under the ground",
        action: "Run the ground radar",
        found: "Yutu's radar made the first direct measurement of how the lunar soil is layered, tens of metres down.",
      },
      {
        goal: "Try to drive on",
        action: "Drive on",
        found: "In January 2014 Yutu's drive system failed after about 114 m. It never moved again.",
      },
    ],
    ending: "Stuck in place, Yutu kept its instruments working until July 2016, 31 months after landing.",
    source: "https://en.wikipedia.org/wiki/Yutu_(rover)",
  },
  {
    id: "yutu2",
    rover: "Yutu-2",
    mission: "Chang'e 4",
    year: 2019,
    where: "explores Von Kármán crater, on the far side",
    brief: "The first rover on the Moon's far side. Photograph the land, read the soil's minerals, and map the layers below.",
    tasks: [
      { goal: "Drive to the first stop", action: "Take a panorama", found: "Yutu-2 carries a panoramic camera to pick where to drive next." },
      {
        goal: "Read the soil",
        action: "Use the spectrometer",
        found: "Its visible and near-infrared spectrometer reads which minerals are in the soil from the light they reflect.",
      },
      {
        goal: "Map the layers below",
        action: "Run the ground radar",
        found: "Yutu-2's radar sees layers down to about 30 m, at about 30 cm detail.",
      },
    ],
    ending: "By September 2024 Yutu-2 had driven more than 1.6 km, still exploring years after landing.",
    source: "https://en.wikipedia.org/wiki/Yutu-2",
  },
  {
    id: "pragyan",
    rover: "Pragyan",
    mission: "Chandrayaan-3",
    year: 2023,
    where: "worked near the south pole",
    brief: "India's rover had one lunar day, about 14 Earth days, to find out what the ground near the south pole is made of.",
    tasks: [
      { goal: "Drive away from the lander", action: null, found: "Pragyan drove down a ramp from the Vikram lander in August 2023." },
      {
        goal: "Test the rock with a laser",
        action: "Fire the laser",
        found: "Its laser spectrometer found sulphur, plus aluminium, calcium, iron, chromium, titanium, manganese, silicon and oxygen: the first such reading near the south pole.",
      },
      {
        goal: "Check it a second way",
        action: "Lower the X-ray sensor",
        found: "Its alpha particle X-ray spectrometer confirmed the sulphur with a different method.",
      },
    ],
    ending: "Pragyan drove about 100 m. It was put to sleep before the long lunar night and never woke up.",
    source: "https://en.wikipedia.org/wiki/Chandrayaan-3",
  },
  {
    id: "soraq",
    rover: "SORA-Q",
    mission: "SLIM",
    year: 2024,
    where: "worked near Shioli crater",
    brief: "A palm-sized ball that opens into a rover. Its job: find the lander, photograph it, and send the picture home through a hopping robot.",
    tasks: [
      { goal: "Roll out", action: null, found: "SORA-Q, also called LEV-2, weighs about 230 g. It split open into a two-wheeled rover after landing in January 2024." },
      {
        goal: "Photograph the lander",
        action: "Take 12 photos",
        found: "SORA-Q chose the best 2 of its 12 photos by itself. They showed SLIM had landed upside down.",
      },
      {
        goal: "Send the photos home",
        action: "Send via LEV-1",
        found: "SORA-Q cannot talk to Earth, so it passed the photos to LEV-1, a hopping robot that relayed them.",
      },
    ],
    ending: "SORA-Q worked for more than 100 minutes before losing contact with LEV-1.",
    source: "https://www.livescience.com/space/space-exploration/see-the-crawling-ball-shaped-rover-that-rolled-around-the-moon-during-japans-historic-first-landing",
  },
  {
    id: "jinchan",
    rover: "Jinchan",
    mission: "Chang'e 6",
    year: 2024,
    where: "worked in the Apollo basin, on the far side",
    brief: "A 5 kg mini-rover nicknamed Golden Toad. It drove itself off the lander after the samples were collected.",
    tasks: [
      { goal: "Drive away from the lander", action: null, found: "Jinchan separated from the Chang'e 6 lander after the sample collection in June 2024." },
      {
        goal: "Find a good angle",
        action: "Photograph the lander",
        found: "Jinchan picked its own spot and angle, then photographed the lander with its robotic arm stretched out.",
      },
      {
        goal: "Study the soil",
        action: "Scan in infrared",
        found: "Its infrared imaging spectrometer studies what the soil is made of and whether it holds water ice.",
      },
    ],
    ending: "Jinchan's photo shows the lander that collected the first samples ever taken from the Moon's far side.",
    source: "https://www.space.com/china-change-6-moon-far-side-minirover",
  },
];

export const missionById = (id: MissionId | null): Mission | null => MISSIONS.find((m) => m.id === id) ?? null;
