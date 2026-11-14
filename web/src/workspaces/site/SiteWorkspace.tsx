import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { WorkspaceBoundary } from "../../components/WorkspaceBoundary";
import { EllipseWorkspace } from "../ellipse/EllipseWorkspace";
import { SiteTarget } from "./SiteTarget";
import "../../styles/site.css";

export function SiteWorkspace() {
  const sub = useParams()["*"] ?? "";
  const tab = sub === "" ? "target" : sub === "accuracy" ? "accuracy" : null;
  if (tab === null) return <Navigate to="/site" replace />;
  return (
    <div className="site-shell">
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="site-shell-panel">
        <WorkspaceBoundary key={tab} workspace={tab === "target" ? "Site" : "Landing accuracy"} usesDraft>
          <Routes>
            <Route index element={<SiteTarget />} />
            <Route path="accuracy" element={<EllipseWorkspace />} />
          </Routes>
        </WorkspaceBoundary>
      </div>
    </div>
  );
}
