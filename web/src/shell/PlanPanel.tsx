import { siteLabel } from "../lib/siteName";
import { lazy, Suspense } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import { Spinner } from "../components/ui/Progress";
import { formatLat, formatLon } from "../lib/coords";
import { MS_DAY, parseUtc } from "../lib/time";
import { useEditorUi } from "../scenario/editor/editorUi";
import { CONSTRAINT_META } from "../scenario/editor/fieldSpecs";
import { TimeSection } from "../scenario/editor/TimeSection";
import { DEFAULT_RANK, effectiveRank, rankLabel, usePlanSearch } from "../scenario/planSearch";
import { shiftPlanLanding, useScenario } from "../scenario/store";
import type { Limit } from "../scenario/types";
import { hoursOrDays, whenText } from "../scenario/when";
import { SETUP_WORKSPACE } from "../workspaces/registry";
import { Card } from "./plan/Card";
import { landerFacts, landerName, sameProfile } from "./plan/landerFacts";
import { usePresets } from "../scenario/editor/usePresets";
import { LanderPicker } from "./plan/LanderPicker";
import { RequirementsPicker } from "./plan/RequirementsPicker";
import { WindowControl, areaText, windowText } from "./plan/Widen";
import { PlanFile } from "./PlanFile";
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
  const rankBy = usePlanSearch((s) => s.rankBy);
  const onMap = useLocation().pathname.startsWith("/map");
  const presets = usePresets();

  if (!doc) return <aside className="plan-side" aria-hidden="true" />;

  const landing = parseUtc(doc.landing_utc);
  const siteName = siteLabel(doc.site.name) || "Unnamed site";
  const active = CONSTRAINT_META.filter((m) => doc.constraints[m.key]);
  const area = areaText(radius);
  const span = windowText(win);
  const coordText = `${formatLat(doc.site.lat_deg, 2)} ${formatLon(doc.site.lon_deg, 2)}`;
  const rank = effectiveRank(rankBy, doc);
  const preset = presets.status === "ready" ? presets.data.profiles.find((e) => e.profile.id === doc.profile.id) : undefined;
  const landerTitle = `${landerName(doc.profile.name)}${preset && !sameProfile(preset.profile, doc.profile) ? " (edited)" : ""}`;

  return (
    <aside className="plan-side" aria-label="Plan">
      <PlanFile />

      <div className="plan-cards">
        <Card
          field="site"
          icon="pin"
          label="Site"
          value={siteName}
          width={onMap ? 360 : 860}
          lines={
            <>
              {coordText !== siteName && <span className="plan-card-line num">{coordText}</span>}
              {area && <span className="plan-card-line plan-card-widen">{area}</span>}
            </>
          }
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
          label="Landing"
          value={landing === null ? doc.landing_utc : whenText(landing)}
          width={420}
          lines={
            <>
              <span className="plan-card-line">{`${hoursOrDays(doc.mission_duration_h)} on the surface`}</span>
              {span && <span className="plan-card-line plan-card-widen">{span}</span>}
            </>
          }
          extra={
            <div className="plan-card-steps">
              <button type="button" className="sc-step" disabled={landing === null} aria-label="Land one day earlier" onClick={() => shiftPlanLanding(-MS_DAY)}>
                <Icon name="chevronLeft" size={12} /> 1 day
              </button>
              <button type="button" className="sc-step" disabled={landing === null} aria-label="Land one day later" onClick={() => shiftPlanLanding(MS_DAY)}>
                1 day <Icon name="chevronRight" size={12} />
              </button>
            </div>
          }
        >
          <div className="plan-pick">
            <div className="plan-pick-scroll plan-pick-form">
              <TimeSection />
              <WindowControl />
            </div>
          </div>
        </Card>

        <Card field="lander" icon="lander" label="Lander" value={landerTitle} width={480} lines={landerFacts(doc.profile).map((f) => (
            <span key={f} className="plan-card-line">
              {f}
            </span>
          ))}>
          <LanderPicker />
        </Card>

        <Card
          field="constraints"
          icon="checklist"
          label="Requirements"
          value={active.length === 0 ? "No requirements" : `${active.length} requirement${active.length === 1 ? "" : "s"}`}
          width={520}
          lines={
            <>
              {active.slice(0, MAX_LISTED).map((m) => (
                <span key={m.key} className="plan-card-req">
                  <span>{m.short}</span>
                  <span className="num">{limitText(doc.constraints[m.key] as Limit)}</span>
                </span>
              ))}
              {active.length > MAX_LISTED && <span className="plan-card-line">+{active.length - MAX_LISTED} more</span>}
              {rank !== DEFAULT_RANK && <span className="plan-card-line plan-card-widen">{`Ranked by ${rankLabel(rank)}`}</span>}
            </>
          }
        >
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
