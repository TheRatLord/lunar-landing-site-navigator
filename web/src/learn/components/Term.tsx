import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { clamp } from "../../lib/scale";
import { TERMS, type TermId } from "../glossary";

interface Pos {
  x: number;
  y: number;
  above: boolean;
}

export function Term({ id, children }: { id: TermId; children: ReactNode }) {
  const [pos, setPos] = useState<Pos | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const viaHover = useRef(false);
  const uid = useId();
  const open = pos !== null;
  const term = TERMS[id];

  const show = (hover: boolean) => {
    const el = btn.current;
    if (!el) return;
    viaHover.current = hover;
    const r = el.getBoundingClientRect();
    const half = Math.min(150, window.innerWidth / 2 - 16);
    const x = clamp(r.left + r.width / 2, 16 + half, window.innerWidth - 16 - half);
    const above = r.bottom + 130 > window.innerHeight;
    setPos({ x, y: above ? r.top - 8 : r.bottom + 8, above });
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPos(null);
        btn.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setPos(null);
    };
    const onScroll = () => setPos(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span className="l-term-wrap">
      <button
        ref={btn}
        type="button"
        className="l-term"
        aria-expanded={open}
        aria-controls={uid}
        onClick={() => (open && !viaHover.current ? hide() : show(false))}
        onMouseEnter={() => {
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => show(true), 300);
        }}
        onMouseLeave={() => {
          window.clearTimeout(timer.current);
          if (viaHover.current) hide();
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) show(false);
        }}
        onBlur={hide}
      >
        {children}
      </button>
      {pos && (
        <span
          ref={pop}
          id={uid}
          role="note"
          className={`l-term-pop ${pos.above ? "is-above" : ""}`}
          style={{ left: pos.x, top: pos.y }}
        >
          <strong>{term.word}</strong>
          <span>{term.meaning}</span>
        </span>
      )}
    </span>
  );
}
