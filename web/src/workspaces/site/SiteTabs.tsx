import { useLocation, useNavigate } from "react-router-dom";
import { Tabs, type TabItem } from "../../components/ui/Panel";

const SITE_TABS = [
  { id: "point", label: "Landing point" },
  { id: "ellipse", label: "Landing ellipse" },
] as const satisfies readonly TabItem[];

export function SiteTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab = pathname.replace(/\/+$/, "").endsWith("/site/ellipse") ? "ellipse" : "point";
  return <Tabs tabs={SITE_TABS} value={tab} onChange={(id) => navigate(id === "point" ? "/site" : "/site/ellipse")} label="Site views" panels />;
}
