import type { components } from "../../api/generated/schema";
import { Pairs, type Pair } from "../../components/ui/Pairs";
import { Popover } from "../../components/ui/Popover";
import "../../styles/chrome.css";

type TerrainStack = components["schemas"]["TerrainStackUsed"];

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

function StackTag({ label, marginal, rows }: { label: string; marginal: boolean; rows: Array<Pair | null> | null }) {
  return (
    <span data-testid="terrain-stack">
      <Popover label={label} icon="list" tone={marginal ? "marginal" : "default"}>
        <Pairs className="ch-dl" rows={rows ?? [["DEMs", "not recorded"]]} />
      </Popover>
    </span>
  );
}

function terrainStackLabel(stack: TerrainStack | null | undefined): string {
  if (!stack) return "Stack not recorded";
  if (stack.chosen_by === "none" || stack.dem_ids.length === 0) return "No terrain";
  if (stack.restricted) return "Restricted stack";
  return stack.chosen_by === "default" ? "Default stack" : "Custom stack";
}

export function TerrainStackTag({ stack }: { stack: TerrainStack | null | undefined }) {
  return (
    <StackTag
      label={terrainStackLabel(stack)}
      marginal={!!stack?.restricted}
      rows={stack ? [["DEMs", stack.dem_ids.join(", ") || "none"], stack.stack_hash ? ["Stack", stack.stack_hash.slice(0, 12)] : null, ["Chosen by", stack.chosen_by]] : null}
    />
  );
}

export function RegionalStackTag({ result }: { result: { header: { [key: string]: unknown } } }) {
  const terrain: unknown = result.header["terrain"];
  const ids = typeof terrain === "object" && terrain !== null ? strings(Reflect.get(terrain, "dem_ids")) : null;
  const hash: unknown = ids ? Reflect.get(terrain as object, "stack_hash") : null;
  const spec: unknown = result.header["spec"];
  const requested = typeof spec === "object" && spec !== null ? strings(Reflect.get(spec, "dem_ids")) : null;
  return (
    <StackTag
      label={!ids ? "Stack not recorded" : ids.length === 0 ? "No terrain" : requested ? "Restricted stack" : "Default stack"}
      marginal={!!ids && !!requested}
      rows={ids ? [[`DEMs (${ids.length})`, ids.join(", ") || "none"], typeof hash === "string" && hash ? ["Stack", hash.slice(0, 12)] : null, ["Chosen by", requested ? "request" : "all complete DEMs"]] : null}
    />
  );
}
