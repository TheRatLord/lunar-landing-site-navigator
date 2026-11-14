import { useRef, useState } from "react";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { Segmented } from "../../components/ui/Segmented";
import { formatUtc, parseUtc } from "../../lib/time";
import { useScenario } from "../store";
import type { Transfer } from "../types";
import { GroupHead, NumberField, Row, TextField } from "./controls";
import { USER_ORIGIN } from "./fieldState";
import { parseTransferTable } from "./transferTable";

type Kind = "none" | "fixed" | "table";
const isKind = (v: string): v is Kind => v === "none" || v === "fixed" || v === "table";

export function TransferSection() {
  const transfer = useScenario((s) => s.doc?.transfer);
  const edit = useScenario((s) => s.edit);
  const landingUtc = useScenario((s) => s.doc?.landing_utc);
  const [pasted, setPasted] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const kind: Kind = !transfer ? "none" : transfer.kind;

  const choose = (k: Kind) => {
    const fixed = k === "fixed";
    edit(["transfer"], k === "none" ? null : ({ kind: k, duration_days: fixed ? (transfer?.duration_days ?? null) : null, table: fixed ? [] : (transfer?.table ?? []), label: transfer?.label ?? "", origin: transfer?.origin ?? USER_ORIGIN } satisfies Transfer));
  };

  const applyTable = (text: string, source: string) => {
    const r = parseTransferTable(text);
    setErrors(r.errors);
    if (r.errors.length || !transfer) return;
    edit(["transfer"], { ...transfer, kind: "table", table: r.rows, origin: { ...USER_ORIGIN, label: `Imported launch-to-landing table (${source})` } } satisfies Transfer);
    setPasted("");
  };

  const rows = transfer?.table ?? [];
  const landing = landingUtc ? parseUtc(landingUtc) : null;
  const match = landing === null ? null : rows.find((r) => Math.abs((parseUtc(r.landing_utc) ?? 0) - landing) < 60_000);

  return (
    <div className="sc-section">
      <div className="sc-group">
        <GroupHead title="Launch to landing" />
        <div className="sc-toolrow">
          <Segmented
            label="Transfer model"
            size="sm"
            value={kind}
            onChange={(v) => isKind(v) && choose(v)}
            options={[
              { value: "none", label: "None" },
              { value: "fixed", label: "Fixed" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
        {kind === "fixed" && (
          <>
            <NumberField path={["transfer", "duration_days"]} label="Duration" unit="d" min={0} exclusiveMin step={0.5} nullable />
            <TextField path={["transfer", "label"]} label="Label" placeholder="Direct, 4.5 d" />
          </>
        )}
        {kind === "table" && (
          <>
            <TextField path={["transfer", "label"]} label="Label" placeholder="Launch period" />
            <Row label="Rows" htmlFor="transfer-paste" top>
              <textarea
                id="transfer-paste"
                className="input sc-textarea num"
                rows={4}
                spellCheck={false}
                placeholder={"launch_utc,landing_utc\n2027-03-01 10:00,2027-03-05 02:30"}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
            </Row>
            <div className="sc-actions">
              <Button size="sm" disabled={!pasted.trim()} onClick={() => applyTable(pasted, "pasted")}>
                Apply
              </Button>
              <IconButton icon="download" label="Import CSV" size="sm" onClick={() => fileRef.current?.click()} />
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void f.text().then((t) => applyTable(t, f.name));
                }}
              />
            </div>
            {errors.length > 0 && (
              <ul className="sc-msg sc-errlist" role="alert">
                {errors.slice(0, 6).map((m) => (
                  <li key={m}>{m}</li>
                ))}
                {errors.length > 6 && <li className="num">+{errors.length - 6}</li>}
              </ul>
            )}
          </>
        )}
      </div>
      {kind === "table" && (
        <div className="sc-group">
          <GroupHead title="Table">
            <span className="chip num">
              {rows.length} row{rows.length === 1 ? "" : "s"}
            </span>
            {rows.length > 0 &&
              (match ? (
                <span className="chip chip-pass">
                  <Icon name="check" size={12} /> Matches landing
                </span>
              ) : (
                <span className="chip chip-marginal">
                  <Icon name="warn" size={12} /> No landing match
                </span>
              ))}
          </GroupHead>
          {rows.length === 0 ? (
            <EmptyState icon="table" title="No rows yet" />
          ) : (
            <div className="sc-tablewrap">
              <table className="table">
                <caption className="sr-only">Launch-to-landing table, UTC</caption>
                <thead>
                  <tr>
                    <th scope="col">Launch</th>
                    <th scope="col">Landing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 40).map((r) => (
                    <tr key={r.launch_utc} aria-current={r === match ? "true" : undefined} className={r === match ? "sc-row-hit" : ""}>
                      <td className="num">{formatUtc(parseUtc(r.launch_utc) ?? 0, { seconds: false })}</td>
                      <td className="num">{formatUtc(parseUtc(r.landing_utc) ?? 0, { seconds: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 40 && <p className="dim num sc-more">+{rows.length - 40}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
