import { useId, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface DisclosureProps {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Disclosure({ title, count, defaultOpen = false, children }: DisclosureProps) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="disclosure">
      <button
        type="button"
        className="disclosure-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="chevronRight" size={12} className="disclosure-chevron" />
        <span>{title}</span>
        {count !== undefined && <span className="disclosure-count num">{count}</span>}
      </button>
      {open && (
        <div id={id} className="disclosure-body">
          {children}
        </div>
      )}
    </div>
  );
}
