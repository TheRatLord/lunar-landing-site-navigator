import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { WorkspaceBoundary } from "../../components/WorkspaceBoundary";
import { EllipseWorkspace } from "../ellipse/EllipseWorkspace";
import { SiteTarget } from "./SiteTarget";
import "../../styles/site.css";

export function SiteWorkspace() {
  const sub = useParams()["*"] ?? "";
  if (sub === "accuracy") return <Navigate to="/site/ellipse" replace />;
  const tab = sub === "" ? "point" : sub === "ellipse" ? "ellipse" : null;
  if (tab === null) return <Navigate to="/site" replace />;
  return (
    <div className="site-shell">
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="site-shell-panel">
        <WorkspaceBoundary key={tab} workspace={tab === "point" ? "Site" : "Landing ellipse"} usesDraft>
          <Routes>
            <Route index element={<SiteTarget />} />
            <Route path="ellipse" element={<EllipseWorkspace />} />
          </Routes>
        </WorkspaceBoundary>
      </div>
    </div>
  );
}
