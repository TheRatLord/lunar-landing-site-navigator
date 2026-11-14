import { useEffect, useMemo, useRef, useState } from "react";
import { answerMarks, answerOutstanding, answerSources, type Block } from "../../agent/reduce";
import { IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Spinner } from "../../components/ui/Progress";
import { Toolstrip } from "../../components/ui/Toolstrip";
import { BlockView, type BlockActions } from "./Blocks";

export function ActivityStream({ blocks, actions, live }: { blocks: readonly Block[]; actions: BlockActions; live: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const marks = useMemo(() => answerMarks(blocks), [blocks]);
  const sources = useMemo(() => answerSources(blocks, marks), [blocks, marks]);
  const outstanding = useMemo(() => answerOutstanding(blocks, marks), [blocks, marks]);

  const last = blocks[blocks.length - 1];
  const lastLen = last && "text" in last ? last.text.length : 0;
  useEffect(() => {
    const el = scroller.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [blocks.length, lastLen]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    follow.current = atBottom;
    setAway(!atBottom);
  };

  const jump = () => {
    const el = scroller.current;
    if (!el) return;
    follow.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="stream-wrap">
      <div
        ref={scroller}
        className="stream"
        onScroll={onScroll}
        role="log"
        aria-label="Agent activity"
        aria-live={live ? "polite" : "off"}
        aria-relevant="additions"
        tabIndex={0}
      >
        {blocks.map((b) => (
          <div key={b.key} className="ev-wrap">
            <BlockView block={b} actions={actions} mark={marks.get(b.key)} sources={sources.get(b.key)} outstanding={outstanding.get(b.key)} />
          </div>
        ))}
        {blocks.length === 0 && (live ? <Spinner size={14} label="Waiting for events" /> : <EmptyState icon="history" title="No events" />)}
      </div>
      {away && (
        <Toolstrip float className="stream-jump">
          <IconButton icon="chevronDown" size="sm" label="Jump to latest" onClick={jump} />
        </Toolstrip>
      )}
    </div>
  );
}
