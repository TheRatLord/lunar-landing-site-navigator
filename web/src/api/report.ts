import { useEffect } from "react";
import { create } from "zustand";
import { buildSources, uniqueNames } from "../workspaces/compare/sources";
import type { Candidate } from "../scenario/alternatives";
import type { Scenario } from "../scenario/types";
import { ApiError, request } from "./client";
import type { components } from "./generated/schema";
import { postExport, type ExportManifest, type ExportedFile } from "./exports";
import type { JobWatch } from "./jobs";
import type { ScanParams, ScenarioItem, SlipParams, TerrainMode } from "./planning";
import type { EllipseBody } from "./ellipse";
import type { SearchBody } from "./search";
import { searchScenarioKey } from "../workspaces/search/results";

type Schemas = components["schemas"];

const REPORT_PATH = "/report";
export type ReportFormat = Schemas["ReportRequest"]["format"];
const REPORT_COMPARE_MAX = 11;

export interface ReportInputs {
  ref: ScenarioItem;
  terrain: TerrainMode;
  scan?: ScanParams | null;
  slip?: SlipParams | null;
  compareWith?: readonly ScenarioItem[];
  ellipse?: Record<string, unknown> | null;
  search?: Record<string, unknown> | null;
}

type ReportBody = ScenarioItem &
  Pick<Schemas["ReportRequest"], "terrain" | "wait_s" | "format"> & {
    scan?: ScanParams;
    slip?: Omit<SlipParams, "alternative_sites" | "alternative_coordinates">;
    compare_with?: ScenarioItem[];
    ellipse?: Record<string, unknown>;
    search?: Record<string, unknown>;
  };

export function reportBody(inputs: ReportInputs, format: ReportFormat): ReportBody {
  const body: ReportBody = { ...inputs.ref, terrain: inputs.terrain, format, wait_s: 30 };
  if (inputs.scan) body.scan = { start_utc: inputs.scan.start_utc, end_utc: inputs.scan.end_utc, spacing_s: inputs.scan.spacing_s };
  if (inputs.slip) {
    const { alternative_sites: _sites, alternative_coordinates: _coords, ...slip } = inputs.slip;
    body.slip = slip;
  }
  if (inputs.compareWith?.length) body.compare_with = inputs.compareWith.slice(0, REPORT_COMPARE_MAX);
  if (inputs.ellipse) body.ellipse = inputs.ellipse;
  if (inputs.search) body.search = inputs.search;
  return body;
}

export function alternativeRefs(doc: Scenario, alternatives: readonly Candidate[]): { refs: ScenarioItem[]; omitted: number } {
  const sources = buildSources(doc, [], alternatives, null).filter((s) => s.group === "alternative");
  const names = uniqueNames([doc.name, ...sources.map((s) => s.name)]).slice(1);
  const all = sources.map((s, i): ScenarioItem => ({ ...s.item, overrides: { ...s.item.overrides, name: names[i] } }));
  return { refs: all.slice(0, REPORT_COMPARE_MAX), omitted: Math.max(0, all.length - REPORT_COMPARE_MAX) };
}

export type SurveyKind = "ellipse" | "search";

export const SURVEYS: Record<SurveyKind, { label: string; where: string }> = {
  ellipse: { label: "Landing ellipse statistics", where: "Site, Landing accuracy" },
  search: { label: "Site search", where: "Explore, Find sites" },
};

interface PublishedSurvey<B> {
  request: B;
  stale: boolean;
}

const NOT_PARAMS = ["scenario", "scenario_id", "overrides", "terrain", "wait_s", "with_grid"];

type SurveyAvailability = { ok: true; params: Record<string, unknown> } | { ok: false; neverRun: boolean; reason: string };

export function surveyAvailability(kind: SurveyKind, published: PublishedSurvey<EllipseBody | SearchBody> | null, doc: Scenario, terrain: TerrainMode): SurveyAvailability {
  const { label, where } = SURVEYS[kind];
  if (!published) return { ok: false, neverRun: true, reason: `No ${label.toLowerCase()}: run it in ${where} to add it` };
  const left = `${label} left out: `;
  if (published.stale) return { ok: false, neverRun: false, reason: `${left}its result in ${where} is out of date (running again, cancelled, failed or its inputs changed). Run it again to include it` };
  if (searchScenarioKey(published.request.scenario) !== searchScenarioKey(doc)) return { ok: false, neverRun: false, reason: `${left}the plan was edited after it ran. Run it again in ${where} to include it` };
  const ran = published.request.terrain ?? "auto";
  if (ran !== terrain) return { ok: false, neverRun: false, reason: `${left}it ran with horizon "${ran}" but this report uses "${terrain}"` };
  return { ok: true, params: Object.fromEntries(Object.entries(published.request).filter(([k]) => !NOT_PARAMS.includes(k))) };
}

export class ReportNotConnected extends Error {
  constructor() {
    super(`Not connected: this engine does not publish POST /api/v1${REPORT_PATH} yet.`);
    this.name = "ReportNotConnected";
  }
}

export class ReportRejected extends Error {
  readonly requestId: string | undefined;
  constructor(message: string, requestId?: string) {
    super(message);
    this.name = "ReportRejected";
    this.requestId = requestId;
  }
}

function fieldErrors(errors: unknown): string {
  if (!Array.isArray(errors)) return "";
  const lines = errors.flatMap((x: unknown) =>
    typeof x === "object" && x !== null && "loc" in x && Array.isArray(x.loc) && "msg" in x && typeof x.msg === "string" ? [`${x.loc.slice(1).join(".")}: ${x.msg}`] : [],
  );
  return lines.length ? ` (${lines.slice(0, 3).join("; ")})` : "";
}

async function fromManifest({ files }: ExportManifest, signal?: AbortSignal): Promise<ExportedFile> {
  const entry = files[0];
  if (!entry) throw new Error("The report job finished without a file.");
  const res = await request(entry.url, { accept: "*/*", signal });
  return { blob: await res.blob(), filename: entry.name, sha256: entry.sha256 };
}

export async function requestReport(body: ReportBody, opts: Omit<JobWatch, "onCancel"> = {}): Promise<ExportedFile> {
  let out: ExportManifest | ExportedFile;
  try {
    out = await postExport(REPORT_PATH, body, { ...opts, fallback: `report.${body.format}`, accept: "text/html, application/pdf, application/json", inlineManifest: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && !e.detail) throw new ReportNotConnected();
    if (e instanceof ApiError && e.status === 422) throw new ReportRejected(`${e.detail ?? e.title}${fieldErrors(e.problem?.["errors"])}`, e.requestId);
    throw e;
  }
  return "files" in out ? fromManifest(out, opts.signal) : out;
}

interface ReportPlanning {
  scan: { params: ScanParams; terrain: TerrainMode } | null;
  slip: SlipParams | null;
  setScan(params: ScanParams, terrain: TerrainMode): void;
  setSlip(params: SlipParams): void;
}

export const useReportPlanning = create<ReportPlanning>((set) => ({
  scan: null,
  slip: null,
  setScan: (params, terrain) => set({ scan: { params, terrain } }),
  setSlip: (slip) => set({ slip }),
}));

interface ReportSurveys {
  ellipse: PublishedSurvey<EllipseBody> | null;
  search: PublishedSurvey<SearchBody> | null;
  publishEllipse(p: PublishedSurvey<EllipseBody> | null): void;
  publishSearch(p: PublishedSurvey<SearchBody> | null): void;
}

export const useReportSurveys = create<ReportSurveys>((set) => ({
  ellipse: null,
  search: null,
  publishEllipse: (ellipse) => set({ ellipse }),
  publishSearch: (search) => set({ search }),
}));

export function usePublishEllipse(request: EllipseBody | null, stale: boolean): void {
  const publish = useReportSurveys((s) => s.publishEllipse);
  useEffect(() => publish(request ? { request, stale } : null), [publish, request, stale]);
}

export function usePublishSearch(request: SearchBody | null, stale: boolean): void {
  const publish = useReportSurveys((s) => s.publishSearch);
  useEffect(() => publish(request ? { request, stale } : null), [publish, request, stale]);
}
