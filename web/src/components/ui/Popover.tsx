import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";
import { clamp } from "../../lib/scale";

const GAP = 6;
const MARGIN = 8;

type Align = "start" | "end";
type Side = "below" | "right";

/** Positions `panel` against `anchor`: below if it fits (or below has more room), else above; clamped to the viewport. With `side` "right" it sits beside the anchor instead, top-aligned and below the top bar. */
function place(anchor: HTMLElement, panel: HTMLElement, align: Align, side: Side) {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (side === "right") {
    const left = r.right + GAP;
    panel.style.maxWidth = `${Math.max(0, vw - left - MARGIN)}px`;
    const floor = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 0) + MARGIN;
    const h = Math.min(panel.scrollHeight, vh - floor - MARGIN);
    const top = clamp(r.top, floor, Math.max(floor, vh - MARGIN - h));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${vh - top - MARGIN}px`;
    panel.style.visibility = "visible";
    return;
  }
  const w = panel.offsetWidth;
  const natural = panel.scrollHeight;
  const below = vh - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  const down = natural <= below || below >= above;
  const maxHeight = Math.max(0, down ? below : above);
  const h = Math.min(natural, maxHeight);
  const left = clamp(align === "end" ? r.right - w : r.left, MARGIN, Math.max(MARGIN, vw - w - MARGIN));
  panel.style.left = `${left}px`;
  panel.style.top = `${down ? r.bottom + GAP : r.top - GAP - h}px`;
  panel.style.maxHeight = `${maxHeight}px`;
  panel.style.visibility = "visible";
}

export interface PopoverPanelProps {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  align?: Align;
  side?: Side;
  width?: number;
  role?: "dialog" | "none";
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Controlled, portal-rendered panel anchored to `anchor`. Esc closes and refocuses the anchor; a press outside panel and anchor closes. */
export function PopoverPanel({ open, anchor, onClose, label, align = "start", side = "below", width, role = "dialog", id, className, children }: PopoverPanelProps) {
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open && anchor.current && panel.current) place(anchor.current, panel.current, align, side);
  }, [open, anchor, align, side, width, children]);

  useEffect(() => {
    const p = panel.current;
    if (open && p && !p.contains(document.activeElement)) p.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (panel.current?.contains(n) || anchor.current?.contains(n)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
      anchor.current?.focus();
    };
    const onMove = () => {
      if (anchor.current && panel.current) place(anchor.current, panel.current, align, side);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, onClose, anchor, align, side]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      id={id}
      role={role}
      aria-label={role === "none" ? undefined : label}
      tabIndex={-1}
      className={className ? `popover ${className}` : "popover"}
      style={{ width }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface PopoverProps {
  label: string;
  icon?: IconName;
  /** Icon-button trigger (requires `icon`); `label` becomes its accessible name and tooltip. */
  iconOnly?: boolean;
  tone?: "default" | "pass" | "marginal" | "fail";
  align?: Align;
  width?: number;
  children: ReactNode;
}

export function Popover({ label, icon, iconOnly = false, tone = "default", align = "start", width = 320, children }: PopoverProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const triggerProps = {
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
    "aria-haspopup": "dialog" as const,
    onClick: () => setOpen(!open),
  };

  return (
    <>
      {iconOnly && icon ? (
        <IconButton ref={trigger} icon={icon} label={label} size="sm" className={`pop-trigger pop-trigger-${tone}`} {...triggerProps} />
      ) : (
        <button ref={trigger} type="button" className={`btn btn-sm btn-ghost pop-trigger pop-trigger-${tone}`} {...triggerProps}>
          {icon && <Icon name={icon} size={14} />}
          {label}
          <Icon name="chevronDown" size={12} className="pop-chevron" />
        </button>
      )}
      <PopoverPanel id={id} open={open} anchor={trigger} onClose={() => setOpen(false)} label={label} align={align} width={width}>
        {children}
      </PopoverPanel>
    </>
  );
}
