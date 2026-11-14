import { useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Progress";
import { ServiceNotice } from "../../components/ServiceNotice";
import type { ProfileEntry } from "../api";
import { usePresets, type Presets } from "./usePresets";

export function ProfileOptions({ profiles }: { profiles: ProfileEntry[] }) {
  return (
    <>
      <optgroup label="Catalogue landers">
        {profiles
          .filter((p) => p.source === "catalog")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </optgroup>
      <optgroup label="Generic layouts">
        {profiles
          .filter((p) => p.source === "generic")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </optgroup>
    </>
  );
}

interface PresetBarProps {
  label: string;
  what: string;
  /** Option elements for the preset select (receives the loaded presets). */
  options: (data: Presets) => ReactNode;
  onApply: (choice: string, data: Presets) => void;
  extra?: (choice: string, data: Presets) => ReactNode;
}

/** Select + apply row for replacing a section from a service preset; shows the service error when presets cannot load. */
export function PresetBar({ label, what, options, onApply, extra }: PresetBarProps) {
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
      {extra?.(choice, presets.data)}
    </div>
  );
}
