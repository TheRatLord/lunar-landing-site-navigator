import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useThumb } from "./useThumb";

interface SegmentedOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SegmentedOption[];
  size?: "sm" | "md";
}

export function Segmented({ label, value, onChange, options, size = "md" }: SegmentedProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = options.filter((o) => !o.disabled);
  const current = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;
  const track = useThumb<HTMLDivElement>('[aria-checked="true"]', `${value}:${options.length}`);

  const onKey = (e: KeyboardEvent) => {
    const i = enabled.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next < 0 || enabled.length === 0) return;
    e.preventDefault();
    const o = enabled[next]!;
    onChange(o.value);
    refs.current[o.value]?.focus();
  };

  return (
    <div ref={track} role="radiogroup" aria-label={label} className={`segmented segmented-${size} has-thumb`} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[o.value] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === current ? 0 : -1}
          disabled={o.disabled}
          className="seg"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
