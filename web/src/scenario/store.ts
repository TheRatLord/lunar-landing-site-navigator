import { create } from "zustand";
import { ApiError, reportError } from "../api/client";
import { clamp } from "../lib/scale";
import { MS_DAY, MS_HOUR, parseUtc } from "../lib/time";
import { toast } from "../state/toasts";
import { useApp } from "../state/store";
import { scenarioApi } from "./api";
import { starterScenario } from "./starter";
import { readDraftText, type Draft, type DraftProblem, type DraftRead, type SavedRef } from "./draft";
import { formatProblems, normalizeScenario } from "./normalize";
import { pathKey, setIn, type Path } from "./path";
import type { Scenario, ScenarioRecord } from "./types";

export interface ValidationIssue {
  loc: string[];
  msg: string;
  type: string;
}

export interface DroppedFields {
  source: string;
  fields: string[];
}

export interface ScenarioStore {
  doc: Scenario | null;
  saved: SavedRef | null;
  baseline: string | null;
  phase: "idle" | "loading" | "saving";
  error: ApiError | null;
  issues: ValidationIssue[];
  conflictVersion: number | null;
  session: number;
  draftElsewhere: boolean;
  draftProblem: DraftProblem | null;
  droppedFields: DroppedFields | null;
  bootError: ApiError | null;

  open(doc: Scenario, saved?: SavedRef | null, clean?: boolean): void;
  edit(path: Path, value: unknown): void;
  editMany(changes: Array<[Path, unknown]>): void;
  close(): void;
  load(id: string, version?: number): Promise<void>;
  save(): Promise<boolean>;
  saveAsNew(name?: string): Promise<boolean>;
  clearIssues(): void;
  importText(text: string): void;
  keepThisTab(): void;
  takeOtherTabDraft(): void;
  discardDraft(): void;
  dismissDroppedFields(): void;
  retryStart(): void;
}

const DRAFT_KEY = "lunarnav.scenario.draft";
const TAB_ID = Math.random().toString(36).slice(2);

function readStorage(): DraftRead {
  try {
    return readDraftText(localStorage.getItem(DRAFT_KEY));
  } catch {
    return { kind: "none" };
  }
}

function draftTab(raw: string | null): string | undefined {
  const d = readDraftText(raw);
  return d.kind === "ok" ? d.draft.tab : undefined;
}

const initial = readStorage();
const initialDraft: Draft | null = initial.kind === "ok" ? initial.draft : null;

const reset = (s: ScenarioStore, doc: Scenario | null, saved: SavedRef | null, baseline: string | null): Partial<ScenarioStore> => ({
  doc,
  saved,
  baseline,
  error: null,
  issues: [],
  conflictVersion: null,
  session: s.session + 1,
  draftProblem: null,
  droppedFields: null,
});

export const useScenario = create<ScenarioStore>((set, get) => ({
  doc: initialDraft?.doc ?? null,
  saved: initialDraft?.saved ?? null,
  baseline: initialDraft?.baseline ?? null,
  phase: "idle",
  error: null,
  issues: [],
  conflictVersion: null,
  session: 0,
  draftElsewhere: false,
  draftProblem: initial.kind === "bad" ? initial.problem : null,
  droppedFields: initial.kind === "ok" && initial.unknownFields.length ? { source: "The stored draft", fields: initial.unknownFields } : null,
  bootError: null,

  open: (doc, saved = null, clean = false) =>
    set((s) => reset(s, doc, saved, saved || clean ? JSON.stringify(doc) : null)),
  edit: (path, value) => {
    const doc = get().doc;
    if (doc) set({ doc: setIn(doc, path, value) });
  },
  editMany: (changes) => {
    let doc = get().doc;
    if (!doc) return;
    for (const [p, v] of changes) doc = setIn(doc, p, v);
    set({ doc });
  },
  close: () => set((s) => reset(s, null, null, null)),

  load: async (id, version) => {
    set({ phase: "loading", error: null });
    try {
      if (version === undefined) adopt(await scenarioApi.get(id));
      else {
        const [rev, latest] = await Promise.all([scenarioApi.revision(id, version), scenarioApi.get(id)]);
        const revDoc = intake(rev.document, `Revision ${version} of ${id}`);
        const latestDoc = intake(latest.document, `Plan ${id}`);
        if (!revDoc || !latestDoc) return set({ phase: "idle" });
        set((s) => ({
          ...reset(s, revDoc.scenario, { id, version: latest.version, updated_utc: latest.updated_utc }, JSON.stringify(latestDoc.scenario)),
          phase: "idle",
          droppedFields: droppedOf(revDoc),
        }));
      }
    } catch (e) {
      set({ phase: "idle", error: e instanceof ApiError ? e : null });
      reportError(e, "Could not load the plan");
    }
  },

  save: async () => {
    const { doc, saved, phase, session } = get();
    if (!doc || phase === "saving") return false;
    set({ phase: "saving", error: null, issues: [], conflictVersion: null });
    try {
      const rec = saved ? await scenarioApi.update(saved.id, saved.version, doc) : await scenarioApi.create(doc);
      finishSave(rec, doc, session);
      toast({ kind: "success", title: `Saved “${rec.name}”`, detail: `Version ${rec.version}` });
      return true;
    } catch (e) {
      handleSaveError(e);
      return false;
    }
  },

  saveAsNew: async (name) => {
    const { doc, phase, session } = get();
    if (!doc || phase === "saving") return false;
    const copy = name ? { ...doc, name } : doc;
    set({ phase: "saving", error: null, issues: [], conflictVersion: null });
    try {
      const rec = await scenarioApi.create(copy);
      finishSave(rec, copy, session);
      toast({ kind: "success", title: `Saved “${rec.name}” as a new plan` });
      return true;
    } catch (e) {
      handleSaveError(e);
      return false;
    }
  },

  clearIssues: () => set({ issues: [], error: null }),

  importText: (text) => {
    try {
      const raw: unknown = JSON.parse(text);
      if (!raw || typeof raw !== "object") throw new Error("The file is not a JSON object.");
      const doc = "document" in raw && raw.document && typeof raw.document === "object" ? raw.document : raw;
      if (!("site" in doc) || !("landing_utc" in doc)) throw new Error("This does not look like a plan file (no site or landing_utc).");
      const n = intake(doc, "The imported file", "Import failed");
      if (!n) return;
      get().open(n.scenario, null);
      set({ droppedFields: droppedOf(n) });
      toast({ kind: "info", title: "Plan imported", detail: "It is not saved yet; the engine validates it when you save." });
    } catch (e) {
      toast({ kind: "error", title: "Could not import the plan", detail: e instanceof Error ? e.message : String(e) });
    }
  },

  keepThisTab: () => set({ draftElsewhere: false }),
  takeOtherTabDraft: () => {
    const d = readStorage();
    if (d.kind === "ok") {
      set((s) => ({ ...reset(s, d.draft.doc, d.draft.saved, d.draft.baseline), draftElsewhere: false }));
      if (d.unknownFields.length) set({ droppedFields: { source: "The other tab's draft", fields: d.unknownFields } });
    } else {
      set({ draftElsewhere: false });
      if (d.kind === "bad") toast({ kind: "error", title: "The other tab's draft could not be read", detail: [d.problem.summary, ...d.problem.details].join(" ") });
    }
  },
  discardDraft: () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
    }
    get().close();
    set({ draftElsewhere: false });
  },
  dismissDroppedFields: () => set({ droppedFields: null }),
  retryStart: () => {
    set({ bootError: null });
    startPlan();
  },
}));

let starting = false;
function startPlan(): void {
  const s = useScenario.getState();
  if (s.doc || s.phase === "loading" || s.bootError || starting) return;
  starting = true;
  starterScenario().then(
    (doc) => {
      starting = false;
      const now = useScenario.getState();
      if (!now.doc && now.phase !== "loading") now.open(doc, null, true);
    },
    (e: unknown) => {
      starting = false;
      useScenario.setState({ bootError: e instanceof ApiError ? e : new ApiError({ status: 0, title: "Could not prepare a starting plan", detail: e instanceof Error ? e.message : String(e) }) });
    },
  );
}
useScenario.subscribe((s) => {
  if (!s.doc && s.phase === "idle") startPlan();
});
setTimeout(startPlan, 0);

type Intake = { scenario: Scenario; unknownFields: string[]; source: string };

function intake(raw: unknown, source: string, title = "Could not use the plan"): Intake | null {
  const n = normalizeScenario(raw);
  if (!n.scenario) {
    toast({ kind: "error", title, detail: `${source} is not a valid plan: ${formatProblems(n.problems).join("; ")}` });
    return null;
  }
  return { scenario: n.scenario, unknownFields: n.unknownFields, source };
}

const droppedOf = (n: Intake): DroppedFields | null => (n.unknownFields.length ? { source: n.source, fields: n.unknownFields } : null);

function adopt(rec: ScenarioRecord): void {
  const n = intake(rec.document, `Plan ${rec.id}`);
  if (!n) {
    useScenario.setState({ phase: "idle" });
    return;
  }
  useScenario.setState((s) => ({
    ...reset(s, n.scenario, { id: rec.id, version: rec.version, updated_utc: rec.updated_utc }, JSON.stringify(n.scenario)),
    phase: "idle",
    droppedFields: droppedOf(n),
  }));
}

function finishSave(rec: ScenarioRecord, sent: Scenario, session: number): void {
  const stored = rec.document ?? sent;
  const s = useScenario.getState();
  if (s.session !== session) {
    useScenario.setState({ phase: "idle" });
    return;
  }
  useScenario.setState({
    doc: s.doc === sent ? stored : s.doc,
    saved: { id: rec.id, version: rec.version, updated_utc: rec.updated_utc },
    baseline: JSON.stringify(stored),
    phase: "idle",
    error: null,
    issues: [],
    conflictVersion: null,
  });
}

export function issuesFromError(e: ApiError): ValidationIssue[] {
  const errors = e.problem?.["errors"];
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((x: unknown) =>
    x && typeof x === "object" && "loc" in x && "msg" in x && Array.isArray(x.loc) ? [{ loc: x.loc.map(String), msg: String(x.msg), type: "type" in x ? String(x.type) : "" }] : [],
  );
}

function stackIssuesFromAnalysis(e: unknown): ValidationIssue[] {
  return e instanceof ApiError && e.status === 422 ? issuesFromError(e).filter((i) => i.loc.includes("terrain_stores")) : [];
}

export function routeStackIssues(e: unknown): void {
  const issues = stackIssuesFromAnalysis(e);
  if (issues.length) useScenario.setState((s) => ({ issues: [...s.issues.filter((i) => !i.loc.includes("terrain_stores")), ...issues] }));
}

function handleSaveError(e: unknown): void {
  if (!(e instanceof ApiError)) {
    useScenario.setState({ phase: "idle" });
    reportError(e, "Could not save the plan");
    return;
  }
  const issues = issuesFromError(e);
  const current = e.problem?.["current_version"];
  useScenario.setState({
    phase: "idle",
    error: e,
    issues,
    conflictVersion: e.status === 409 && typeof current === "number" ? current : null,
  });
  if (e.status === 422) toast({ kind: "error", title: "Engine rejected the plan", detail: `${issues.length} invalid field(s); they are marked on the Mission page.` });
  else if (e.status === 409) toast({ kind: "warning", title: "Someone saved a newer version", detail: "Reload it, or save your edits as a copy." });
  else reportError(e, "Could not save the plan");
}

export function writePlanSite(lat_deg: number, lon_deg: number, name: string, catalog_id: string | null): void {
  useScenario.getState().editMany([
    [["site", "lat_deg"], lat_deg],
    [["site", "lon_deg"], lon_deg],
    [["site", "name"], name],
    [["site", "catalog_id"], catalog_id ?? undefined],
  ]);
}

export function selectDirty(s: ScenarioStore): boolean {
  return s.doc !== null && (s.baseline === null || JSON.stringify(s.doc) !== s.baseline);
}

export function issuesAt(s: ScenarioStore, path: Path): ValidationIssue[] {
  const key = pathKey(path);
  return s.issues.filter((i) => i.loc.join(".") === key);
}

let draftTimer: ReturnType<typeof setTimeout> | undefined;
function writeDraft(s: ScenarioStore): void {
  try {
    if (s.doc) localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: s.doc, saved: s.saved, baseline: s.baseline, tab: TAB_ID } satisfies Draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
  }
}
useScenario.subscribe((s, prev) => {
  if (s.doc === prev.doc && s.saved === prev.saved && s.baseline === prev.baseline) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = undefined;
    writeDraft(s);
  }, 300);
});
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", () => {
    if (draftTimer === undefined) return;
    clearTimeout(draftTimer);
    draftTimer = undefined;
    writeDraft(useScenario.getState());
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== DRAFT_KEY || e.storageArea !== localStorage) return;
    if (draftTab(e.newValue) === TAB_ID) return;
    if (!useScenario.getState().draftElsewhere) {
      toast({ kind: "warning", title: "Another tab changed the plan", detail: "Both tabs share one plan: edits here would overwrite theirs. Choose which edits to keep." });
    }
    useScenario.setState({ draftElsewhere: true });
  });
}

function syncApp(s: ScenarioStore, prev: ScenarioStore | null): void {
  const app = useApp.getState();
  const doc = s.doc;
  if (!doc) return;
  if (!prev?.doc || prev.doc.landing_utc !== doc.landing_utc || prev.doc.mission_duration_h !== doc.mission_duration_h) {
    const landing = parseUtc(doc.landing_utc);
    if (landing !== null) {
      const end = landing + doc.mission_duration_h * MS_HOUR;
      const oldLanding = prev?.doc ? parseUtc(prev.doc.landing_utc) : null;
      app.setMetEpoch(landing);
      app.setBounds({ start_ms: landing - 90 * MS_DAY, end_ms: end + 90 * MS_DAY });
      app.setRange({ start_ms: landing, end_ms: end });
      app.setTime(!prev?.doc || app.timeMs === oldLanding ? landing : clamp(app.timeMs, landing, end));
    }
  }
}

syncApp(useScenario.getState(), null);
useScenario.subscribe((s, prev) => syncApp(s, prev));
