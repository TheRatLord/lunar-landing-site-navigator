import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConstraintPanel } from "../components/viz/ConstraintPanel";
import { Countdown } from "../components/viz/Countdown";
import { HorizonPanorama, type BlockerRequest } from "../components/viz/HorizonPanorama";
import { Timeline } from "../components/viz/Timeline";
import { Button, IconButton } from "../components/ui/Button";
import { CommandPalette, type Command } from "../components/ui/CommandPalette";
import { DataTable } from "../components/ui/DataTable";
import { Disclosure } from "../components/ui/Disclosure";
import { EmptyState } from "../components/ui/EmptyState";
import { CoordinateInput, DateTimeInput, Field, Select, Slider, Toggle } from "../components/ui/Fields";
import { Icon, type IconName } from "../components/ui/Icon";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel, SplitPane, Tabs } from "../components/ui/Panel";
import { Popover } from "../components/ui/Popover";
import { JobProgress, ProgressBar, Spinner } from "../components/ui/Progress";
import { Segmented } from "../components/ui/Segmented";
import { Stat } from "../components/ui/Stat";
import { Toolstrip, ToolstripSep } from "../components/ui/Toolstrip";
import { VerdictChip } from "../components/ui/VerdictChip";
import type { JobStatus } from "../contract/types";
import { cividis, cssGradient, diverging, viridis, type Colormap } from "../lib/colormaps";
import { formatNum } from "../lib/format";
import { useApp } from "../state/store";
import { toast } from "../state/toasts";
import { FIXTURE_SPAN, FIXTURE_T0, makeConstraints, makeHorizon, makeStations, makeStress, makeTimeline, makeTracks } from "./fixtures";

function Section({ id, span, height, children }: { id: string; span: number; height?: number; children: ReactNode }) {
  return (
    <div className={`gal-span-${span} gal-box`} data-gallery={id} style={height ? { height } : undefined}>
      {children}
    </div>
  );
}

function MenuDemo() {
  const [layers, setLayers] = useState({ terrain: true, shadow: false });
  const items: MenuItem[] = [
    { id: "open", label: "Open plan…", icon: "folder", hint: "Ctrl+O", onSelect: () => toast({ kind: "info", title: "Open plan" }) },
    { id: "duplicate", label: "Save as copy", icon: "copy", onSelect: () => toast({ kind: "success", title: "Copy saved", detail: "Shackleton rim (copy)" }) },
    { id: "revisions", label: "Versions…", icon: "history", disabled: true, hint: "None", onSelect: () => undefined },
    { id: "terrain", label: "DEM footprints", checked: layers.terrain, divider: true, keepOpen: true, onSelect: () => setLayers((l) => ({ ...l, terrain: !l.terrain })) },
    { id: "shadow", label: "Shadows", checked: layers.shadow, keepOpen: true, onSelect: () => setLayers((l) => ({ ...l, shadow: !l.shadow })) },
  ];
  return (
    <>
      <Menu label="Plans" icon="folder" items={items} />
      <Menu iconOnly icon="more" label="More actions" align="end" items={items} />
    </>
  );
}

function CmapStrip({ name, map }: { name: string; map: Colormap }) {
  return (
    <div className="col">
      <span className="faint">{name}</span>
      <div className="gal-cmap" style={{ background: cssGradient(map, 12) }} />
    </div>
  );
}

const TOKENS = [
  ["c-pass", "Pass"],
  ["c-marginal", "Marginal"],
  ["c-fail", "Fail"],
  ["c-sun", "Sun"],
  ["c-earth", "Earth"],
  ["c-terrain-line", "Terrain"],
  ["c-uncertainty", "Uncertainty"],
  ["c-dark", "Dark"],
  ["c-power", "Power"],
  ["c-network", "Contact"],
  ["c-station-0", "Station 0"],
  ["c-station-1", "Station 1"],
  ["c-station-2", "Station 2"],
  ["c-station-3", "Station 3"],
] as const;

const SURFACES = [
  ["bg", "bg"],
  ["bg-raised", "raised"],
  ["panel", "panel"],
  ["panel-2", "panel-2"],
  ["panel-hover", "hover"],
] as const;

const ICONS: IconName[] = [
  "map", "site", "calendar", "compare", "ellipse", "analyst", "evidence", "play", "pause", "stepBack", "stepFwd", "sun", "moon",
  "search", "check", "warn", "cross", "close", "chevronDown", "chevronRight", "chevronLeft", "chevronUp", "plus", "minus", "reset",
  "command", "info", "plug", "clock", "stop", "send", "file", "image", "code", "shield", "copy", "download", "list", "link",
  "panelRight", "ruler", "expand", "collapse", "more", "filter", "layers", "eye", "eyeOff", "external", "settings", "sliders",
  "trash", "save", "folder", "history", "target", "pin", "alert", "earth", "battery", "antenna", "refresh", "share", "table", "terrain",
];

export default function Gallery() {
  const timeMs = useApp((s) => s.timeMs);
  const { setTime, setRange, setBounds } = useApp.getState();
  useApp((s) => s.theme);

  useEffect(() => {
    const t1 = FIXTURE_T0 + FIXTURE_SPAN;
    setBounds({ start_ms: FIXTURE_T0, end_ms: t1 });
    setRange({ start_ms: FIXTURE_T0, end_ms: t1 });
    setTime(FIXTURE_T0 + 11.3 * 86_400_000);
  }, [setBounds, setRange, setTime]);

  const horizon = useMemo(() => makeHorizon(), []);
  const tracks = useMemo(() => makeTracks(), []);
  const timeline = useMemo(() => makeTimeline(), []);
  const stress = useMemo(() => makeStress(), []);
  const constraints = useMemo(() => makeConstraints(), []);
  const stations = useMemo(() => makeStations(timeMs), [timeMs]);

  const [marked, setMarked] = useState<number | null>(null);

  const onBlocker = (r: BlockerRequest) => {
    setMarked(r.az_deg);
    toast({ kind: "info", title: "Terrain trace requested", detail: `az ${r.az_deg.toFixed(1)}°, horizon ${r.elev_deg.toFixed(2)}°, ${(r.blocker_dist_m / 1000).toFixed(2)} km` });
  };

  const [view, setView] = useState("site");
  const [tab, setTab] = useState("a");
  const [seg, setSeg] = useState("1.5");
  const [segSm, setSegSm] = useState("dark");
  const [horizonModel, setHorizonModel] = useState("auto");
  const [lat, setLat] = useState<number | null>(-89.54);
  const [lon, setLon] = useState<number | null>(129.2);
  const [dt, setDt] = useState(FIXTURE_T0 + 3 * 3_600_000);
  const [slider, setSlider] = useState(40);
  const [toggle, setToggle] = useState(true);
  const [check, setCheck] = useState(true);
  const [radio, setRadio] = useState("a");
  const [sel, setSel] = useState("b");
  const [modal, setModal] = useState(false);
  const [palette, setPalette] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const job: JobStatus = { id: "j", label: "Landing opportunities, 2027–2031", state: "running", progress: 0.62, stage: "Evaluating lunation 31 of 50", started_ms: mountedAt - 83_000 };
  const commands: Command[] = [
    { id: "site", title: "Go to Site", group: "Navigate", icon: "site", shortcut: "Alt+2", run: () => undefined },
    { id: "save", title: "Save plan", group: "Plan", icon: "save", shortcut: "Ctrl S", run: () => undefined },
    { id: "export", title: "Download plan (JSON)", group: "Plan", icon: "download", run: () => undefined },
  ];

  return (
    <div className="gal">
      <PageHeader
        tabs={
          <Tabs
            label="Gallery views"
            tabs={[{ id: "site", label: "Site" }, { id: "dates", label: "Dates" }, { id: "compare", label: "Compare" }]}
            value={view}
            onChange={setView}
          />
        }
        actions={
          <>
            <Popover label="27 caveats" icon="shield" align="end">
              <div className="row">
                <VerdictChip verdict="marginal" compact />
                <span>Terrain range</span>
              </div>
              <div className="hairline" />
              <Disclosure title="Provenance" count={3}>
                <code>pgda78_site07_5m</code>
              </Disclosure>
            </Popover>
            <IconButton icon="more" label="More actions" />
            <Button variant="primary" icon="play">
              Evaluate site
            </Button>
          </>
        }
      >
        <VerdictChip verdict="pass" />
        <span className="chip">
          <Icon name="alert" size={12} /> 7 estimates
        </span>
      </PageHeader>

      <div className="gal-grid">
        <Section id="buttons" span={6}>
          <Panel title="Buttons">
            <div className="stack">
              <div className="row">
                <Button variant="primary" icon="play">
                  Evaluate site
                </Button>
                <Button>Scan landing dates</Button>
                <Button variant="ghost">Cancel</Button>
                <Button disabled>Add to Compare</Button>
              </div>
              <div className="row">
                <Button size="sm" variant="primary">
                  Save
                </Button>
                <Button size="sm">Load preset</Button>
                <Button size="sm" variant="ghost" icon="refresh">
                  Reconnect
                </Button>
                <Button size="sm" variant="ghost" aria-pressed="true" icon="eye">
                  Show uncertainty
                </Button>
                <IconButton icon="settings" label="Open mission" shortcut="," />
                <IconButton icon="filter" label="Filter sites" pressed />
                <IconButton icon="play" label="Sample ellipse" variant="primary" />
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="selectors" span={6}>
          <Panel title="Tabs and segmented">
            <div className="stack">
              <Tabs label="Example tabs" tabs={[{ id: "a", label: "Sites" }, { id: "b", label: "Stations" }, { id: "c", label: "Lander", disabled: true }]} value={tab} onChange={setTab} />
              <div className="row">
                <Segmented
                  label="Mast height"
                  value={seg}
                  onChange={setSeg}
                  options={[{ value: "0", label: "0 m" }, { value: "1.5", label: "1.5 m" }, { value: "10", label: "10 m" }, { value: "x", label: "Off", disabled: true }]}
                />
                <Segmented
                  label="Theme"
                  size="sm"
                  value={segSm}
                  onChange={setSegSm}
                  options={[{ value: "dark", label: <Icon name="moon" size={12} /> }, { value: "light", label: <Icon name="sun" size={12} /> }]}
                />
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="toolstrip" span={6}>
          <Panel title="Toolstrip">
            <div className="stack">
              <Toolstrip aria-label="Map tools">
                <IconButton icon="target" label="Zoom to plan site" />
                <IconButton icon="expand" label="Zoom to region" />
                <ToolstripSep />
                <IconButton icon="ruler" label="Measure distance" pressed />
                <IconButton icon="layers" label="Layers" />
              </Toolstrip>
              <div className="gal-canvas">
                <Toolstrip float aria-label="Floating map tools">
                  <IconButton icon="plus" label="Zoom in" size="sm" />
                  <IconButton icon="minus" label="Zoom out" size="sm" />
                  <ToolstripSep />
                  <Segmented
                    label="Horizon model"
                    size="sm"
                    value={horizonModel}
                    onChange={setHorizonModel}
                    options={[{ value: "auto", label: "Auto" }, { value: "terrain", label: "Terrain" }, { value: "sphere", label: "Smooth sphere" }]}
                  />
                  <ToolstripSep />
                  <IconButton icon="panelRight" label="Side panel" size="sm" />
                </Toolstrip>
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="chips" span={6}>
          <Panel title="Chips">
            <div className="row" style={{ flexWrap: "wrap", columnGap: "var(--sp-4)" }}>
              <span className="chip">Heading unknown</span>
              <span className="chip chip-marginal">Inputs changed</span>
              <VerdictChip verdict="marginal" value={9.4} limit={6} margin={3.4} unit="h" decimals={1} sense="min" />
              <Popover label="17 caveats" tone="marginal" icon="alert">
                <span className="dim">Cell-scale shadows are not modelled.</span>
              </Popover>
              <span className="chip chip-unknown num">3 pass, 1 marginal, 8,361 fail</span>
            </div>
          </Panel>
        </Section>

        <Section id="inputs" span={6}>
          <Panel title="Fields">
            <div className="stack">
              <CoordinateInput lat={lat} lon={lon} onChange={(a, b) => (setLat(a), setLon(b))} />
              <div className="field-row">
                <Field label="Mast height" htmlFor="g-mast">
                  <span className="input-group">
                    <input id="g-mast" className="input num" defaultValue="1.5" inputMode="decimal" />
                    <span className="input-unit">m</span>
                  </span>
                </Field>
                <Field label="Step" htmlFor="g-step">
                  <span className="input-group">
                    <input id="g-step" className="input num" defaultValue="20" inputMode="decimal" />
                    <span className="input-unit">m</span>
                  </span>
                </Field>
                <Field label="Colour map" htmlFor="cm">
                  <Select id="cm" aria-label="Colour map" value="cividis" onChange={() => undefined} options={[{ value: "cividis", label: "cividis" }, { value: "viridis", label: "viridis" }]} />
                </Field>
              </div>
              <div className="field-row">
                <DateTimeInput value={dt} onChange={setDt} label="Landing (UTC)" />
                <Field label="Invalid" htmlFor="g-bad" error="Out of range">
                  <input id="g-bad" className="input num" defaultValue="91.2" aria-invalid />
                </Field>
              </div>
              <Slider label="Mast height" min={0} max={10} step={0.5} value={slider / 10} onChange={(v) => setSlider(v * 10)} format={(v) => `${v.toFixed(1)} m`} />
              <div className="row">
                <Toggle checked={toggle} onChange={setToggle} label="Uncertainty" />
                <label className="row">
                  <input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} />
                  Terrain
                </label>
                <label className="row">
                  <input type="radio" name="g-radio" checked={radio === "a"} onChange={() => setRadio("a")} />
                  A
                </label>
                <label className="row">
                  <input type="radio" name="g-radio" checked={radio === "b"} onChange={() => setRadio("b")} />
                  B
                </label>
                <span className="faint">
                  <span className="num">{lat === null ? "—" : formatNum(lat, 4)}, {lon === null ? "—" : formatNum(lon, 4)}</span>
                </span>
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="verdicts" span={6}>
          <Panel title="Chips, stats, disclosure">
            <div className="stack">
              <VerdictChip verdict="pass" value={131.5} limit={96} margin={35.5} unit="h" decimals={1} sense="min" />
              <VerdictChip verdict="marginal" value={9.4} limit={6} margin={3.4} unit="h" decimals={1} sense="min" />
              <VerdictChip verdict="fail" value={11.8} limit={20} margin={-8.2} unit="%" decimals={1} sense="min" />
              <div className="row">
                <VerdictChip verdict="pass" compact />
                <VerdictChip verdict="marginal" compact />
                <VerdictChip verdict="fail" compact />
                <span className="chip chip-unknown">Unknown</span>
                <span className="chip">
                  <Icon name="alert" size={12} /> 7 estimates
                </span>
              </div>
              <div className="field-row hairline" style={{ paddingTop: "var(--sp-3)" }}>
                <Stat label="Margin" value="35.5" unit="h" tone="pass" sub="at least 96 h" />
                <Stat label="Sun" value="6.3" unit="°" tone="marginal" />
                <Stat label="Shadow" value="11.8" unit="%" tone="fail" />
                <Stat label="Earth" value="5.5" unit="°" />
              </div>
              <div className="hairline" style={{ paddingTop: "var(--sp-2)" }}>
                <Disclosure title="Caveats" count={27}>
                  <span className="dim">Terrain range</span>
                </Disclosure>
                <Disclosure title="Provenance" defaultOpen>
                  <code>pgda78_site07_5m</code>
                </Disclosure>
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="popover" span={4} height={280}>
          <Panel title="Popover and empty state">
            <div className="row">
              <Popover label="27 caveats" icon="shield">
                <span className="dim">Terrain range</span>
              </Popover>
              <Popover label="Marginal" tone="marginal" icon="alert">
                <span className="dim">Cell-scale shadows</span>
              </Popover>
              <Popover label="Fail" tone="fail" align="end" width={240}>
                <span className="dim">Slope</span>
              </Popover>
            </div>
            <div className="row">
              <Popover iconOnly icon="info" label="About this requirement" width={240}>
                <span className="dim">Cell-scale shadows</span>
              </Popover>
              <MenuDemo />
            </div>
            <EmptyState icon="pin" title="No matching sites" action={<Button size="sm">Clear filters</Button>} />
          </Panel>
        </Section>

        <Section id="progress" span={4} height={220}>
          <Panel title="Progress and toasts">
            <div className="stack">
              <JobProgress job={job} onCancel={() => toast({ kind: "warning", title: "Cancel requested" })} />
              <ProgressBar value={1} label="Done" />
              <div className="row">
                <Spinner label="Loading" />
                <Button size="sm" onClick={() => toast({ kind: "success", title: "Plan saved", detail: "Version 4" })}>
                  Show success toast
                </Button>
                <Button size="sm" onClick={() => toast({ kind: "error", title: "Could not reach the engine", detail: "GET /api/horizon failed" })}>
                  Show error toast
                </Button>
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="overlays" span={4} height={220}>
          <Panel title="Overlays">
            <div className="row">
              <Button onClick={() => setModal(true)}>Download plan…</Button>
              <Button variant="ghost" onClick={() => setPalette(true)} icon="command">
                Command palette
              </Button>
              <IconButton icon="share" label="Copy link to plan" shortcut="Alt+S" />
            </div>
          </Panel>
        </Section>

        <Section id="layout" span={6} height={300}>
          <Panel title="Table and split pane" flush scroll={false}>
            <SplitPane
              initial={0.6}
              first={
                <div style={{ height: "100%", overflow: "auto" }}>
                  <DataTable
                    caption="Example numeric table"
                    rowKey={(r) => r.id}
                    selectedKey={sel}
                    onRowClick={(r) => setSel(r.id)}
                    columns={[
                      { key: "n", header: "Name", render: (r) => r.name },
                      { key: "v", header: "Verdict", render: (r) => <VerdictChip verdict={r.v} compact /> },
                      { key: "lat", header: "Lat", unit: "°", numeric: true, render: (r) => formatNum(r.lat, 3) },
                      { key: "m", header: "Margin", unit: "h", numeric: true, render: (r) => formatNum(r.m, 1) },
                    ]}
                    rows={[
                      { id: "a", name: "Row A", v: "pass" as const, lat: -89.54, m: 131.25 },
                      { id: "b", name: "Row B", v: "marginal" as const, lat: -85.1, m: 9.4 },
                      { id: "c", name: "Row C", v: "fail" as const, lat: -84.8, m: -3.05 },
                    ]}
                  />
                </div>
              }
              second={<EmptyState icon="table" title="Select a row to inspect it" />}
            />
          </Panel>
        </Section>

        <Section id="empty-table" span={6} height={300}>
          <Panel title="Empty table" flush>
            <DataTable caption="Empty" rowKey={(r: { id: string }) => r.id} columns={[{ key: "n", header: "Name", render: () => null }]} rows={[]} empty={<EmptyState icon="folder" title="No saved plans yet" action={<Button size="sm">Save plan</Button>} />} />
          </Panel>
        </Section>

        <Section id="icons" span={12}>
          <Panel title="Icons">
            <div className="gal-icons">
              {ICONS.map((n) => (
                <span className="gal-icon" key={n}>
                  <Icon name={n} /> {n}
                </span>
              ))}
            </div>
          </Panel>
        </Section>

        <Section id="tokens" span={12}>
          <Panel title="Colour tokens">
            <div className="stack">
              <div className="gal-surfaces">
                {SURFACES.map(([t, label]) => (
                  <div className="gal-surface" key={t} style={{ background: `var(--${t})` }}>
                    {label}
                  </div>
                ))}
              </div>
              <div className="gal-type">
                <span className="num" style={{ fontSize: "var(--fs-xl)", fontWeight: "var(--fw-medium)" }}>
                  Text 18 · 131.5 h
                </span>
                <span style={{ fontSize: "var(--fs-md)" }}>Text 13 · Shackleton rim</span>
                <span className="dim" style={{ fontSize: "var(--fs-sm)" }}>
                  Text 2 · 12 px
                </span>
                <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                  Text 3 · 11 px
                </span>
                <code>pgda78_site07_5m · 241d5855d6be</code>
              </div>
              <div className="gal-swatches">
                {TOKENS.map(([t, label]) => (
                  <div className="gal-swatch" key={t}>
                    <i style={{ background: `var(--${t})` }} />
                    <span>{label}</span>
                    <code className="faint">--{t}</code>
                  </div>
                ))}
              </div>
              <div className="row">
                <div className="grow">
                  <CmapStrip name="viridis" map={viridis} />
                </div>
                <div className="grow">
                  <CmapStrip name="cividis" map={cividis} />
                </div>
                <div className="grow">
                  <CmapStrip name="diverging" map={diverging} />
                </div>
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="panorama" span={12} height={470}>
          <HorizonPanorama horizon={horizon} sun={tracks.sun} earth={tracks.earth} stations={stations} timeMs={timeMs} onBlockerRequest={onBlocker} markedAz_deg={marked} />
        </Section>

        <Section id="timeline" span={12}>
          <Timeline rows={timeline.rows} extent={timeline.extent} timeMs={timeMs} onTimeChange={setTime} />
        </Section>

        <Section id="countdown" span={5}>
          <Countdown events={timeline.events} timeMs={timeMs} />
        </Section>
        <Section id="constraints" span={7}>
          <ConstraintPanel constraints={constraints} limitingId={null} />
        </Section>

        <Section id="stress" span={12}>
          <Timeline
            title={`Decimation stress · ${stress.count.toLocaleString("en-US")} samples`}
            rows={stress.rows}
            extent={stress.extent}
            timeMs={timeMs}
            onTimeChange={setTime}
          />
        </Section>
      </div>

      {modal && (
        <Modal
          title="Download plan"
          onClose={() => setModal(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setModal(false)}>
                Download
              </Button>
            </>
          }
        >
          <div className="field-row">
            <Field label="Format" htmlFor="g-fmt">
              <Select id="g-fmt" aria-label="Format" value="json" onChange={() => undefined} options={[{ value: "json", label: "JSON" }, { value: "csv", label: "CSV" }]} />
            </Field>
            <Field label="Name" htmlFor="g-name">
              <input id="g-name" className="input" defaultValue="shackleton-rim" />
            </Field>
          </div>
        </Modal>
      )}
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
    </div>
  );
}
