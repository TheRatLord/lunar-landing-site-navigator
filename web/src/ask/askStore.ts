import { create } from "zustand";
import { agentApi, metaApi, type AgentAccess } from "../api/endpoints";
import type { components } from "../api/generated/schema";

export const ASK_BUTTON_ID = "ask-toggle";

type AskMode = "dock" | "full";
type AskView = "conversation" | "details";
export type DetailTab = "instructions" | "assumptions" | "inbox" | "provenance" | "artefacts";

interface Stored {
  open: boolean;
  mode: AskMode;
  view: AskView;
  runId: string | null;
  tab: DetailTab;
  lastContext: Record<string, string>;
  exampleShown: boolean;
}

interface AskStatus {
  pending: number | null;
  running: boolean;
}

interface AskStore extends Stored {
  enabled: boolean;
  access: AgentAccess | null;
  markCreditSpent(): void;
  showExample(runId: string): void;
  status: AskStatus;
  setOpen(open: boolean): void;
  toggle(): void;
  setMode(mode: AskMode): void;
  setView(view: AskView): void;
  setTab(tab: DetailTab): void;
  select(runId: string | null): void;
  rememberContext(runId: string, text: string): void;
  setStatus(status: AskStatus): void;
}

const KEY = "lunarnav.ask";
const TABS: readonly DetailTab[] = ["instructions", "assumptions", "inbox", "provenance", "artefacts"];
const DEFAULTS: Stored = { open: false, mode: "dock", view: "conversation", runId: null, tab: "instructions", lastContext: {}, exampleShown: false };
const KEEP_CONTEXTS = 50;

function read(): Stored {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const r = raw as Record<string, unknown>;
    const last: Record<string, string> = {};
    if (r["lastContext"] && typeof r["lastContext"] === "object") {
      for (const [k, v] of Object.entries(r["lastContext"])) if (typeof v === "string") last[k] = v;
    }
    return {
      open: r["open"] === true,
      mode: r["mode"] === "full" ? "full" : "dock",
      view: r["view"] === "details" ? "details" : "conversation",
      runId: typeof r["runId"] === "string" && r["runId"] !== "" ? r["runId"] : null,
      tab: TABS.find((t) => t === r["tab"]) ?? "instructions",
      lastContext: last,
      exampleShown: r["exampleShown"] === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export const useAsk = create<AskStore>((set) => ({
  ...read(),
  enabled: false,
  access: null,
  markCreditSpent: () => set({ access: { available: false, reason: "budget-spent" } }),
  status: { pending: null, running: false },
  setOpen: (open) => set((s) => ({ open: open && s.enabled })),
  toggle: () => set((s) => ({ open: s.enabled && !s.open })),
  setMode: (mode) => set({ mode }),
  setView: (view) => set({ view }),
  setTab: (tab) => set({ tab }),
  showExample: (runId) => set((s) => (s.exampleShown ? s : { exampleShown: true, ...(s.runId === null ? { runId, view: "conversation" as const } : {}) })),
  select: (runId) => set({ runId, view: "conversation", status: { pending: null, running: false } }),
  rememberContext: (runId, text) =>
    set((s) => {
      const entries = Object.entries({ ...s.lastContext, [runId]: text });
      return { lastContext: Object.fromEntries(entries.slice(-KEEP_CONTEXTS)) };
    }),
  setStatus: (status) => set((s) => (s.status.pending === status.pending && s.status.running === status.running ? s : { status })),
}));

useAsk.subscribe(({ open, mode, view, runId, tab, lastContext, exampleShown }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ open, mode, view, runId, tab, lastContext, exampleShown } satisfies Stored));
  } catch {
  }
});

let availability: Promise<void> | null = null;

export function loadAskAvailability(): Promise<void> {
  availability ??= metaApi.get().then(
    async (meta) => {
      const enabled = (meta as Partial<components["schemas"]["MetaResponse"]>).agent_enabled === true;
      const access = enabled ? await agentApi.access().catch(() => null) : null;
      useAsk.setState({ enabled, access });
    },
    () => {
      availability = null;
    },
  );
  return availability;
}
