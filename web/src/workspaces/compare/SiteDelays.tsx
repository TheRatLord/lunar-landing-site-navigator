import type { SlipResult, SlipSite } from "../../api/planning";
import { IconButton } from "../../components/ui/Button";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Disclosure } from "../../components/ui/Disclosure";
import { formatLat, formatLon } from "../../lib/coords";
import { formatSigned } from "../../lib/format";
import { mixedKindsNote } from "../../lib/marginKind";
import { SlipChart } from "./SlipChart";
import { SlipTable } from "./SlipTable";

export function SiteDelays({
  result,
  index,
  name,
  onSelect,
  onClose,
}: {
  result: SlipResult;
  index: number;
  name: string;
  onSelect: (i: number) => void;
  onClose: () => void;
}) {
  const site = result.results[index]!;
  const n = site.rows.length;
  return (
    <div className="cmp-detail">
      <div className="cmp-sec-head">
        <h2 className="cmp-sec-title">{name}</h2>
        <span className="cmp-figs num">
          <span>
            <b>
              {site.n_pass}/{n}
            </b>{" "}
            pass
          </span>
          <span>
            <b>
              {site.n_open}/{n}
            </b>{" "}
            open
          </span>
        </span>
        {result.warnings.map((w) => (
          <span key={w} className="cmp-warn">
            {w}
          </span>
        ))}
        <span className="grow" />
        <IconButton icon="close" size="sm" label="Close site delays" onClick={onClose} />
      </div>
      <div className="cmp-slip">
        <div>
          <SlipChart rows={site.rows} />
        </div>
        <div className="cmp-slip-table">
          <SlipTable rows={site.rows} mode={result.mode} />
        </div>
      </div>
      {result.ranked && (
        <Disclosure title="Ranking" count={result.results.length}>
          <Ranking result={result} index={index} onSelect={onSelect} />
        </Disclosure>
      )}
    </div>
  );
}

function Ranking({ result, index, onSelect }: { result: SlipResult; index: number; onSelect: (i: number) => void }) {
  const kindsNote = mixedKindsNote(
    result.results.flatMap((s) => s.rows.map((r) => r.margin_kind)),
    `sites are ordered by ${result.ranking_key}`,
  );
  const columns: Column<{ s: SlipSite; i: number }>[] = [
    { key: "rank", header: "#", numeric: true, render: (r) => r.i + 1 },
    {
      key: "name",
      header: "Site",
      render: (r) => (
        <span>
          {r.s.site_name ?? r.s.scenario_name}
          <span className="cmp-dim num">
            {" "}
            {formatLat(r.s.site.lat_deg, 2)} {formatLon(r.s.site.lon_deg, 2)}
          </span>
        </span>
      ),
    },
    { key: "pass", header: "Pass", numeric: true, render: (r) => `${r.s.n_pass}/${r.s.rows.length}` },
    { key: "open", header: "Open", numeric: true, render: (r) => `${r.s.n_open}/${r.s.rows.length}` },
    {
      key: "margin",
      header: "Mean margin",
      unit: "× margin scale",
      numeric: true,
      render: (r) => (r.s.mean_margin === null ? "—" : formatSigned(r.s.mean_margin, 1)),
    },
  ];
  return (
    <div className="cmp-rank">
      <span className="chip">{result.ranking_key}</span>
      <DataTable
        caption="Sites ranked by delay tolerance"
        columns={columns}
        rows={result.results.map((s, i) => ({ s, i }))}
        rowKey={(r) => String(r.i)}
        selectedKey={String(index)}
        onRowClick={(r) => onSelect(r.i)}
      />
      {kindsNote && (
        <p className="cmp-note" role="note" data-testid="ranking-kinds-note">
          {kindsNote}
        </p>
      )}
    </div>
  );
}
