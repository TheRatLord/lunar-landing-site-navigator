import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Popover } from "../../components/ui/Popover";
import { evidenceHref } from "../../lib/evidence";
import "../../styles/chrome.css";

interface ValidationSource {
  doc: string;
  label: string;
  section?: string;
}

const STATUS = {
  measured: { label: "Measured", icon: "check", tone: "pass" },
  unavailable: { label: "Unavailable", icon: "warn", tone: "marginal" },
  loading: { label: "Loading", icon: "clock", tone: "default" },
} as const;

interface ValidationNoteProps {
  sources: ValidationSource[];
  measured?: ReactNode;
  preview?: ReactNode;
  status?: keyof typeof STATUS;
  width?: number;
}

export function ValidationNote({ sources, measured, preview, status = "measured", width }: ValidationNoteProps) {
  const s = STATUS[status];
  return (
    <span className="vn" role="note" aria-label="Validation" data-testid="validation-note">
      <Popover label={s.label} icon={s.icon} tone={s.tone} width={width}>
        <div className="vn-pop">
          {measured}
          <ul className="vn-sources" aria-label="Validation reports">
            {sources.map((src) => (
              <li key={src.doc + src.label}>
                <Link to={evidenceHref(src.doc, src.section)}>{src.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      </Popover>
      {preview && (
        <Popover label="Preview, not validated" icon="warn" tone="marginal" width={width}>
          <div className="vn-pop">{preview}</div>
        </Popover>
      )}
    </span>
  );
}

export function SearchValidationNote() {
  return <ValidationNote sources={[{ doc: "validation/scenario", label: "docs/validation/scenario.md, section 10 (Inverse site search)", section: "10" }]} />;
}
