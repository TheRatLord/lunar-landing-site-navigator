import { useEffect, useRef, useState, type ReactNode } from "react";

export function Fold({ className, sumClass, label, summary, children }: { className: string; sumClass?: string; label: string; summary: ReactNode; children: ReactNode }) {
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
    <div ref={box} className={`${className} l-fold${open ? " is-open" : ""}`}>
      <button type="button" className={`l-fold-sum ${sumClass ?? `${className}-sum`}`} aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {summary}
      </button>
      {children}
    </div>
  );
}
