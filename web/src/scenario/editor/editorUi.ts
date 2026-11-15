import { create } from "zustand";
import type { IconName } from "../../components/ui/Icon";

export const MISSION_SECTIONS = [
  { id: "lander", label: "Lander details", icon: "lander", about: "" },
  { id: "network", label: "Ground stations", icon: "antenna", about: "Antennas on Earth." },
  { id: "model", label: "Model", icon: "terrain", about: "" },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName; about: string }>;

export type MissionSection = (typeof MISSION_SECTIONS)[number]["id"];
export type PlanField = "site" | "time" | "lander" | "constraints";
export type EditorTarget = MissionSection | PlanField | "ellipse";

interface EditorUi {
  section: MissionSection;
  field: PlanField | null;
  dialog: "none" | "open";
  route: { path: string; n: number } | null;
  show(target?: EditorTarget): void;
  openField(f: PlanField | null): void;
  setDialog(d: EditorUi["dialog"]): void;
}

export const useEditorUi = create<EditorUi>((set) => ({
  section: "lander",
  field: null,
  dialog: "none",
  route: null,
  show: (target) =>
    set((s) => {
      if (target === "site" || target === "time" || target === "constraints") return { field: target };
      const n = (s.route?.n ?? 0) + 1;
      if (target === "ellipse") return { field: null, route: { path: "/site/ellipse", n } };
      return { field: null, section: target ?? s.section, route: { path: "/mission", n } };
    }),
  openField: (field) => set({ field }),
  setDialog: (dialog) => set({ dialog }),
}));
