import { useLearn } from "../store";
import { PanelIcon } from "./icons";

export function HidePanel() {
  return (
    <button type="button" className="l-iconbtn l-hide" aria-label="Hide lesson" title="Hide lesson" onClick={() => useLearn.getState().setPanel(false)}>
      <PanelIcon size={20} />
    </button>
  );
}

export function ShowPanel() {
  return (
    <button type="button" className="l-pill l-showpanel" onClick={() => useLearn.getState().setPanel(true)}>
      <PanelIcon size={18} /> Show lesson
    </button>
  );
}
