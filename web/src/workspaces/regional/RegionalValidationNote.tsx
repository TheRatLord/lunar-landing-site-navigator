import { useEffect, useState } from "react";
import { Disclosure } from "../../components/ui/Disclosure";
import { Pairs } from "../../components/ui/Pairs";
import { formatSig } from "../../lib/format";
import { READING, configurationPairs, getRegionalValidation, measuredError, recordDocId, signedError, type RegionalValidationRecord } from "../../api/regionalValidation";
import { ValidationNote } from "../search/ValidationNote";

let cached: Promise<RegionalValidationRecord | null> | null = null;

function useRegionalValidation(): { record: RegionalValidationRecord | null; settled: boolean } {
  const [state, setState] = useState<{ record: RegionalValidationRecord | null; settled: boolean }>({ record: null, settled: false });
  useEffect(() => {
    let live = true;
    cached ??= getRegionalValidation().then(
      (r) => r,
      () => {
        cached = null;
        return null;
      },
    );
    void cached.then((r) => live && setState({ record: r, settled: true }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

const v = (x: number | null) => (x === null ? "–" : formatSig(x, 3));

export function RegionalValidationNote() {
  const { record, settled } = useRegionalValidation();
  const doc = record ? recordDocId(record.document) : null;
  const bracketOnly = record ? record.layers.filter((l) => l.point_value === "bracket_only").map((l) => l.layer) : [];
  return (
    <ValidationNote
      width={760}
      status={record ? "measured" : settled ? "unavailable" : "loading"}
      measured={
        record ? (
          <>
            <Pairs className="ch-dl" rows={[["Engine", record.measured_by]]} />
            <Disclosure title="Configuration" count={configurationPairs(record.configuration).length}>
              <ul className="vn-conf num">
                {configurationPairs(record.configuration).map((pair) => (
                  <li key={pair}>{pair}</li>
                ))}
              </ul>
            </Disclosure>
            <div className="vn-scroll">
              <table className="vn-table num" aria-label="Measured error of the regional layers, from the engine's validation record">
                <thead>
                  <tr>
                    <th scope="col">Layer</th>
                    <th scope="col">Reading</th>
                    <th scope="col">Bracket contained the exact value</th>
                    <th scope="col">Mean signed error</th>
                    <th scope="col">Mean absolute error</th>
                    <th scope="col">95th percentile</th>
                    <th scope="col">99th percentile</th>
                    <th scope="col">Largest</th>
                    <th scope="col">Error unit</th>
                  </tr>
                </thead>
                <tbody>
                  {record.layers.map((l) => {
                    const e = measuredError(l);
                    const c = l.bracket_coverage;
                    return (
                      <tr key={l.layer}>
                        <th scope="row">{l.layer.replace(/_/g, " ")}</th>
                        <td>{READING[l.point_value]}</td>
                        <td>
                          {formatSig(c.coverage * 100, 4)} % of {c.cells.toLocaleString("en-US")} cells ({c.misses} {c.misses === 1 ? "miss" : "misses"}, calibrated for {formatSig(c.calibration_target * 100, 3)} %)
                        </td>
                        <td>{signedError(e.mean_signed, l.error_unit)}</td>
                        <td>{v(e.mean_abs)}</td>
                        <td>{v(e.p95_abs)}</td>
                        <td>{v(e.p99_abs)}</td>
                        <td>{v(e.max_abs)}</td>
                        <td>{l.error_unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : settled ? (
          <p className="num">GET /meta/regional-validation: not served</p>
        ) : null
      }
      preview={bracketOnly.length > 0 ? `${bracketOnly.map((n) => n.replace(/_/g, " ")).join(" and ")}: range only (bracket low to bracket high)` : undefined}
      sources={doc && record ? [{ doc, label: record.document }] : [{ doc: "validation/illumination", label: "docs/validation/illumination.md" }]}
    />
  );
}
