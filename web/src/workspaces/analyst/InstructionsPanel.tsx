import { useState } from "react";
import { compareTemplateHash, formatCost, shortToolName } from "../../agent/format";
import type { InstructionsInfo } from "../../agent/events";
import { CodeBlock } from "../../components/content/CodeBlock";
import { Markdown } from "../../components/content/Markdown";
import { Disclosure } from "../../components/ui/Disclosure";
import { Icon } from "../../components/ui/Icon";
import { Segmented } from "../../components/ui/Segmented";
import { Chip } from "./Chip";
import { CopyHash } from "./LedgerPanels";

interface InstructionsPanelProps {
  instructions: InstructionsInfo;
  source: "run" | "service";
  current?: InstructionsInfo | null;
  runBudgetUsd?: number | null;
}

export function InstructionsPanel({ instructions: ins, source, current, runBudgetUsd }: InstructionsPanelProps) {
  const [rawPrompt, setRawPrompt] = useState(false);
  const [openTool, setOpenTool] = useState<string | null>(null);
  const tools = ins.tools;
  const differs = source === "run" && current && current.prompt_version !== ins.prompt_version;
  const template = source === "run" ? compareTemplateHash(ins.prompt_template_sha256, current?.prompt_template_sha256) : "unknown";
  const sandbox = ins.sandbox;
  const policy = ins.permission_policy;

  return (
    <div className="ins">
      {differs && current && (
        <p className="ins-differs" role="status">
          <Chip tone="marginal" icon="warn">
            Prompt differs
          </Chip>
          <span className="mono">{ins.prompt_version}</span>
          <Icon name="chevronRight" size={11} />
          <span className="mono">{current.prompt_version}</span>
        </p>
      )}
      <dl className="ev-kv">
        <dt>Model</dt>
        <dd className="mono">{ins.model}</dd>
        <dt>Prompt</dt>
        <dd>
          <span className="mono">{ins.prompt_version}</span> <CopyHash value={ins.prompt_sha256} label="full hash" done="Hash copied" />
        </dd>
        <dt>Template</dt>
        <dd>
          <CopyHash value={ins.prompt_template_sha256} label="full hash" done="Hash copied" />{" "}
          {template === "match" && (
            <Chip tone="pass" icon="check">
              Current
            </Chip>
          )}
          {template === "differs" && (
            <Chip tone="marginal" icon="warn">
              Differs
            </Chip>
          )}
        </dd>
        <dt>Spend cap</dt>
        <dd data-testid="max-budget" className="num">
          {source === "run" && typeof runBudgetUsd === "number" ? (
            formatCost(runBudgetUsd)
          ) : ins.max_budget_usd === undefined ? (
            <span className="faint">–</span>
          ) : ins.max_budget_usd === null ? (
            "No cap"
          ) : (
            `$${ins.max_budget_usd.toFixed(2)}`
          )}
        </dd>
        {ins.workspace && (
          <>
            <dt>Working directory</dt>
            <dd className="mono">{ins.workspace}</dd>
          </>
        )}
        {ins.versions &&
          Object.entries(ins.versions).map(([k, v]) => (
            <div key={k} className="ev-kv-row">
              <dt>{k.replace(/_/g, " ")}</dt>
              <dd className="mono">{v}</dd>
            </div>
          ))}
      </dl>

      <Disclosure title="Sandbox">
        {sandbox ? (
          <div className="ins-block">
            <p className="ins-line">
              <Chip tone={sandbox.enabled ? "pass" : "marginal"} icon={sandbox.enabled ? "shield" : "warn"}>
                {sandbox.enabled ? "Enabled" : "Not enabled"}
              </Chip>
              {sandbox.mode && <span className="mono">{sandbox.mode}</span>}
              {sandbox.available === false && <Chip>Unavailable</Chip>}
            </p>
            {sandbox.detail && <p className="dim">{sandbox.detail}</p>}
            {sandbox.network_allowed_domains !== undefined && (
              <p className="dim">
                Network {sandbox.network_allowed_domains ? sandbox.network_allowed_domains.map((d) => <code key={d}>{d} </code>) : "any host"}
              </p>
            )}
            {sandbox.filesystem && <CodeBlock code={JSON.stringify(sandbox.filesystem, null, 2)} language="json" label="filesystem" collapseAfter={8} />}
          </div>
        ) : (
          <p className="faint">–</p>
        )}
      </Disclosure>

      <Disclosure title="Permission policy">{policy ? <CodeBlock code={JSON.stringify(policy, null, 2)} language="json" label="policy" collapseAfter={24} /> : <p className="faint">–</p>}</Disclosure>

      <Disclosure title="Tools" count={tools.length}>
        <ul className="ins-tools">
          {tools.map((t) => {
            const open = openTool === t.name;
            return (
              <li key={t.name}>
                <button type="button" className="ins-tool" aria-expanded={open} onClick={() => setOpenTool(open ? null : t.name)}>
                  <Icon name="chevronRight" size={12} className="ev-chevron" />
                  <span className="ev-tool-name">{shortToolName(t.name)}</span>
                  <span className="grow" />
                  <Chip>{t.kind}</Chip>
                  {!t.read_only && <Chip tone="marginal">Writes</Chip>}
                </button>
                {open && (
                  <div className="ins-tool-body">
                    {t.description && <p>{t.description}</p>}
                    {t.input_schema && <CodeBlock code={JSON.stringify(t.input_schema, null, 2)} language="json" label="input schema" collapseAfter={20} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Disclosure>

      <Disclosure title="System prompt">
        <div className="ins-block">
          <Segmented
            label="System prompt format"
            size="sm"
            value={rawPrompt ? "raw" : "rendered"}
            onChange={(v) => setRawPrompt(v === "raw")}
            options={[
              { value: "rendered", label: "Rendered" },
              { value: "raw", label: "Raw" },
            ]}
          />
          {rawPrompt ? <CodeBlock code={ins.instructions} language="markdown" label="system prompt" collapseAfter={400} /> : <Markdown source={ins.instructions} className="ins-prompt" />}
        </div>
      </Disclosure>
    </div>
  );
}
