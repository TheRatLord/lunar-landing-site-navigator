import type { ReactNode } from "react";
import { metaApi } from "../../api/endpoints";
import { useLoad, type Loaded } from "../../api/useLoad";
import { classifyHref } from "../../components/content/markdownSafety";
import { ServiceNotice } from "../../components/ServiceNotice";
import { IconButton } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { Spinner } from "../../components/ui/Progress";
import { toast } from "../../state/toasts";

type Scalar = string | number | boolean | null;
type Obj = Record<string, unknown>;

const HASH = /^(?:[a-z0-9]+:)?[0-9a-f]{32,}$/i;
const UNITS: Record<string, string> = { m: "m", deg: "°", h: "h", s: "s", bytes: "bytes" };

const isScalar = (v: unknown): v is Scalar => v === null || typeof v !== "object";
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function splitKey(k: string): { name: string; unit?: string } {
  const m = /^(.+)_(m|deg|h|s|bytes)$/.exec(k);
  return m ? { name: m[1]!, unit: UNITS[m[2]!] } : { name: k };
}

function label(k: string): string {
  if (/[A-Z#]/.test(k)) return k;
  const t = k.replace(/_/g, " ").replace(/\b(utc|url|dem|sha256|id)\b/g, (w) => (w === "sha256" ? "SHA-256" : w.toUpperCase()));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return Math.abs(n) >= 10000 ? n.toLocaleString("en-US") : String(n);
  return String(Number(n.toPrecision(6)));
}

function Hash({ value }: { value: string }) {
  const short = value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
  return (
    <span className="meta-hash">
      <code className="meta-hash-text" title={value}>
        {short}
      </code>
      <IconButton
        icon="copy"
        size="sm"
        label="Copy hash"
        onClick={() => navigator.clipboard.writeText(value).then(() => toast({ kind: "success", title: "Hash copied" }, 1500))}
      />
    </span>
  );
}

function StateChip({ on, onLabel, offLabel, offTone }: { on: boolean; onLabel: string; offLabel: string; offTone: "fail" | "neutral" }) {
  return (
    <span className={`chip ${on ? "chip-pass" : offTone === "fail" ? "chip-fail" : ""}`}>
      <Icon name={on ? "check" : "cross"} size={12} strokeWidth={2} />
      {on ? onLabel : offLabel}
    </span>
  );
}

function Value({ value, name, unit }: { value: Scalar; name: string; unit?: string }) {
  if (typeof value === "string" && HASH.test(value)) return <Hash value={value} />;
  if (typeof value === "boolean") {
    return /(^|_)available$/.test(name) ? (
      <StateChip on={value} onLabel="Available" offLabel="Unavailable" offTone="fail" />
    ) : (
      <StateChip on={value} onLabel="Yes" offLabel="No" offTone="neutral" />
    );
  }
  if (value === null) return <span className="faint">—</span>;
  if (typeof value === "number") {
    return (
      <span className="num" title={Number.isInteger(value) ? undefined : String(value)}>
        {formatNumber(value)}
        {unit && <span className="meta-unit">{unit}</span>}
      </span>
    );
  }
  const link = /^https?:\/\/\S+$/i.test(value) ? classifyHref(value) : null;
  if (link?.kind === "external") {
    return (
      <a className="meta-url" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href}>
        {link.href.replace(/^https?:\/\//, "")}
      </a>
    );
  }
  return <span className={name === "error" ? "meta-error" : "meta-text"}>{value}</span>;
}

function Table({ rows, cols }: { rows: Obj[]; cols: string[] }) {
  return (
    <div className="md-table-wrap" tabIndex={0} role="region" aria-label="Table">
      <table>
        <thead>
          <tr>
            {cols.map((c) => {
              const { name, unit } = splitKey(c);
              return (
                <th key={c} scope="col">
                  {label(name)}
                  {unit && <span className="meta-unit">{unit}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{c in r && isScalar(r[c]) ? <Value value={r[c]} name={c} /> : <Chips value={(r[c] as Scalar[] | undefined) ?? []} />}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chips({ value }: { value: readonly Scalar[] }) {
  return (
    <ul className="meta-chips">
      {value.map((v, i) => (
        <li key={i}>
          <Value value={v} name="" />
        </li>
      ))}
    </ul>
  );
}

function tableOf(value: unknown[]): { rows: Obj[]; cols: string[] } | null {
  const rows = value.filter(isObj);
  if (rows.length !== value.length || rows.length === 0) return null;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const simple = rows.every((r) => Object.values(r).every((v) => isScalar(v) || (Array.isArray(v) && v.every(isScalar))));
  return simple && cols.length <= 7 ? { rows, cols } : null;
}

const isFlat = (o: Obj) => Object.keys(o).length <= 6 && Object.values(o).every(isScalar);

function Nested({ value, name, depth }: { value: unknown; name: string; depth: number }): ReactNode {
  if (isScalar(value)) return <Value value={value} name={name} unit={splitKey(name).unit} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="faint">—</span>;
    if (value.every(isScalar)) return <Chips value={value} />;
    const table = tableOf(value);
    if (table) return <Table rows={table.rows} cols={table.cols} />;
    return (
      <ol className="meta-list">
        {value.map((v, i) => (
          <li key={i}>
            <Nested value={v} name="" depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  return <Rows value={value as Obj} depth={depth} />;
}

function Rows({ value, depth, skip }: { value: Obj; depth: number; skip?: string }) {
  const entries = Object.entries(value).filter(([k, v]) => k !== skip && !(k === "error" && v === null));
  return (
    <dl className="meta-rows">
      {entries.map(([k, v]) => {
        const { name } = splitKey(k);
        const key = /(^|_)available$/.test(k) && k !== "available" ? k.replace(/_?available$/, "") : name;
        const title = label(key === "" ? "available" : key);
        const flat = isScalar(v) || (Array.isArray(v) && v.length > 0 && v.every(isScalar)) || (isObj(v) && depth > 0 && isFlat(v));
        const nested = <Nested value={v} name={k} depth={depth + 1} />;
        return (
          <div key={k} className={flat ? "meta-row" : "meta-row meta-row-block"}>
            {!flat && depth > 0 ? (
              <Disclosure title={title} count={Array.isArray(v) ? v.length : Object.keys(v as Obj).length}>
                {nested}
              </Disclosure>
            ) : (
              <>
                <dt className={flat && /[A-Z#]/.test(k) ? "meta-raw" : undefined}>{title}</dt>
                <dd>{nested}</dd>
              </>
            )}
          </div>
        );
      })}
    </dl>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="meta-group" aria-label={title}>
      <h2 className="meta-group-title">{title}</h2>
      {children}
    </section>
  );
}

const SCALAR_GROUP = (k: string) => (k.startsWith("service_") ? "Engine" : /^(code_|python_)|_module_available$/.test(k) ? "Code" : "Other");

function Meta({ meta }: { meta: Obj }) {
  const scalars = new Map<string, Obj>();
  const blocks: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(meta)) {
    if (isScalar(v)) {
      const g = SCALAR_GROUP(k);
      scalars.set(g, { ...scalars.get(g), [k.replace(/^(service|code)_/, "")]: v });
    } else blocks.push([k, v]);
  }
  const stores = blocks.find(([k]) => k === "terrain_stores")?.[1];
  const rest = blocks.filter(([k]) => k !== "terrain_stores" && k !== "kernels");
  const kernels = blocks.find(([k]) => k === "kernels")?.[1];
  return (
    <div className="meta">
      <div className="meta-top">
        {[...scalars].map(([g, rows]) => (
          <Group key={g} title={g}>
            <Rows value={rows} depth={0} />
          </Group>
        ))}
      </div>
      {isObj(kernels) && (
        <Group title="Kernels">
          <Rows value={kernels} depth={0} />
        </Group>
      )}
      {Array.isArray(stores) && stores.length > 0 && (
        <div className="meta-stores">
          <h2 className="meta-group-title">
            DEMs<span className="meta-count num">{stores.length}</span>
          </h2>
          <div className="meta-store-list">
            {stores.map((s, i) => {
              const store: Obj = isObj(s) ? s : { value: s };
              const id = typeof store["dem_id"] === "string" ? store["dem_id"] : String(i + 1);
              const px = store["pixel_size_m"];
              return (
                <Disclosure
                  key={id}
                  title={
                    <span className="meta-store-title">
                      <span className="mono">{id}</span>
                      {typeof px === "number" && <span className="meta-unit num">{formatNumber(px)} m</span>}
                    </span>
                  }
                >
                  <Rows value={store} depth={1} skip="dem_id" />
                </Disclosure>
              );
            })}
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <div className="meta-more">
          {rest.map(([k, v]) => (
            <Disclosure key={k} title={label(k)} count={Array.isArray(v) ? v.length : Object.keys(v as Obj).length}>
              <Nested value={v} name={k} depth={1} />
            </Disclosure>
          ))}
        </div>
      )}
    </div>
  );
}

const loadMeta = (signal: AbortSignal) => metaApi.get({ signal });

export function LoadState({ state, loading, what, onRetry }: { state: Loaded<unknown>; loading: string; what: string; onRetry: () => void }) {
  if (state.status === "loading") {
    return (
      <div className="evi-loading">
        <Spinner size={14} label={loading} />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="evi-notice">
        <ServiceNotice error={state.error} what={what} onRetry={onRetry} />
      </div>
    );
  }
  return null;
}

export function MetaView() {
  const { state, reload } = useLoad(loadMeta);
  if (state.status !== "ready") return <LoadState state={state} loading="Loading data versions" what="the data versions" onRetry={reload} />;
  if (!isObj(state.data)) return <EmptyState icon="evidence" title="No data versions" />;
  return <Meta meta={state.data} />;
}
