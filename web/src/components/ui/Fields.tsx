import {
  useId,
  useState,
  type ClipboardEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { parseLat, parseLatLon, parseLon, formatLat, formatLon } from "../../lib/coords";
import { MS_DAY, MS_HOUR, formatUtc, parseUtc } from "../../lib/time";

export interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <div className="field-msg error" id={`${htmlFor}-msg`} role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="field-msg" id={`${htmlFor}-msg`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

interface Draft {
  draft: string;
  setDraft: (v: string) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}

function useDraft(external: string): Draft {
  const [draft, setDraft] = useState(external);
  const [editing, setEditing] = useState(false);
  const [seen, setSeen] = useState(external);
  if (seen !== external) {
    setSeen(external);
    if (!editing) setDraft(external);
  }
  return { draft, setDraft, editing, setEditing };
}

export interface CoordinateInputProps {
  lat: number | null;
  lon: number | null;
  onChange: (lat: number, lon: number) => void;
  idPrefix?: string;
}

export function CoordinateInput({ lat, lon, onChange, idPrefix }: CoordinateInputProps) {
  const auto = useId();
  const id = idPrefix ?? auto;
  const latD = useDraft(lat === null ? "" : String(lat));
  const lonD = useDraft(lon === null ? "" : String(lon));
  const [latErr, setLatErr] = useState<string | null>(null);
  const [lonErr, setLonErr] = useState<string | null>(null);

  const commit = (nextLat: string, nextLon: string) => {
    const a = parseLat(nextLat);
    const b = parseLon(nextLon);
    setLatErr(a.ok ? null : a.error);
    setLonErr(b.ok ? null : b.error);
    if (a.ok && b.ok) {
      latD.setDraft(String(a.value));
      lonD.setDraft(String(b.value));
      onChange(a.value, b.value);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[,\s;]/.test(text.trim())) return;
    e.preventDefault();
    const pair = parseLatLon(text);
    if (pair.ok) {
      latD.setDraft(String(pair.lat));
      lonD.setDraft(String(pair.lon));
      setLatErr(null);
      setLonErr(null);
      onChange(pair.lat, pair.lon);
    } else {
      setLatErr(pair.error);
      setLonErr(null);
    }
  };

  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit(latD.draft, lonD.draft);
  };

  const box = (
    which: "lat" | "lon",
    d: Draft,
    err: string | null,
    label: string,
    pretty: string | null,
  ) => (
    <Field
      label={label}
      htmlFor={`${id}-${which}`}
      error={err}
      hint={pretty ?? (which === "lat" ? "±90, planetocentric" : "east-positive")}
    >
      <input
        id={`${id}-${which}`}
        className="input num"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={which === "lat" ? "-89.5400" : "129.2000"}
        value={d.draft}
        aria-invalid={err ? true : undefined}
        aria-describedby={`${id}-${which}-msg`}
        onFocus={() => d.setEditing(true)}
        onChange={(e) => d.setDraft(e.target.value)}
        onBlur={() => {
          d.setEditing(false);
          commit(latD.draft, lonD.draft);
        }}
        onKeyDown={key}
        onPaste={onPaste}
      />
    </Field>
  );

  return (
    <div className="coord-input">
      {box("lat", latD, latErr, "Latitude °", lat === null ? null : formatLat(lat))}
      {box("lon", lonD, lonErr, "Longitude °E", lon === null ? null : formatLon(lon))}
    </div>
  );
}

export interface DateTimeInputProps {
  value: number;
  onChange: (ms: number) => void;
  label?: string;
  id?: string;
  min?: number;
  max?: number;
  compact?: boolean;
}

export function DateTimeInput({ value, onChange, label = "UTC date and time", id, min, max, compact }: DateTimeInputProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const { draft, setDraft, setEditing } = useDraft(formatUtc(value));
  const [error, setError] = useState<string | null>(null);

  const commit = (text: string) => {
    const ms = parseUtc(text);
    if (ms === null) return setError("Use YYYY-MM-DD HH:MM[:SS] in UTC");
    if ((min !== undefined && ms < min) || (max !== undefined && ms > max)) return setError("Outside the available range");
    setError(null);
    setDraft(formatUtc(ms));
    onChange(ms);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit(draft);
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const base = parseUtc(draft) ?? value;
      const step = (e.shiftKey ? MS_DAY : MS_HOUR) * (e.key === "ArrowUp" ? 1 : -1);
      commit(formatUtc(base + step));
    }
  };

  const input = (
    <input
      id={inputId}
      className={`input num ${compact ? "input-compact" : ""}`}
      autoComplete="off"
      spellCheck={false}
      value={draft}
      aria-label={compact ? label : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${inputId}-msg` : undefined}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        commit(draft);
      }}
      onKeyDown={onKey}
    />
  );
  if (compact) return input;
  return (
    <Field label={label} htmlFor={inputId} error={error} hint="UTC · ↑↓ ±1 h, Shift ±1 d">
      {input}
    </Field>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

export function Slider({ label, value, min, max, step = 1, onChange, format }: SliderProps) {
  const sid = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <label htmlFor={sid} className="field-label">
        {label}
      </label>
      <input
        id={sid}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={sid} className="num slider-out">
        {format ? format(value) : value}
      </output>
    </div>
  );
}

export interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

export interface SelectProps extends Omit<InputHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  "aria-label": string;
}

export function Select({ value, options, onChange, className, ...rest }: SelectProps) {
  return (
    <select className={`select ${className ?? ""}`} value={value} onChange={(e) => onChange(e.target.value)} {...(rest as object)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
