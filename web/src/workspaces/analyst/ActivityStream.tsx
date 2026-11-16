import { useEffect, useMemo, useRef, useState } from "react";
import { answerMarks, answerOutstanding, answerSources, isWorkBlock, type Block } from "../../agent/reduce";
import { IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Toolstrip } from "../../components/ui/Toolstrip";
import { BlockView, WorkGroup, type BlockActions } from "./Blocks";

type Item = { key: string; work: Block[] } | { key: string; block: Block };

function chatItems(blocks: readonly Block[]): Item[] {
  const items: Item[] = [];
  for (const b of blocks) {
    const last = items[items.length - 1];
    if (!isWorkBlock(b)) items.push({ key: b.key, block: b });
    else if (last && "work" in last) last.work.push(b);
    else items.push({ key: `work:${b.key}`, work: [b] });
  }
  return items.filter((item) => !("work" in item) || item.work.some((b) => b.kind !== "system"));
}

export function ActivityStream({ blocks, actions, live }: { blocks: readonly Block[]; actions: BlockActions; live: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const marks = useMemo(() => answerMarks(blocks), [blocks]);
  const sources = useMemo(() => answerSources(blocks, marks), [blocks, marks]);
  const outstanding = useMemo(() => answerOutstanding(blocks, marks), [blocks, marks]);
  const items = useMemo(() => chatItems(blocks), [blocks]);

  const last = blocks[blocks.length - 1];
  const lastLen = last && "text" in last ? last.text.length : 0;
  useEffect(() => {
    const el = scroller.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [blocks.length, lastLen, live]);

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

  const tail = items[items.length - 1];
  const tailBusy = tail !== undefined && ("work" in tail || (tail.block.kind === "text" && tail.block.streaming));

  return (
    <div className="stream-wrap">
      <div
        ref={scroller}
        className="stream"
        onScroll={onScroll}
        role="log"
        aria-label="Conversation"
        aria-live={live ? "polite" : "off"}
        aria-relevant="additions"
        tabIndex={0}
      >
        <div className="stream-col">
          {items.map((item, i) => (
            <div key={item.key} className="ev-wrap">
              {"work" in item ? (
                <WorkGroup blocks={item.work} actions={actions} live={live && i === items.length - 1} />
              ) : (
                <BlockView block={item.block} actions={actions} mark={marks.get(item.block.key)} sources={sources.get(item.block.key)} outstanding={outstanding.get(item.block.key)} />
              )}
            </div>
          ))}
          {live && !tailBusy && (
            <div className="chat-typing" role="status" aria-label="The assistant is working">
              <span />
              <span />
              <span />
            </div>
          )}
          {blocks.length === 0 && !live && <EmptyState icon="history" title="No messages" />}
        </div>
      </div>
      {away && (
        <Toolstrip float className="stream-jump">
          <IconButton icon="chevronDown" size="sm" label="Jump to latest" onClick={jump} />
        </Toolstrip>
      )}
    </div>
  );
}
