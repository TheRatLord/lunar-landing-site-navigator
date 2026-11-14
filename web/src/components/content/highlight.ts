import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("yaml", yaml);

const ALIASES: Record<string, string> = { sh: "bash", shell: "bash", py: "python", js: "javascript", ts: "typescript", yml: "yaml", md: "markdown", jsonl: "json" };

const HIGHLIGHT_LIMIT = 200_000;

export function highlightHtml(code: string, language: string | undefined): string | null {
  if (!language || code.length > HIGHLIGHT_LIMIT) return null;
  const lang = ALIASES[language] ?? language;
  if (!hljs.getLanguage(lang)) return null;
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}
