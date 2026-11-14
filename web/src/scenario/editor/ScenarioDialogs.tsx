import { useEffect, useRef, useState } from "react";
import { ApiError, isAbort, reportError } from "../../api/client";
import { ServiceNotice } from "../../components/ServiceNotice";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Progress";
import { formatLat, formatLon } from "../../lib/coords";
import { formatUtc, parseUtc, toIsoUtc } from "../../lib/time";
import { catalogApi, scenarioApi, type SiteEntry } from "../api";
import { toast } from "../../state/toasts";
import { selectDirty, useScenario } from "../store";
import type { RevisionInfo, ScenarioSummary } from "../types";
import { EstimatesChip, Row, Suffixed } from "./controls";
import { useEditorUi } from "./editorUi";
import { useSearch } from "./fieldState";
import { buildScenario } from "./newScenario";
import { ProfileOptions } from "./PresetBar";
import { useConfirm } from "./useConfirm";
import { usePresets } from "./usePresets";

export function ScenarioDialogs() {
  const dialog = useEditorUi((s) => s.dialog);
  const setDialog = useEditorUi((s) => s.setDialog);
  const close = () => setDialog("none");
  if (dialog === "new") return <NewScenarioDialog onClose={close} />;
  if (dialog === "open") return <OpenScenarioDialog onClose={close} />;
  if (dialog === "revisions") return <RevisionsDialog onClose={close} />;
  return null;
}

/** Resolves true at once when nothing is unsaved; otherwise asks in an in-app dialog. Render `dialog` once. */
function useDiscardGuard() {
  const dirty = useScenario(selectDirty);
  const name = useScenario((s) => s.doc?.name);
  const { confirm, dialog } = useConfirm();
  const guard = (action: string) => (dirty ? confirm({ title: "Discard unsaved edits?", consequence: `“${name ?? "The plan"}” has unsaved edits that will be lost.`, action }) : Promise.resolve(true));
  return { guard, dialog, confirm };
}

const searchSites = (q: string, signal: AbortSignal) => catalogApi.sites({ q: q || undefined, limit: 6 }, { signal });
const searchPlans = (q: string, signal: AbortSignal) => scenarioApi.list({ q: q || undefined, limit: 50 }, { signal });

type Field = "name" | "site" | "profile" | "landing" | "duration";

function NewScenarioDialog({ onClose }: { onClose: () => void }) {
  const presets = usePresets();
  const open = useScenario((s) => s.open);
  const { guard, dialog } = useDiscardGuard();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const results = useSearch(query, searchSites)?.value;
  const [site, setSite] = useState<SiteEntry | null>(null);
  const [profileId, setProfileId] = useState("");
  const [constraintName, setConstraintName] = useState("");
  const [networkId, setNetworkId] = useState("");
  const [landing, setLanding] = useState("");
  const [landingTouched, setLandingTouched] = useState(false);
  const [duration, setDuration] = useState("354");
  const [error, setError] = useState<{ field: Field; msg: string } | null>(null);
  const err = (f: Field) => (error?.field === f ? error.msg : null);

  const pickSite = (s: SiteEntry) => {
    setSite(s);
    if (!name) setName(`${s.name} study`);
    if (!landingTouched && s.landing_utc) setLanding(formatUtc(parseUtc(s.landing_utc) ?? 0, { seconds: false }));
  };

  const create = () => {
    if (presets.status !== "ready") return;
    const profile = presets.data.profiles.find((p) => p.id === profileId);
    const t = parseUtc(landing);
    const hours = Number(duration);
    if (!name.trim()) return setError({ field: "name", msg: "Name required" });
    if (!site) return setError({ field: "site", msg: "Site required" });
    if (!profile) return setError({ field: "profile", msg: "Lander required" });
    if (t === null) return setError({ field: "landing", msg: "Expected YYYY-MM-DD HH:MM" });
    if (!(hours > 0)) return setError({ field: "duration", msg: "Must be > 0 h" });
    void guard("Replace").then((ok) => {
      if (!ok) return;
      open(
        buildScenario({
          name: name.trim(),
          site,
          landing_utc: toIsoUtc(t),
          mission_duration_h: hours,
          profile: profile.profile,
          constraints: presets.data.constraints.find((c) => c.name === constraintName)?.constraints,
          network: presets.data.networks.find((n) => n.id === networkId)?.network,
        }),
        null,
      );
      onClose();
    });
  };

  const profileEntry = presets.status === "ready" ? presets.data.profiles.find((p) => p.id === profileId) : undefined;

  return (
    <Modal
      title="New plan"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={presets.status !== "ready"}>
            Create plan
          </Button>
        </>
      }
    >
      <div className="sc-form">
        <Row label="Name" htmlFor="new-name" error={err("name")}>
          <input id="new-name" data-autofocus className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={err("name") ? true : undefined} />
        </Row>

        <Row label="Landing site" htmlFor="new-site" error={err("site")}>
          <div className="sc-tagfield">
            {site && (
              <span className="chip">
                {site.name}
                <button type="button" className="sc-chip-x" aria-label={`Clear ${site.name}`} onClick={() => setSite(null)}>
                  <Icon name="close" size={10} />
                </button>
              </span>
            )}
            <input id="new-site" className="sc-tagfield-input" aria-label="Search the landing-site catalogue" placeholder="Search sites" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
            <Icon name="search" size={14} />
          </div>
        </Row>
        <ul className="sc-results static sc-new-results" aria-label="Catalogue sites">
          {results?.items.map((s) => (
            <li key={s.id} className={site?.id === s.id ? "active" : ""}>
              <button type="button" className="sc-result-btn" aria-pressed={site?.id === s.id} onClick={() => pickSite(s)}>
                <span className="sc-result-name">{s.name}</span>
                <span className="chip">{s.kind}</span>
                <span className="sc-result-pos num">
                  {formatLat(s.lat_deg, 2)} {formatLon(s.lon_deg, 2)}
                </span>
                {site?.id === s.id && <Icon name="check" size={14} />}
              </button>
            </li>
          ))}
          {results && results.items.length === 0 && <li className="sc-result-empty">No matching site</li>}
        </ul>

        {presets.status === "loading" && <Spinner size={14} />}
        {presets.status === "error" && <ServiceNotice error={presets.error} what="Lander presets and requirement sets" />}
        {presets.status === "ready" && (
          <>
            <Row label="Lander" htmlFor="new-profile" error={err("profile")}>
              <select id="new-profile" className="select" value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-invalid={err("profile") ? true : undefined}>
                <option value="" />
                <ProfileOptions profiles={presets.data.profiles} />
              </select>
              <EstimatesChip rows={profileEntry?.estimates ?? []} />
            </Row>
            <Row label="Requirements" htmlFor="new-constraints">
              <select id="new-constraints" className="select" value={constraintName} onChange={(e) => setConstraintName(e.target.value)}>
                <option value="">None</option>
                {presets.data.constraints.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Ground stations" htmlFor="new-network">
              <select id="new-network" className="select" value={networkId} onChange={(e) => setNetworkId(e.target.value)}>
                <option value="">None</option>
                {presets.data.networks.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </Row>
          </>
        )}

        <Row label="Landing" htmlFor="new-landing" error={err("landing")}>
          <Suffixed unit="UTC">
            <input
              id="new-landing"
              className="input num"
              value={landing}
              placeholder="YYYY-MM-DD HH:MM"
              style={{ paddingRight: "calc(var(--sp-2) * 2 + 3ch)" }}
              aria-invalid={err("landing") ? true : undefined}
              onChange={(e) => {
                setLanding(e.target.value);
                setLandingTouched(true);
              }}
            />
          </Suffixed>
        </Row>
        <Row label="Duration" htmlFor="new-duration" error={err("duration")}>
          <Suffixed unit="h">
            <input id="new-duration" className="input num" inputMode="decimal" value={duration} style={{ paddingRight: "calc(var(--sp-2) * 2 + 1ch)" }} aria-invalid={err("duration") ? true : undefined} onChange={(e) => setDuration(e.target.value)} />
          </Suffixed>
        </Row>
      </div>
      {dialog}
    </Modal>
  );
}

function OpenScenarioDialog({ onClose }: { onClose: () => void }) {
  const load = useScenario((s) => s.load);
  const importText = useScenario((s) => s.importText);
  const current = useScenario((s) => s.saved?.id);
  const { guard, dialog, confirm } = useDiscardGuard();
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const state = useSearch(query, searchPlans, 150, reload);
  const shown = state?.q === query.trim() ? { page: state.value, error: state.error instanceof ApiError ? state.error : null } : null;

  const openOne = (s: ScenarioSummary) => {
    void guard("Open").then((ok) => {
      if (ok)
        void load(s.id).then(onClose);
    });
  };
  const remove = (s: ScenarioSummary) => {
    void confirm({ title: `Delete “${s.name}”?`, consequence: "All its versions are deleted from the engine.", action: "Delete" }).then((ok) => {
      if (!ok) return;
      scenarioApi.remove(s.id).then(
        () => {
          toast({ kind: "info", title: `Deleted “${s.name}”` });
          setReload((n) => n + 1);
        },
        (e: unknown) => reportError(e, "Deleting the plan"),
      );
    });
  };

  return (
    <Modal
      title="Open plan"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" icon="download" onClick={() => fileRef.current?.click()}>
            Import JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f)
                void guard("Import").then((ok) => {
                  if (ok)
                    void f.text().then((t) => {
                      importText(t);
                      onClose();
                    });
                });
            }}
          />
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="sc-searchbox">
        <Icon name="search" size={14} />
        <input data-autofocus className="input" aria-label="Search saved plans" placeholder="Search plans" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!shown && <Spinner size={14} />}
      {shown?.error && <ServiceNotice error={shown.error} what="Saved plans" onRetry={() => setReload((n) => n + 1)} />}
      {shown?.page && shown.page.items.length === 0 && <EmptyState icon="folder" title={query ? "No matching plan" : "No saved plans yet"} />}
      {shown?.page && shown.page.items.length > 0 && (
        <ul className="sc-list" aria-label="Saved plans">
          {shown.page.items.map((s) => (
            <li key={s.id} aria-current={s.id === current ? "true" : undefined}>
              <span className="sc-list-name">{s.name}</span>
              {s.id === current && <span className="chip chip-pass">Open</span>}
              <span className="dim num">v{s.version}</span>
              <span className="dim num sc-list-date">{formatUtc(parseUtc(s.updated_utc) ?? 0, { seconds: false })}</span>
              <Button size="sm" onClick={() => openOne(s)}>
                Open
              </Button>
              <IconButton icon="trash" label={`Delete ${s.name}`} size="sm" onClick={() => remove(s)} />
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Modal>
  );
}

function RevisionsDialog({ onClose }: { onClose: () => void }) {
  const saved = useScenario((s) => s.saved);
  const load = useScenario((s) => s.load);
  const { guard, dialog } = useDiscardGuard();
  const [state, setState] = useState<{ items: RevisionInfo[] | null; error: ApiError | null }>({ items: null, error: null });

  useEffect(() => {
    if (!saved) return;
    const ctl = new AbortController();
    scenarioApi.revisions(saved.id, { signal: ctl.signal }).then(
      (items) => setState({ items, error: null }),
      (e: unknown) => !isAbort(e) && setState({ items: null, error: e instanceof ApiError ? e : null }),
    );
    return () => ctl.abort();
  }, [saved]);

  return (
    <Modal title="Version history" onClose={onClose} width={520} footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }>
      {!saved && <EmptyState icon="history" title="Save the plan to start its history" />}
      {saved && !state.items && !state.error && <Spinner size={14} />}
      {state.error && <ServiceNotice error={state.error} what="Version history" />}
      {state.items && (
        <ul className="sc-list" aria-label="Versions, newest first">
          {[...state.items]
            .sort((a, b) => b.version - a.version)
            .map((r) => (
              <li key={r.version} aria-current={r.version === saved?.version ? "true" : undefined}>
                <span className="num sc-list-v">v{r.version}</span>
                {r.version === saved?.version && <span className="chip chip-pass">Current</span>}
                <span className="sc-list-name">{r.name}</span>
                <span className="dim num sc-list-date">{formatUtc(parseUtc(r.saved_utc) ?? 0, { seconds: false })}</span>
                <Button
                  size="sm"
                  disabled={r.version === saved?.version}
                  onClick={() => {
                    if (saved)
                      void guard("Load").then((ok) => {
                        if (ok) void load(saved.id, r.version).then(onClose);
                      });
                  }}
                >
                  Load
                </Button>
              </li>
            ))}
        </ul>
      )}
      {dialog}
    </Modal>
  );
}
