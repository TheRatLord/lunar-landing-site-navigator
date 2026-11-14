interface ToggleOption {
  value: string;
  label: string;
}

export function Toggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ToggleOption[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="l-toggle" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="l-toggle-btn"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
