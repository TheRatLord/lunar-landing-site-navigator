import type { Verdict } from "../../contract/types";
import { Button, IconButton } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { VERDICT_LABEL } from "../../lib/verdict";
import { UtcField } from "../../scenario/editor/controls";
import { dayText } from "../../scenario/when";

interface SelectionProps {
  name: string;
  t_ms: number;
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

export function Selection({ name, t_ms, verdict, limiting, n, pinned, canPin, away, onShift, onPin, onUnpin, onSearchHere, onOpen }: SelectionProps) {
  return (
    <section className="sel" aria-label="Selected landing">
      <div className="sel-main">
        <span className="sel-tag">Selected</span>
        <strong className="sel-site">{name}</strong>
        <span className="sel-when num">
          {dayText(t_ms)} {new Date(t_ms).toISOString().slice(11, 16)} UTC
        </span>
        {verdict && (
          <span className="sel-verdict" data-tone={verdict}>
            {VERDICT_LABEL[verdict]}
            {verdict !== "pass" && limiting ? ` · ${limiting}` : ""}
          </span>
        )}
        {n !== null && <span className="sel-rank num">#{n}</span>}
      </div>
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
