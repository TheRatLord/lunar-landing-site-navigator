import { useRef, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/ui/Icon";
import { PopoverPanel } from "../../components/ui/Popover";
import { useEditorUi, type PlanField } from "../../scenario/editor/editorUi";

export interface CardRow {
  k?: string;
  v: string;
}

interface CardProps {
  field: PlanField;
  icon: IconName;
  label: string;
  rows: CardRow[];
  width: number;
  children: ReactNode;
}

export function Card({ field, icon, label, rows, width, children }: CardProps) {
  const open = useEditorUi((s) => s.field === field);
  const openField = useEditorUi((s) => s.openField);
  const anchor = useRef<HTMLDivElement>(null);
  const close = () => {
    const invalid = document.querySelector<HTMLElement>(".plan-pop [aria-invalid='true']");
    if (invalid) return invalid.focus();
    openField(null);
  };
  const summary = rows.map((r) => (r.k ? `${r.k} ${r.v}` : r.v)).join(", ");
  return (
    <div ref={anchor} className="plan-card" data-field={field} data-open={open}>
      <button
        type="button"
        id={`plan-${field}`}
        className="plan-card-main"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${summary}`}
        onClick={() => (open ? close() : openField(field))}
      >
        <span className="plan-card-head">
          <Icon name={icon} size={14} className="plan-card-icon" />
          <span className="plan-card-label">{label}</span>
          <Icon name="chevronRight" size={12} className="plan-card-chevron" />
        </span>
        <span className="plan-card-rows">
          {rows.map((r, i) =>
            r.k ? (
              <span key={i} className="plan-card-row">
                <span className="plan-card-k">{r.k}</span>
                <span className="plan-card-v">{r.v}</span>
              </span>
            ) : (
              <span key={i} className="plan-card-row" data-solo>
                <span className="plan-card-v">{r.v}</span>
              </span>
            ),
          )}
        </span>
      </button>
      <PopoverPanel open={open} anchor={anchor} onClose={close} label={label} side="right" width={width} className="plan-pop">
        {open && children}
      </PopoverPanel>
    </div>
  );
}
