import { useLocation, useNavigate } from "react-router-dom";
import { Tabs, type TabItem } from "../../components/ui/Panel";

const SITE_TABS = [
  { id: "target", label: "Target point" },
  { id: "accuracy", label: "Landing ellipse" },
] as const satisfies readonly TabItem[];

/** Sub-view tabs of the Site page; the matching tabpanel is rendered by `SiteWorkspace`. */
export function SiteTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab = pathname.replace(/\/+$/, "").endsWith("/site/accuracy") ? "accuracy" : "target";
  return <Tabs tabs={SITE_TABS} value={tab} onChange={(id) => navigate(id === "target" ? "/site" : "/site/accuracy")} label="Site views" panels />;
}
