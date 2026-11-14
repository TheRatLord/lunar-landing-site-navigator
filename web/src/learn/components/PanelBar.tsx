import type { ReactNode } from "react";
import { useLearn } from "../store";
import { PanelIcon } from "./icons";

export function PanelBar({ children }: { children: ReactNode }) {
  return (
    <div className="l-panelbar">
      <div className="l-panelbar-start">{children}</div>
      <button type="button" className="l-iconbtn" aria-label="Hide panel" title="Hide panel" onClick={() => useLearn.getState().setPanel(false)}>
        <PanelIcon size={20} />
      </button>
    </div>
  );
}

export function ShowPanel() {
  return (
    <button type="button" className="l-pill l-showpanel" onClick={() => useLearn.getState().setPanel(true)}>
      <PanelIcon size={18} /> Show panel
    </button>
  );
}
