import { useRef, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/ui/Icon";
import { PopoverPanel } from "../../components/ui/Popover";
import { useEditorUi, type PlanField } from "../../scenario/editor/editorUi";

interface CardProps {
  field: PlanField;
  icon: IconName;
  label: string;
  value: string;
  title: string;
  width: number;
  lines?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}

export function Card({ field, icon, label, value, title, width, lines, extra, children }: CardProps) {
  const open = useEditorUi((s) => s.field === field);
  const openField = useEditorUi((s) => s.openField);
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchor} className="plan-card" data-field={field} data-open={open}>
      <button
        type="button"
        id={`plan-${field}`}
        className="plan-card-main"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${value}. ${title}`}
        title={title}
        onClick={() => openField(open ? null : field)}
      >
        <Icon name={icon} size={16} className="plan-card-icon" />
        <span className="plan-card-text">
          <span className="plan-card-value">{value}</span>
          {lines}
        </span>
        <Icon name="chevronRight" size={12} className="plan-card-chevron" />
      </button>
      {extra}
      <PopoverPanel open={open} anchor={anchor} onClose={() => openField(null)} label={title} side="right" width={width} className="plan-pop">
        {open && children}
      </PopoverPanel>
    </div>
  );
}
