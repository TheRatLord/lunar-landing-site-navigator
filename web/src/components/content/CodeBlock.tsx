import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../../state/toasts";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { highlightHtml } from "./highlight";

export interface CodeBlockProps {
  code: string;
  language?: string;
  label?: string;
  collapseAfter?: number;
}

export function CodeBlock({ code, language, label, collapseAfter = 20 }: CodeBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const lines = useMemo(() => code.split("\n"), [code]);
  const collapsible = lines.length > collapseAfter + 4;
  const shown = collapsible && !expanded ? lines.slice(0, collapseAfter).join("\n") : code;
  const html = useMemo(() => highlightHtml(shown, language), [shown, language]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      () => toast({ kind: "error", title: "Copy failed", detail: "The browser refused clipboard access." }),
    );
  };

  return (
    <figure className="code">
      <figcaption className="code-head">
        <span className="code-label">{label ?? language ?? "text"}</span>
        {label && language && language !== "plaintext" && language !== label && <span className="code-lang">{language}</span>}
        <span className="grow" />
        <span className="code-meta">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
        <IconButton size="sm" icon={copied ? "check" : "copy"} label={copied ? "Copied" : `Copy ${label ?? "code"}`} onClick={copy} />
      </figcaption>
      <pre className="code-pre" tabIndex={0} aria-label={label ?? "code"}>
        {html === null ? <code>{shown}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
      {collapsible && (
        <button type="button" className="code-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} />
          {expanded ? "Collapse" : `Show all ${lines.length} lines`}
        </button>
      )}
    </figure>
  );
}
