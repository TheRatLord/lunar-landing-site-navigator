import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";
import { PopoverPanel } from "./Popover";

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Short right-aligned secondary text: a shortcut, a value, a state word. */
  hint?: string;
  disabled?: boolean;
  /** Defined makes the item a `menuitemcheckbox`. */
  checked?: boolean;
  /** Draws a separator above the item. */
  divider?: boolean;
  onSelect: () => void;
  /** Leave the menu open after selecting. */
  keepOpen?: boolean;
}

export interface MenuProps {
  /** Accessible name of the menu and, for `iconOnly`, of the trigger. */
  label: string;
  /** Visible trigger text when it differs from `label`; `label` stays in the accessible name. */
  text?: ReactNode;
  icon?: IconName;
  iconOnly?: boolean;
  align?: "start" | "end";
  width?: number;
  items: MenuItem[];
  /** Rendered under the list inside the panel (status rows). */
  footer?: ReactNode;
  disabled?: boolean;
}

const ENABLED = "[role^=menuitem]:not(:disabled)";

function MenuList({ label, items, onClose, onSelect, footer }: { label: string; items: MenuItem[]; onClose: () => void; onSelect: (item: MenuItem) => void; footer: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(ENABLED)?.focus({ preventScroll: true });
  }, []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const enabled = [...(list.current?.querySelectorAll<HTMLElement>(ENABLED) ?? [])];
    if (enabled.length === 0) return;
    const at = enabled.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? enabled.length - 1 : e.key === "ArrowDown" ? (at + 1) % enabled.length : (at <= 0 ? enabled.length : at) - 1;
    enabled[next]?.focus();
  };

  return (
    <>
      <div ref={list} role="menu" aria-label={label} className="menu" onKeyDown={onKey}>
        {items.map((it) => (
          <Fragment key={it.id}>
            {it.divider && <div role="separator" className="menu-sep" />}
            <button
              type="button"
              role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={it.checked}
              tabIndex={-1}
              className="menu-item"
              disabled={it.disabled}
              onClick={() => onSelect(it)}
            >
              {it.checked !== undefined ? (
                <span className="menu-check" aria-hidden="true">
                  {it.checked && <Icon name="check" size={14} />}
                </span>
              ) : (
                it.icon && <Icon name={it.icon} size={14} />
              )}
              <span className="menu-label">{it.label}</span>
              {it.hint && <span className="menu-hint num">{it.hint}</span>}
            </button>
          </Fragment>
        ))}
      </div>
      {footer}
    </>
  );
}

export function Menu({ label, text, icon, iconOnly = false, align = "start", width = 200, items, footer, disabled }: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const closeToTrigger = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const select = (it: MenuItem) => {
    if (!it.keepOpen) closeToTrigger();
    it.onSelect();
  };

  const triggerProps = {
    disabled,
    variant: "ghost" as const,
    size: "sm" as const,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: () => setOpen(!open),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowDown" && !open) {
        e.preventDefault();
        setOpen(true);
      }
    },
  };

  return (
    <>
      {iconOnly && icon ? (
        <IconButton ref={trigger} icon={icon} label={label} {...triggerProps} />
      ) : (
        <Button ref={trigger} icon={icon} {...triggerProps}>
          {text === undefined ? (
            label
          ) : (
            <>
              <span className="sr-only">{label} </span>
              {text}
            </>
          )}
          <Icon name="chevronDown" size={12} className="pop-chevron" />
        </Button>
      )}
      <PopoverPanel id={menuId} role="none" open={open} anchor={trigger} onClose={() => setOpen(false)} label={label} align={align} width={width} className="menu-panel">
        <MenuList label={label} items={items} footer={footer} onSelect={select} onClose={closeToTrigger} />
      </PopoverPanel>
    </>
  );
}
