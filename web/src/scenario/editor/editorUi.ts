import { create } from "zustand";
import type { IconName } from "../../components/ui/Icon";

export const MISSION_SECTIONS = [
  {
    id: "lander",
    label: "Lander",
    icon: "lander",
    about: "The vehicle: its solar arrays, battery, power loads, antenna and radio. This sets how much power it makes and what it can see over the terrain.",
  },
  {
    id: "constraints",
    label: "Requirements",
    icon: "checklist",
    about: "The limits a site and landing date must meet. Each requirement that is switched on is scored pass, marginal or fail.",
  },
  {
    id: "network",
    label: "Ground stations",
    icon: "antenna",
    about: "The antennas on Earth the lander talks to. Contact time, contact gaps and link margin are computed against these.",
  },
  {
    id: "model",
    label: "Model",
    icon: "terrain",
    about: "How the engine computes: which terrain data it reads, its error bounds, the eclipse model and the time step. Change these only to test sensitivity.",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName; about: string }>;

export type MissionSection = (typeof MISSION_SECTIONS)[number]["id"];
export type PlanField = "site" | "time" | "lander" | "constraints";
export type EditorTarget = MissionSection | "site" | "time" | "transfer" | "ellipse";

interface EditorUi {
  section: MissionSection;
  field: PlanField | null;
  fieldDetail: "transfer" | null;
  dialog: "none" | "open" | "new" | "revisions";
  route: { path: string; n: number } | null;
  show(target?: EditorTarget): void;
  openField(f: PlanField | null): void;
  setDialog(d: EditorUi["dialog"]): void;
}

export const useEditorUi = create<EditorUi>((set) => ({
  section: "lander",
  field: null,
  fieldDetail: null,
  dialog: "none",
  route: null,
  show: (target) =>
    set((s) => {
      if (target === "site") return { field: "site", fieldDetail: null };
      if (target === "time" || target === "transfer") return { field: "time", fieldDetail: target === "transfer" ? "transfer" : null };
      const n = (s.route?.n ?? 0) + 1;
      if (target === "ellipse") return { field: null, route: { path: "/site/accuracy", n } };
      return { field: null, section: target ?? s.section, route: { path: "/mission", n } };
    }),
  openField: (field) => set({ field, fieldDetail: null }),
  setDialog: (dialog) => set({ dialog }),
}));
