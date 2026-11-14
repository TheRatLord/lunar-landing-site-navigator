import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { SlipMode } from "../../api/planning";
import { Button, IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { Icon } from "../../components/ui/Icon";
import { Menu, type MenuItem } from "../../components/ui/Menu";
import { Popover } from "../../components/ui/Popover";
import { Segmented } from "../../components/ui/Segmented";
import { MS_HOUR, MS_LUNATION, parseUtc } from "../../lib/time";
import { useAlternatives } from "../../scenario/alternatives";
import type { Scenario, ScenarioSummary } from "../../scenario/types";
import { addDelays, delayHours, delayLabel, delayLabels, parseSearchDays } from "./delays";
import { useCompareOptions } from "./options";

const MODES = [
  { value: "landing", label: "Delay landing" },
  { value: "launch", label: "Delay launch" },
];

const LUNATION_H = MS_LUNATION / MS_HOUR;
const UNITS = [
  { value: "h", label: "h" },
  { value: "d", label: "d" },
  { value: "lun", label: "lunation" },
];
const UNIT_H: Record<string, number> = { h: 1, d: 24, lun: LUNATION_H };
const PRESETS_H = [24, 72, 168, 336, Math.round(LUNATION_H * 10) / 10];
const NUMBER = /^[+\-\u2212]?(\d+(\.\d*)?|\.\d+)$/;

export function InputStrip({
  doc,
  stored,
  listError,
  takenSaved,
  onAddSaved,
  onRetryList,
  daysText,
  onDaysText,
}: {
  doc: Scenario;
  stored: readonly ScenarioSummary[] | null;
  listError: string | null;
  takenSaved: ReadonlySet<string>;
  onAddSaved: (id: string) => void;
  onRetryList: () => void;
  daysText: string;
  onDaysText: (text: string) => void;
}) {
  const alternatives = useAlternatives((s) => s.items);
  const removeAlternative = useAlternatives((s) => s.remove);
  const { slips_h, mode, removeSlip, setMode, setSearchDays } = useCompareOptions();
  const sitesId = useId();
  const datesId = useId();
  const labels = delayLabels(slips_h);
  const launch = mode === "launch";
  const free = (stored ?? []).filter((s) => !takenSaved.has(s.id));
  const navigate = useNavigate();
  const siteItems: MenuItem[] = [
    { id: "map", label: "Pick on map", icon: "map", onSelect: () => navigate("/explore") },
    { id: "search", label: "From site search", icon: "search", onSelect: () => navigate("/explore/find") },
    ...(free.length === 0
      ? [{ id: "saved", label: "Saved plan", icon: "folder" as const, disabled: true, divider: true, onSelect: () => undefined }]
      : free.map((s, i) => ({ id: `saved-${s.id}`, label: s.name, icon: "folder" as const, divider: i === 0, onSelect: () => onAddSaved(s.id) }))),
  ];

  return (
    <section className="cmp-band" aria-label="Options to compare">
      <div className="cmp-group" role="group" aria-labelledby={sitesId}>
        <span className="cmp-group-label" id={sitesId}>
          Sites
        </span>
        <ul className="cmp-chips">
          <li className="cmp-chip is-planned" aria-label={`Plan site: ${doc.site.name || "unnamed site"}, ${doc.site.lat_deg}°, ${doc.site.lon_deg}°`}>
            <Icon name="pin" size={12} />
            <span className="ellipsis">{doc.site.name || "Unnamed site"}</span>
          </li>
          {alternatives.map((a) => (
            <li key={a.id} className="cmp-chip" aria-label={`${a.name}, ${a.lat_deg}°, ${a.lon_deg}°`}>
              <span className="ellipsis">{a.name}</span>
              <IconButton icon="close" size="sm" variant="ghost" label={`Remove ${a.name} from Compare`} onClick={() => removeAlternative(a.id)} />
            </li>
          ))}
        </ul>
        <Menu label="Add site" icon="plus" width={260} items={siteItems} />
        {listError && (
          <span className="cmp-error" role="alert">
            <Icon name="warn" size={12} />
            <span className="ellipsis">{listError}</span>
            <IconButton icon="reset" size="sm" label="Retry loading saved plans" onClick={onRetryList} />
          </span>
        )}
      </div>

      <div className="cmp-group" role="group" aria-labelledby={datesId}>
        <span className="cmp-group-label" id={datesId}>
          Dates
        </span>
        <ul className="cmp-chips">
          {slips_h.map((h, i) => (
            <li key={h} className={`cmp-chip num${h === 0 ? " is-planned" : ""}`} aria-label={h === 0 ? "Plan landing date" : `${labels[i]}, ${delayHours(h)}`}>
              {h === 0 && <Icon name="pin" size={12} />}
              {labels[i]}
              {h !== 0 && <IconButton icon="close" size="sm" variant="ghost" label={`Remove ${labels[i]}`} onClick={() => removeSlip(h)} />}
            </li>
          ))}
        </ul>
        <Popover label="Add date" icon="plus" width={320}>
          <AddDates planned={launch ? null : parseUtc(doc.landing_utc)} launch={launch} />
        </Popover>
      </div>

      <span className="grow" />
      <Segmented label="What is delayed" size="sm" value={mode} options={MODES} onChange={(v) => setMode(v as SlipMode)} />
      <div className="cmp-advanced">
        <Disclosure title="Advanced">
          <label className="cmp-field">
            <span>Search horizon</span>
            <span className="input-group">
              <input
                className="input num"
                inputMode="decimal"
                aria-label="Search horizon in days"
                value={daysText}
                aria-invalid={parseSearchDays(daysText) === null}
                onChange={(e) => {
                  onDaysText(e.target.value);
                  const d = parseSearchDays(e.target.value);
                  if (d !== null) setSearchDays(d);
                }}
              />
              <span className="input-unit">d</span>
            </span>
          </label>
        </Disclosure>
      </div>
    </section>
  );
}

function AddDates({ planned, launch }: { planned: number | null; launch: boolean }) {
  const { slips_h, setSlips } = useCompareOptions();
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("d");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const add = (text: string): boolean => {
    const r = addDelays(slips_h, text, planned, "a date cannot be a launch delay");
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setSlips(r.hours);
    setError(null);
    return true;
  };
  const onAmount = (e: FormEvent) => {
    e.preventDefault();
    const t = amount.trim().replace(/\u2212/g, "-");
    if (t === "") return;
    const ok = NUMBER.test(t) ? add(`${Number((Number(t) * UNIT_H[unit]!).toFixed(3))}h`) : add(t);
    if (ok) setAmount("");
  };
  const onDate = (e: FormEvent) => {
    e.preventDefault();
    if (date.trim() !== "" && add(date.trim())) setDate("");
  };

  return (
    <div className="cmp-add">
      <form className="cmp-add-row" onSubmit={onAmount}>
        <input
          className="input num cmp-add-amount"
          aria-label="Delay"
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          spellCheck={false}
          inputMode="decimal"
          placeholder="3"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
        />
        <Segmented label="Unit" size="sm" value={unit} options={UNITS} onChange={setUnit} />
        <IconButton type="submit" icon="plus" size="sm" label="Add delay" />
      </form>
      <div className="cmp-presets" role="group" aria-label="Quick add">
        {PRESETS_H.map((h) => (
          <Button key={h} size="sm" variant="ghost" className="num" disabled={slips_h.includes(h)} onClick={() => add(`${h}h`)}>
            {delayLabel(h)}
          </Button>
        ))}
      </div>
      <form className="cmp-add-row" onSubmit={onDate}>
        <input
          className="input num grow"
          aria-label="Landing date, UTC"
          spellCheck={false}
          placeholder="2027-03-20 06:00"
          disabled={launch}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setError(null);
          }}
        />
        <IconButton type="submit" icon="plus" size="sm" label="Add date" disabled={launch} />
      </form>
      {error && (
        <p className="cmp-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
