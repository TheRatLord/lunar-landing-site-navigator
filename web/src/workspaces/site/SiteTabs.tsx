import { useLocation, useNavigate } from "react-router-dom";
import { Tabs, type TabItem } from "../../components/ui/Panel";
import { useScenario } from "../../scenario/store";
import { useEllipsePassShare } from "../ellipse/store";

export function SiteTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const share = useEllipsePassShare(useScenario((s) => s.doc));
  const tab = pathname.replace(/\/+$/, "").endsWith("/site/ellipse") ? "ellipse" : "point";
  const tabs: TabItem[] = [
    { id: "point", label: "Landing site" },
    {
      id: "ellipse",
      label:
        share === null ? (
          "Landing ellipse"
        ) : (
          <>
            Landing ellipse <span className="tab-note num">{Math.round(share * 100)}% passes</span>
          </>
        ),
    },
  ];
  return <Tabs tabs={tabs} value={tab} onChange={(id) => navigate(id === "point" ? "/site" : "/site/ellipse")} label="Site views" panels variant="line" />;
}
