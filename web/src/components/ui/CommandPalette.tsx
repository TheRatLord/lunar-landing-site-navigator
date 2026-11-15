import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { fuzzyScore } from "../../lib/fuzzy";
import { Icon, type IconName } from "./Icon";

export interface Command {
  id: string;
  title: string;
  group: string;
  icon?: IconName;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  return open ? <PaletteDialog onClose={onClose} commands={commands} /> : null;
}

function PaletteDialog({ onClose, commands }: Omit<CommandPaletteProps, "open">) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((c) => ({ c, s: fuzzyScore(query, `${c.title} ${c.group} ${c.keywords ?? ""}`) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
  }, [commands, query]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  return createPortal(
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active]!.id}` : undefined}
            aria-label="Search commands"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            spellCheck={false}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" className="palette-list">
          {results.length === 0 && <li className="palette-empty">No matching commands</li>}
          {results.map((c, i) => [
            c.group !== results[i - 1]?.group && (
              <li key={`group-${c.group}-${i}`} role="presentation" className="palette-heading">
                {c.group}
              </li>
            ),
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onMouseMove={() => setActive(i)}
              onClick={() => run(c)}
            >
              <span className="palette-icon">{c.icon && <Icon name={c.icon} size={14} />}</span>
              <span className="palette-title">{c.title}</span>
              {c.shortcut && <kbd className="kbd">{c.shortcut}</kbd>}
            </li>,
          ])}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
