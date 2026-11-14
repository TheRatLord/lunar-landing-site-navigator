import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { skyAt, spaceAt, type SkyState } from "./geometry";
import type { SceneFrame } from "./scene/types";
import { SITES, type Site } from "./sites";
import { chapterOf, landingOf, useLearn, type LearnState } from "./store";
import { buildTimeline, sampleAt, type Timeline } from "./timeline";

export const siteOf = (s: Pick<LearnState, "siteId">): Site => SITES[s.siteId];
export const latArg = (s: Pick<LearnState, "siteId" | "lat">): number | undefined =>
  s.siteId === "custom" ? s.lat : undefined;

export function frameFrom(s: LearnState, reducedMotion: boolean): SceneFrame {
  const c = chapterOf(s.chapter);
  const site = siteOf(s);
  const d = c.epochD + s.t;
  const lat = latArg(s);
  return {
    view: s.view,
    d,
    site,
    lat,
    sky: skyAt(site, d, lat),
    space: spaceAt(d),
    inset: s.chapter === "intro" ? null : c.inset,
    trail: c.trail,
    follow: s.follow,
    reducedMotion,
    chapter: s.chapter,
    epochD: c.epochD,
    spanDays: c.spanDays,
  };
}

export function timelineFor(s: Pick<LearnState, "chapter" | "siteId" | "lat" | "landingOffset">): Timeline {
  const c = chapterOf(s.chapter);
  return buildTimeline(siteOf(s), s.lat, c.epochD, c.spanDays, landingOf(s));
}

export function useTimeline(): Timeline {
  const key = useLearn(useShallow((s) => ({ chapter: s.chapter, siteId: s.siteId, lat: s.lat, landingOffset: s.landingOffset })));
  return useMemo(() => timelineFor(key), [key]);
}

interface Live {
  sky: SkyState;
  site: Site;
  lat: number;
  t: number;
  day: number;
  battery: number;
  timeline: Timeline;
}

export function useLive(): Live {
  const { chapter, t, siteId, lat } = useLearn(
    useShallow((s) => ({ chapter: s.chapter, t: s.t, siteId: s.siteId, lat: s.lat })),
  );
  const timeline = useTimeline();
  return useMemo(() => {
    const c = chapterOf(chapter);
    const site = SITES[siteId];
    const sky = skyAt(site, c.epochD + t, siteId === "custom" ? lat : undefined);
    return { sky, site, lat, t, day: Math.floor(t) + 1, battery: sampleAt(timeline, t).battery, timeline };
  }, [chapter, t, siteId, lat, timeline]);
}
