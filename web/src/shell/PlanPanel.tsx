import { siteLabel } from "../lib/siteName";
import { lazy, Suspense } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import { Spinner } from "../components/ui/Progress";
import { useEditorUi } from "../scenario/editor/editorUi";
import { CONSTRAINT_META } from "../scenario/editor/fieldSpecs";
import { TimeSection } from "../scenario/editor/TimeSection";
import { effectiveWindow, isYear, usePlanSearch, yearText } from "../scenario/planSearch";
import { useSearchSite } from "../scenario/searchAnchor";
import { useScenario } from "../scenario/store";
import type { Limit } from "../scenario/types";
import { hoursOrDays, spanText } from "../scenario/when";
import { SETUP_WORKSPACE } from "../workspaces/registry";
import { Card, type CardRow } from "./plan/Card";
import { landerName, sameProfile } from "./plan/landerFacts";
import { usePresets } from "../scenario/editor/usePresets";
import { LanderPicker } from "./plan/LanderPicker";
import { RequirementsPicker } from "./plan/RequirementsPicker";
import { WindowControl } from "./plan/Widen";
import { formatLimit } from "../lib/requirements";

const SitePicker = lazy(() => import("./plan/SitePicker").then((m) => ({ default: m.SitePicker })));

const MAX_LISTED = 6;

function limitText(limit: Limit): string {
  return formatLimit(limit.min, limit.max, limit.unit);
}

export function PlanPanel() {
  const doc = useScenario((s) => s.doc);
  const show = useEditorUi((s) => s.show);
  const radius = usePlanSearch((s) => s.radius_km);
  const win = usePlanSearch((s) => s.window);
  const centre = useSearchSite();
  const onMap = useLocation().pathname.startsWith("/map");
  const presets = usePresets();

  if (!doc) return <aside className="plan-side" aria-hidden="true" />;

  const siteName = siteLabel(centre?.name ?? doc.site.name) || "Unnamed site";
  const active = CONSTRAINT_META.filter((m) => doc.constraints[m.key]);
  const window = effectiveWindow(doc, win);
  const preset = presets.status === "ready" ? presets.data.profiles.find((e) => e.profile.id === doc.profile.id) : undefined;
  const landerTitle = `${landerName(doc.profile.name)}${preset && !sameProfile(preset.profile, doc.profile) ? " (edited)" : ""}`;
  const limits: CardRow[] =
    active.length === 0
      ? [{ v: "None set" }]
      : [
          ...active.slice(0, MAX_LISTED).map((m) => ({ k: m.short, v: limitText(doc.constraints[m.key] as Limit) })),
          ...(active.length > MAX_LISTED ? [{ v: `+${active.length - MAX_LISTED} more` }] : []),
        ];

  return (
    <aside className="plan-side" aria-label="Requirements">
      <div className="plan-cards">
        <div className="plan-head">
          <h2>Requirements</h2>
        </div>
        <Card
          field="site"
          icon="pin"
          label="Where"
          width={onMap ? 360 : 860}
          rows={[
            { k: "Site", v: siteName },
            { k: "Area", v: radius === null ? "Site only" : `Within ${radius} km` },
          ]}
        >
          <Suspense
            fallback={
              <p className="plan-empty" role="status">
                <Spinner size={12} /> Loading
              </p>
            }
          >
            <SitePicker />
          </Suspense>
        </Card>

        <Card
          field="time"
          icon="calendar"
          label="When"
          width={420}
          rows={[
            { k: "Window", v: isYear(window) ? yearText(window) : spanText(window.first_ms, window.last_ms) },
            { k: "Stay", v: hoursOrDays(doc.mission_duration_h) },
          ]}
        >
          <div className="plan-pick">
            <div className="plan-pick-scroll plan-pick-form">
              <WindowControl />
              <TimeSection />
            </div>
          </div>
        </Card>

        <Card field="lander" icon="lander" label="Lander" width={480} rows={[{ v: landerTitle }]}>
          <LanderPicker />
        </Card>

        <Card field="constraints" icon="checklist" label="Limits" width={520} rows={limits}>
          <RequirementsPicker />
        </Card>
      </div>

      <div className="plan-side-foot">
        {doc.terrain_stores != null && (
          <button type="button" className="plan-flag" onClick={() => show("model")}>
            <Icon name="terrain" size={12} /> <span>Custom terrain</span>
          </button>
        )}
        <NavLink to={SETUP_WORKSPACE.path} className={({ isActive }) => `plan-setup${isActive ? " active" : ""}`}>
          <Icon name="settings" size={14} />
          <span>{SETUP_WORKSPACE.label}</span>
        </NavLink>
      </div>
    </aside>
  );
}
