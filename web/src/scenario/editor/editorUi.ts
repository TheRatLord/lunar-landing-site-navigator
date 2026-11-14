import { create } from "zustand";
import type { IconName } from "../../components/ui/Icon";

export const MISSION_SECTIONS = [
  { id: "lander", label: "Lander", icon: "battery" },
  { id: "constraints", label: "Requirements", icon: "sliders" },
  { id: "network", label: "Ground stations", icon: "antenna" },
  { id: "transfer", label: "Launch transfer", icon: "send" },
  { id: "ellipse", label: "Landing accuracy", icon: "ellipse" },
  { id: "model", label: "Model", icon: "terrain" },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName }>;

export type MissionSection = (typeof MISSION_SECTIONS)[number]["id"];
export type ContextField = "site" | "time";
export type EditorTarget = MissionSection | ContextField;

const isContextField = (t: EditorTarget): t is ContextField => t === "site" || t === "time";

interface EditorUi {
  section: MissionSection;
  field: ContextField | null;
  dialog: "none" | "open" | "new" | "revisions";
  missionRequest: number;
  show(target?: EditorTarget): void;
  setSection(s: MissionSection): void;
  openField(f: ContextField | null): void;
  setDialog(d: EditorUi["dialog"]): void;
}

export const useEditorUi = create<EditorUi>((set) => ({
  section: "lander",
  field: null,
  dialog: "none",
  missionRequest: 0,
  show: (target) =>
    set((s) => (target && isContextField(target) ? { field: target } : { section: target ?? s.section, missionRequest: s.missionRequest + 1 })),
  setSection: (section) => set({ section }),
  openField: (field) => set({ field }),
  setDialog: (dialog) => set({ dialog }),
}));
