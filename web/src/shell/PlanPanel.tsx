import { lazy, Suspense } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Button, IconButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Spinner } from "../components/ui/Progress";
import { formatLat, formatLon } from "../lib/coords";
import { MS_DAY, MS_HOUR, formatUtc, parseUtc } from "../lib/time";
import { useEditorUi } from "../scenario/editor/editorUi";
import { CONSTRAINT_META } from "../scenario/editor/fieldSpecs";
import { TimeSection } from "../scenario/editor/TimeSection";
import { shiftPlanLanding, useScenario } from "../scenario/store";
import { stackIds, stackName } from "../scenario/terrainStack";
import type { Limit } from "../scenario/types";
import { useApp } from "../state/store";
import { SETUP_WORKSPACE, usesTime } from "../workspaces/registry";
import { Card } from "./plan/Card";
import { landerFacts } from "./plan/landerFacts";
import { LanderPicker } from "./plan/LanderPicker";
import { RequirementsPicker } from "./plan/RequirementsPicker";
import { PlanFile } from "./PlanFile";

const SitePicker = lazy(() => import("./plan/SitePicker").then((m) => ({ default: m.SitePicker })));

const MAX_LISTED = 6;

function stayText(hours: number): string {
  return hours >= 48 ? `Landing, then ${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)} days on the surface` : `Landing, then ${hours} hours on the surface`;
}

function limitText(limit: Limit): string {
  const unit = !limit.unit ? "" : limit.unit === "°" ? "°" : ` ${limit.unit}`;
  const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;
  if (has(limit.min) && has(limit.max)) return `${limit.min} to ${limit.max}${unit}`;
  if (has(limit.max)) return `≤ ${limit.max}${unit}`;
  if (has(limit.min)) return `≥ ${limit.min}${unit}`;
  return "no limit yet";
}

export function PlanPanel() {
  const doc = useScenario((s) => s.doc);
  const show = useEditorUi((s) => s.show);
  const openField = useEditorUi((s) => s.openField);
  const fieldDetail = useEditorUi((s) => s.fieldDetail);
  const collapsed = useApp((s) => s.planCollapsed);
  const setCollapsed = useApp((s) => s.setPlanCollapsed);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (!doc) return <aside className="plan-side" aria-hidden="true" />;

  const landing = parseUtc(doc.landing_utc);
  const siteName = doc.site.name || doc.site.catalog_id || "Unnamed site";
  const active = CONSTRAINT_META.filter((m) => doc.constraints[m.key]);

  return (
    <aside className="plan-side" data-collapsed={collapsed} aria-label="Current plan: site, landing, lander and requirements">
      <PlanFile />

      <div className="plan-cards">
        <Card
          field="site"
          icon="pin"
          label="Site"
          value={siteName}
          title="Choose the landing site"
          width={860}
          lines={<span className="plan-card-line num">{`${formatLat(doc.site.lat_deg, 2)} ${formatLon(doc.site.lon_deg, 2)}`}</span>}
        >
          <Suspense
            fallback={
              <p className="plan-empty" role="status">
                <Spinner size={12} /> Loading the site picker
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
          value={landing === null ? doc.landing_utc : `${formatUtc(landing, { seconds: false }).replace("Z", "")} UTC`}
          title="Choose the landing time and the stay on the surface"
          width={460}
          lines={<span className="plan-card-line">{stayText(doc.mission_duration_h)}</span>}
          extra={
            <div className="plan-card-steps">
              <button type="button" className="sc-step" disabled={landing === null} title="Land one day earlier" onClick={() => shiftPlanLanding(-MS_DAY)}>
                <Icon name="chevronLeft" size={12} /> 1 day
              </button>
              <button type="button" className="sc-step" disabled={landing === null} title="Land one day later" onClick={() => shiftPlanLanding(MS_DAY)}>
                1 day <Icon name="chevronRight" size={12} />
              </button>
            </div>
          }
        >
          <div className="plan-pick">
            <div className="plan-pick-scroll plan-pick-form">
              <TimeSection scrubber={usesTime(pathname)} transferOpen={fieldDetail === "transfer"} />
            </div>
            <div className="plan-pop-foot">
              {landing !== null && <span className="faint num">Ends {formatUtc(landing + doc.mission_duration_h * MS_HOUR, { seconds: false })}</span>}
              <Button
                size="sm"
                icon="calendar"
                onClick={() => {
                  openField(null);
                  navigate("/dates");
                }}
              >
                Find good landing dates
              </Button>
            </div>
          </div>
        </Card>

        <Card field="lander" icon="lander" label="Lander" value={doc.profile.name} title="Choose the lander" width={480} lines={<span className="plan-card-line">{landerFacts(doc.profile)}</span>}>
          <LanderPicker />
        </Card>

        <Card
          field="constraints"
          icon="checklist"
          label="Requirements"
          value={active.length === 0 ? "No requirements" : `${active.length} requirement${active.length === 1 ? "" : "s"}`}
          title="Choose what a site and date must meet to pass"
          width={520}
          lines={
            active.length === 0 ? (
              <span className="plan-card-line">Every site and date passes</span>
            ) : (
              <>
                {active.slice(0, MAX_LISTED).map((m) => (
                  <span key={m.key} className="plan-card-req">
                    <span>{m.short}</span>
                    <span className="num">{limitText(doc.constraints[m.key] as Limit)}</span>
                  </span>
                ))}
                {active.length > MAX_LISTED && <span className="plan-card-line">+{active.length - MAX_LISTED} more</span>}
              </>
            )
          }
        >
          <RequirementsPicker />
        </Card>
      </div>

      <div className="plan-side-foot">
        {doc.terrain_stores != null && (
          <button type="button" className="plan-flag" title={`${stackName(doc.terrain_stores)}: ${stackIds(doc.terrain_stores)}`} onClick={() => show("model")}>
            <Icon name="terrain" size={12} /> <span>Custom terrain</span>
          </button>
        )}
        <NavLink to={SETUP_WORKSPACE.path} title={SETUP_WORKSPACE.about} className={({ isActive }) => `plan-setup${isActive ? " active" : ""}`}>
          <Icon name="settings" size={14} />
          <span>{SETUP_WORKSPACE.label}</span>
        </NavLink>
        <IconButton icon={collapsed ? "expand" : "collapse"} size="sm" label={collapsed ? "Show the plan panel" : "Shrink the plan panel"} onClick={() => setCollapsed(!collapsed)} />
      </div>
    </aside>
  );
}
