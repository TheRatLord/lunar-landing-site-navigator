export const EXPLORE_VIEWS = [
  { id: "map", label: "Map", path: "/explore" },
  { id: "find", label: "Find sites", path: "/explore/find" },
  { id: "regional", label: "Regional layer", path: "/explore/regional" },
] as const;

/** The map's last query string, restored when returning to the Map tab. */
let mapSearch = "";

export function rememberMapSearch(search: string): void {
  mapSearch = search;
}

/** Route of the Map tab, restoring the map's last query string. */
export function exploreMapHref(): string {
  return `/explore${mapSearch}`;
}
