import { useThumb } from "./useThumb";
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { clamp } from "../../lib/scale";

export interface PanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  scroll?: boolean;
}

export function Panel({ title, subtitle, actions, children, flush, className, scroll = true }: PanelProps) {
  const id = useId();
  return (
    <section className={`panel ${className ?? ""}`} aria-labelledby={id}>
      <header className="panel-head">
        <h2 id={id} className="panel-title">
          {title}
        </h2>
        {subtitle && <span className="panel-sub">{subtitle}</span>}
        <span className="grow" />
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div
        className={`panel-body ${flush ? "flush" : ""} ${scroll ? "scroll" : ""}`}
        tabIndex={flush && scroll ? 0 : undefined}
      >
        {children}
      </div>
    </section>
  );
}

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  panels?: boolean;
  variant?: "pill" | "line";
}

export function Tabs({ tabs, value, onChange, label, panels, variant = "pill" }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const track = useThumb<HTMLDivElement>('[aria-selected="true"]', `${value}:${tabs.length}`);
  const onKey = (e: KeyboardEvent) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const t = enabled[next]!;
    onChange(t.id);
    refs.current[t.id]?.focus();
  };
  return (
    <div ref={track} role="tablist" aria-label={label} className={`tabs${variant === "line" ? " tabs-line" : ""} has-thumb`} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={t.id === value}
          aria-controls={panels && t.id === value ? `tabpanel-${t.id}` : undefined}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          className="tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const MIN = 0.15;
const MAX = 0.85;

export function SplitPane({ initial = 0.5, first, second }: { initial?: number; first: ReactNode; second: ReactNode }) {
  const [frac, setFrac] = useState(initial);
  const box = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    const el = box.current;
    if (!el) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setFrac(clamp((ev.clientX - r.left) / r.width, MIN, MAX));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") setFrac((f) => clamp(f - 0.02, MIN, MAX));
    else if (e.key === "ArrowRight") setFrac((f) => clamp(f + 0.02, MIN, MAX));
    else if (e.key === "Home") setFrac(MIN);
    else if (e.key === "End") setFrac(MAX);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={box} className="split" style={{ ["--split" as string]: `${frac * 100}%` }}>
      <div className="split-pane">{first}</div>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize panes"
        aria-orientation="vertical"
        aria-valuemin={15}
        aria-valuemax={85}
        aria-valuenow={Math.round(frac * 100)}
        className="split-handle"
        onPointerDown={onPointerDown}
        onKeyDown={onKey}
        onDoubleClick={() => setFrac(initial)}
      />
      <div className="split-pane">{second}</div>
    </div>
  );
}
