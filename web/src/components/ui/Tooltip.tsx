import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: ReactNode;
  shortcut?: string;
  children: ReactElement;
  placement?: "top" | "bottom";
}

interface Position {
  x: number;
  y: number;
  place: "top" | "bottom";
}

export function Tooltip({ content, shortcut, children, placement = "top" }: TooltipProps) {
  const id = useId();
  const [pos, setPos] = useState<Position | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(
    (el: HTMLElement) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const place = placement === "top" && r.top < 48 ? "bottom" : placement;
        setPos({ x: r.left + r.width / 2, y: place === "top" ? r.top : r.bottom, place });
      }, 350);
    },
    [placement],
  );
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setPos(null);
  }, []);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pos, hide]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <span
        className="tt-wrap"
        aria-describedby={pos ? id : undefined}
        onMouseEnter={(e: MouseEvent<HTMLElement>) => show(e.currentTarget)}
        onMouseLeave={hide}
        onFocus={(e: FocusEvent<HTMLElement>) => {
          if ((e.target as HTMLElement).matches(":focus-visible")) show(e.currentTarget);
        }}
        onBlur={hide}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div id={id} role="tooltip" className={`tooltip tooltip-${pos.place}`} style={{ left: pos.x, top: pos.y }}>
            {content}
            {shortcut && <kbd className="kbd">{shortcut}</kbd>}
          </div>,
          document.body,
        )}
    </>
  );
}
