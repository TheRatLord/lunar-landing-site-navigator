import type { ReactNode } from "react";

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  maxLength: number;
  rows: number;
  disabled?: boolean;
  fill?: boolean;
  tools: ReactNode;
  actions: ReactNode;
}

export function ComposeBox({ id, label, value, onChange, onSubmit, placeholder, maxLength, rows, disabled, fill, tools, actions }: Props) {
  return (
    <div className={`ask-compose ${fill ? "is-fill" : ""}`}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="ask-compose-text"
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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
