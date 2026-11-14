import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { citationHref, splitCitations } from "../../agent/citations";
import { CodeBlock } from "./CodeBlock";
import { classifyHref, imageSource } from "./markdownSafety";

export interface MarkdownProps {
  source: string;
  resolveImage?: (src: string) => string;
  resolveLink?: (href: string) => string | undefined;
  onCite?: (id: string, row: string | null) => void;
  citeKind?: (id: string, row: string | null) => { kinds: string[]; label: string } | undefined;
  className?: string;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

type HNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HNode[] };

function rehypeCitations() {
  const walk = (node: HNode) => {
    if (!node.children) return;
    const next: HNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string") {
        const parts = splitCitations(child.value);
        if (parts.length === 1 && parts[0]!.kind === "text") {
          next.push(child);
          continue;
        }
        for (const p of parts) {
          if (p.kind === "text") next.push({ type: "text", value: p.text });
          else if (p.kind === "flag") next.push({ type: "element", tagName: "span", properties: { className: ["md-flag"] }, children: [{ type: "text", value: p.text }] });
          else next.push({ type: "element", tagName: "a", properties: { href: citationHref(p.id), className: ["md-cite"] }, children: [{ type: "text", value: p.id }] });
        }
        continue;
      }
      if (child.type === "element" && (child.tagName === "code" || child.tagName === "pre" || child.tagName === "a")) {
        next.push(child);
        continue;
      }
      walk(child);
      next.push(child);
    }
    node.children = next;
  };
  return (tree: HNode) => walk(tree);
}

const keepUrl = (url: string): string => url;

const CITE_HREF = /^#(?:ledger|assumption|artifact|cite)-([LSAFD]\d{3,6})(?:\/([A-Za-z0-9_.:/-]{1,80}))?$/;

export const Markdown = memo(function Markdown({ source, resolveImage, resolveLink, onCite, citeKind, className }: MarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      code({ className: cls, children }) {
        const lang = /language-([\w-]+)/.exec(cls ?? "")?.[1];
        const text = textOf(children);
        const block = lang !== undefined || text.endsWith("\n");
        if (!block) return <code className="md-inline-code">{children}</code>;
        return <CodeBlock code={text.replace(/\n$/, "")} language={lang} label={lang} collapseAfter={30} />;
      },
      pre: ({ children }) => <>{children}</>,
      a({ href, children }) {
        if (!href) return <>{children}</>;
        const hit = CITE_HREF.exec(href);
        const cited = hit?.[1];
        const citedRow = hit?.[2] ?? null;
        if (cited && onCite) {
          const source = citeKind?.(cited, citedRow);
          const open = citedRow === null ? `Open record ${cited}` : `Open record ${cited} at row ${citedRow}`;
          return (
            <>
              <a
                href={href}
                className="md-cite"
                data-source-kinds={source?.kinds.join(" ")}
                title={source ? `${open} (${source.label})` : open}
                onClick={(e) => {
                  e.preventDefault();
                  onCite(cited, citedRow);
                }}
              >
                {children}
              </a>
              {source && !(source.kinds.length === 1 && source.kinds[0] === "engine_result") && (
                <span className="md-cite-kind" data-source-kinds={source.kinds.join(" ")}>
                  {source.label}
                </span>
              )}
            </>
          );
        }
        const first = classifyHref(href);
        const c = first.kind === "relative" ? classifyHref(resolveLink?.(href) ?? "") : first;
        if (c.kind === "external") {
          const same = textOf(children).trim() === href.trim() || textOf(children).trim() === c.href;
          return (
            <>
              <a href={c.href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
              {!same && <span className="md-href"> ({c.href})</span>}
            </>
          );
        }
        if (c.kind === "fragment" || c.kind === "relative") return <a href={c.href}>{children}</a>;
        return (
          <span className="md-link-blocked">
            {children} <span className="md-href">({href})</span>
          </span>
        );
      },
      img({ src, alt }) {
        if (!src) return null;
        const url = imageSource(src, resolveImage);
        if (url === null) {
          return (
            <span className="md-img-blocked" role="img" aria-label={`Image not loaded: ${alt ?? ""}`}>
              Image not loaded{alt ? `: ${alt}` : ""} <span className="md-href">({src})</span>
            </span>
          );
        }
        return <img src={url} alt={alt ?? ""} loading="lazy" className="md-img" />;
      },
      table: ({ children }) => (
        <div className="md-table-wrap" tabIndex={0}>
          <table>{children}</table>
        </div>
      ),
      th: ({ children, style }) => (textOf(children).trim() === "" ? <td style={style} /> : <th style={style}>{children}</th>),
    }),
    [resolveImage, resolveLink, onCite, citeKind],
  );
  const rehypePlugins = useMemo(() => (onCite ? [rehypeSlug, rehypeCitations] : [rehypeSlug]), [onCite]);
  return (
    <div className={`md ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components} urlTransform={keepUrl}>
        {source}
      </ReactMarkdown>
    </div>
  );
});
