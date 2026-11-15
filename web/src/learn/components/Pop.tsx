import { useEffect, useRef, useState, type ReactNode } from "react";

export function Pop({
  label,
  summary,
  children,
  side = "up",
  align = "center",
  active = false,
  className = "",
}: {
  label: string;
  summary: ReactNode;
  children: ReactNode;
  side?: "up" | "down";
  align?: "center" | "start" | "end";
  active?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className={`l-pop is-${side} align-${align}${open ? " is-open" : ""} ${className}`}>
      <button
        type="button"
        className={`l-pop-btn${active ? " is-active" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
      </button>
      <div
        className="l-pop-panel"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest(".l-pop-opt")) return;
          setOpen(false);
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <div className="l-pop-card" role="group" aria-label={label}>
          {children}
        </div>
      </div>
    </div>
  );
}
