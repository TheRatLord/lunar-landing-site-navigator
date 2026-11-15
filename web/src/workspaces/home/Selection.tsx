import type { Interval, Verdict } from "../../contract/types";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Popover } from "../../components/ui/Popover";
import { VERDICT_LABEL } from "../../lib/verdict";
import { UtcField } from "../../scenario/editor/controls";
import { dayText } from "../../scenario/when";
import { useClock } from "./clock";

export interface StayLight {
  start_ms: number;
  end_ms: number;
  sun: Interval[];
  earth: Interval[];
}

function StayPlayhead({ start_ms, end_ms }: { start_ms: number; end_ms: number }) {
  const t = useClock((c) => c.t_ms);
  if (t === null || t < start_ms || t > end_ms) return null;
  return <i className="sel-play" style={{ left: `${((t - start_ms) / (end_ms - start_ms)) * 100}%` }} />;
}

function StayStrip({ light, start_ms, end_ms }: { light: StayLight | null; start_ms: number; end_ms: number }) {
  const span = end_ms - start_ms;
  const place = (iv: Interval) => ({ left: `${((Math.max(iv.start_ms, start_ms) - start_ms) / span) * 100}%`, width: `${((Math.min(iv.end_ms, end_ms) - Math.max(iv.start_ms, start_ms)) / span) * 100}%` });
  const ready = light !== null && light.start_ms === start_ms && light.end_ms === end_ms;
  return (
    <div className="sel-strip" data-busy={!ready || undefined} role="img" aria-label="Sunlight and Earth link through the stay" title="Sunlight (top) and Earth link (bottom) through the stay">
      <div className="sel-lane" data-kind="sun">
        {ready && light.sun.map((iv) => <i key={iv.start_ms} style={place(iv)} />)}
      </div>
      <div className="sel-lane" data-kind="earth">
        {ready && light.earth.map((iv) => <i key={iv.start_ms} style={place(iv)} />)}
      </div>
      <StayPlayhead start_ms={start_ms} end_ms={end_ms} />
    </div>
  );
}

interface SelectionProps {
  name: string;
  t_ms: number;
  end_ms: number;
  light: StayLight | null;
  verdict: Verdict | null;
  limiting: string | null;
  n: number | null;
  pinned: boolean;
  canPin: boolean;
  away: boolean;
  onShift(days: number): void;
  onPin(): void;
  onUnpin(): void;
  onSearchHere(): void;
  onOpen(): void;
}

export function Selection({ name, t_ms, end_ms, light, verdict, limiting, n, pinned, canPin, away, onShift, onPin, onUnpin, onSearchHere, onOpen }: SelectionProps) {
  return (
    <section className="sel" aria-label="Selected landing">
      <span className="sel-mark" aria-hidden="true">
        <Icon name="target" size={16} />
      </span>
      <div className="sel-main">
        <strong className="sel-site">{name}</strong>
        <span className="sel-sub">
          <span className="num">
            {dayText(t_ms)} · {new Date(t_ms).toISOString().slice(11, 16)} UTC
          </span>
          {verdict && (
            <span className="sel-verdict" data-tone={verdict}>
              {VERDICT_LABEL[verdict]}
              {verdict !== "pass" && limiting ? ` · ${limiting}` : ""}
            </span>
          )}
          {n !== null && <span className="num">Rank {n}</span>}
        </span>
      </div>
      <StayStrip light={light} start_ms={t_ms} end_ms={end_ms} />
      <div className="sel-tools">
        <IconButton icon="chevronLeft" size="sm" label="One day earlier" onClick={() => onShift(-1)} />
        <Popover label="Set landing time" icon="clock" iconOnly align="end" width={380}>
          <div className="sc-section">
            <UtcField path={["landing_utc"]} label="Landing" />
          </div>
        </Popover>
        <IconButton icon="chevronRight" size="sm" label="One day later" onClick={() => onShift(1)} />
        {pinned ? (
          <IconButton icon="close" size="sm" label={`Unpin ${name}`} onClick={onUnpin} />
        ) : canPin ? (
          <IconButton icon="pin" size="sm" label={`Pin ${name}`} onClick={onPin} />
        ) : null}
        {away && (
          <Button size="sm" variant="ghost" icon="search" onClick={onSearchHere}>
            Search here
          </Button>
        )}
        <Button size="sm" onClick={onOpen}>
          Open in Site
        </Button>
      </div>
    </section>
  );
}
