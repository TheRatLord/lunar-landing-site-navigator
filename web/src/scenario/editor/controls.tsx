import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "../../components/ui/Icon";
import { Popover } from "../../components/ui/Popover";
import { Segmented } from "../../components/ui/Segmented";
import { Toggle } from "../../components/ui/Fields";
import { formatUtc, parseUtc, toIsoUtc } from "../../lib/time";
import type { Path } from "../path";
import { BASIS_LABEL, UNPUBLISHED_BASES, type Basis, type Origin } from "../types";
import { USER_ORIGIN, useField } from "./fieldState";

const CHIP_LABEL: Partial<Record<Basis, string>> = { "model-typed": "Unconfirmed" };
const PUBLISHED_BASES: Partial<Record<Basis, true>> = { published: true, historical: true, "mission-specific": true };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function OriginBadge({ origin }: { origin: Origin | undefined }) {
  const o = origin ?? USER_ORIGIN;
  const warn = UNPUBLISHED_BASES.has(o.basis) || o.basis === "model-typed";
  const tone = warn ? "origin-warn" : PUBLISHED_BASES[o.basis] ? "origin-pub" : "";
  const label = CHIP_LABEL[o.basis] ?? BASIS_LABEL[o.basis];
  if (!(o.label || o.note || o.source_url)) {
    return (
      <span className={`origin origin-chip ${tone}`}>
        {warn && <Icon name="warn" size={12} />}
        {label}
      </span>
    );
  }
  return (
    <span className={`origin ${tone}`}>
      <Popover label={label} icon={warn ? "warn" : undefined} width={300}>
        <div className="origin-tip">
          <b>{BASIS_LABEL[o.basis]}</b>
          {o.label && <span>{o.label}</span>}
          {o.note && <span className="dim">{o.note}</span>}
          {o.source_url && (
            <a className="origin-link" href={o.source_url} target="_blank" rel="noreferrer noopener">
              <Icon name="external" size={12} />
              {hostOf(o.source_url)}
            </a>
          )}
        </div>
      </Popover>
    </span>
  );
}

/** The origin chip for headings and lists; user-entered values carry no mark. */
export function OriginMark({ origin }: { origin: Origin | undefined }) {
  return origin && origin.basis !== "user" ? <OriginBadge origin={origin} /> : null;
}

interface RowProps {
  label: ReactNode | null;
  htmlFor?: string;
  error?: string | null;
  origin?: Origin;
  top?: boolean;
  children: ReactNode;
}

export function Row({ label, htmlFor, error, origin, top, children }: RowProps) {
  return (
    <div className={`sc-row ${origin ? "has-origin" : ""} ${error ? "has-error" : ""} ${top ? "top" : ""}`}>
      {label === null ? (
        <span />
      ) : htmlFor ? (
        <label className="sc-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="sc-label">{label}</span>
      )}
      <div className="sc-control">{children}</div>
      {origin && (
        <div className="sc-origin">
          <OriginMark origin={origin} />
        </div>
      )}
      {error && (
        <div className="sc-msg" id={htmlFor ? `${htmlFor}-msg` : undefined} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function Suffixed({ unit, children }: { unit?: string; children: ReactNode }) {
  return (
    <span className="input-group">
      {children}
      {unit && <span className="input-unit">{unit}</span>}
    </span>
  );
}

type DraftInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onFocus" | "onBlur" | "onKeyDown"> & {
  id: string;
  unit?: string;
  external: string;
  error: string | null;
  commit(text: string): void;
  nudge?(text: string, up: boolean, big: boolean): string | null;
};

export function DraftInput({ id, unit, external, error, commit, nudge, ...rest }: DraftInputProps) {
  const [draft, setDraft] = useState(external);
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(external);
  if (seen !== external) {
    setSeen(external);
    if (!focused) setDraft(external);
  }
  return (
    <Suffixed unit={unit}>
      <input
        {...rest}
        id={id}
        className="input num"
        spellCheck={false}
        value={draft}
        style={unit ? { paddingRight: `calc(var(--sp-2) * 2 + ${unit.length}ch)` } : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-msg` : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft);
          else if (nudge && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const next = nudge(draft, e.key === "ArrowUp", e.shiftKey);
            if (next === null) return;
            setDraft(next);
            commit(next);
          }
        }}
      />
    </Suffixed>
  );
}

interface NumberFieldProps {
  path: Path;
  label: ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  step?: number;
  nullable?: boolean;
  placeholder?: string;
  origin?: Origin;
  onCommit?: (value: number | null) => void;
  layout?: "row" | "stacked";
}

export function NumberField({ path, label, unit, min, max, exclusiveMin, step = 1, nullable, placeholder, origin, onCommit, layout = "row" }: NumberFieldProps) {
  const id = useId();
  const { value, issue, set } = useField<number | null>(path);
  const [local, setLocal] = useState<string | null>(null);

  const validate = (text: string): { ok: true; value: number | null } | { ok: false; error: string } => {
    const t = text.trim().replace(/,/g, ".");
    if (t === "") return nullable ? { ok: true, value: null } : { ok: false, error: "A number is required." };
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, error: `“${text}” is not a number.` };
    if (min !== undefined && (exclusiveMin ? n <= min : n < min)) return { ok: false, error: `Must be ${exclusiveMin ? ">" : "≥"} ${min}${unit ? ` ${unit}` : ""}.` };
    if (max !== undefined && n > max) return { ok: false, error: `Must be ≤ ${max}${unit ? ` ${unit}` : ""}.` };
    return { ok: true, value: n };
  };

  const commit = (text: string) => {
    const r = validate(text);
    if (!r.ok) return setLocal(r.error);
    setLocal(null);
    if (r.value === (value ?? null)) return;
    set(r.value);
    onCommit?.(r.value);
  };

  const nudge = (text: string, up: boolean, big: boolean) => {
    const cur = Number(text.replace(/,/g, "."));
    return Number.isFinite(cur) ? String(Number((cur + (up ? 1 : -1) * step * (big ? 10 : 1)).toPrecision(12))) : null;
  };

  const error = local ?? issue;
  const field = (
    <DraftInput
      id={id}
      unit={unit}
      external={value === null || value === undefined ? "" : String(value)}
      error={error}
      commit={commit}
      nudge={nudge}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder ?? (nullable ? "None" : undefined)}
    />
  );
  if (layout === "stacked") {
    return (
      <div className="sc-stacked">
        <label className="sc-label" htmlFor={id}>
          {label}
        </label>
        {field}
        {error && (
          <div className="sc-msg" id={`${id}-msg`} role="alert">
            {error}
          </div>
        )}
      </div>
    );
  }
  return (
    <Row label={label} htmlFor={id} error={error} origin={origin}>
      {field}
    </Row>
  );
}

export function TextField({ path, label, placeholder, multiline }: { path: Path; label: ReactNode; placeholder?: string; multiline?: boolean }) {
  const id = useId();
  const { value, issue, set } = useField<string | null>(path);
  const common = {
    id,
    value: value ?? "",
    placeholder,
    "aria-invalid": issue ? (true as const) : undefined,
    "aria-describedby": issue ? `${id}-msg` : undefined,
  };
  return (
    <Row label={label} htmlFor={id} error={issue} top={multiline}>
      {multiline ? (
        <textarea className="input sc-textarea" rows={3} {...common} onChange={(e) => set(e.target.value)} />
      ) : (
        <input className="input" spellCheck={false} autoComplete="off" {...common} onChange={(e) => set(e.target.value)} />
      )}
    </Row>
  );
}

export function ChoiceField<V extends string>({ path, label, options }: { path: Path; label: string; options: ReadonlyArray<{ value: V; label: string }> }) {
  const { value, issue, set } = useField<V>(path);
  return (
    <Row label={label} error={issue}>
      <Segmented label={label} size="sm" value={value ?? ""} onChange={set} options={[...options]} />
    </Row>
  );
}

export function CheckField({ path, label }: { path: Path; label: string }) {
  const { value, issue, set } = useField<boolean>(path);
  return (
    <Row label={label} error={issue}>
      <Toggle checked={Boolean(value)} onChange={set} label={<span className="sr-only">{label}</span>} />
    </Row>
  );
}

export function UtcField({ path, label, actions }: { path: Path; label: ReactNode; actions?: ReactNode }) {
  const id = useId();
  const { value, issue, set } = useField<string>(path);
  const ms = value ? parseUtc(value) : null;
  const [local, setLocal] = useState<string | null>(null);
  const commit = (text: string) => {
    const t = parseUtc(text);
    if (t === null) return setLocal("Expected YYYY-MM-DD HH:MM[:SS].");
    setLocal(null);
    const iso = toIsoUtc(t);
    if (iso !== value) set(iso);
  };
  const error = local ?? issue;
  return (
    <Row label={label} htmlFor={id} error={error}>
      <DraftInput
        id={id}
        unit="UTC"
        external={ms === null ? (value ?? "") : formatUtc(ms, { seconds: ms % 60_000 !== 0 })}
        error={error}
        commit={commit}
        autoComplete="off"
        placeholder="YYYY-MM-DD HH:MM"
      />
      {actions}
    </Row>
  );
}

export function Readout({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sc-row sc-readout">
      <span className="sc-label">{label}</span>
      <span className="sc-control num">{value}</span>
    </div>
  );
}

export function GroupHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="sc-h">
      <h3>{title}</h3>
      <span className="grow" />
      {children}
    </div>
  );
}

export function EstimatesChip({ rows }: { rows: ReadonlyArray<{ path: string; basis: string; label: string }> }) {
  if (rows.length === 0) return null;
  return (
    <Popover label={`${rows.length} estimate${rows.length === 1 ? "" : "s"}`} icon="warn" tone="marginal" width={360}>
      <ul className="sc-estimates">
        {rows.map((r) => (
          <li key={r.path}>
            <code>{r.path}</code>
            <span className="dim">{r.basis}</span>
            {r.label && <span>{r.label}</span>}
          </li>
        ))}
      </ul>
    </Popover>
  );
}
