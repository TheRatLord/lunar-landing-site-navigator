import { useLayoutEffect, useRef, type ReactNode } from "react";

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  maxLength: number;
  disabled?: boolean;
  tools: ReactNode;
  actions: ReactNode;
}

export function ComposeBox({ id, label, value, onChange, onSubmit, placeholder, maxLength, disabled, tools, actions }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="ask-compose">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={area}
        id={id}
        className="ask-compose-text"
        rows={1}
        maxLength={maxLength}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="ask-compose-bar">
        <div className="ask-compose-tools">{tools}</div>
        <div className="ask-compose-actions toolstrip">{actions}</div>
      </div>
    </div>
  );
}
