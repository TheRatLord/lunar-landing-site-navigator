const REGION_PREFIX = /^Artemis(?:\s+\d{4})?\s+candidate region:\s*/i;
const AUTHOR_NOTE = /\s*\(author[^()]*\)\s*$/i;

export function siteLabel(name: string | null | undefined): string {
  return (name ?? "").replace(REGION_PREFIX, "").replace(AUTHOR_NOTE, "");
}
