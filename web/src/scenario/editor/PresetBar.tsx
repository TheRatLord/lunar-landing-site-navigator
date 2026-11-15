import { useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Progress";
import { ServiceNotice } from "../../components/ServiceNotice";
import { usePresets, type Presets } from "./usePresets";

interface PresetBarProps {
  label: string;
  what: string;
  options: (data: Presets) => ReactNode;
  onApply: (choice: string, data: Presets) => void;
}

/** Select + apply row for replacing a section from a service preset; shows the service error when presets cannot load. */
export function PresetBar({ label, what, options, onApply }: PresetBarProps) {
  const presets = usePresets();
  const [choice, setChoice] = useState("");
  if (presets.status === "loading") return <Spinner size={14} />;
  if (presets.status === "error") return <ServiceNotice error={presets.error} what={what} />;
  return (
    <div className="sc-pick">
      <select className="select" aria-label={label} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">{label}…</option>
        {options(presets.data)}
      </select>
      <Button
        size="sm"
        disabled={!choice}
        onClick={() => {
          onApply(choice, presets.data);
          setChoice("");
        }}
      >
        Load preset
      </Button>
    </div>
  );
}
