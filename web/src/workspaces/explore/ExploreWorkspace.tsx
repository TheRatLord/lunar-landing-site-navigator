import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { WorkspaceBoundary } from "../../components/WorkspaceBoundary";
import { MapWorkspace } from "../map/MapWorkspace";
import { RegionalPanel } from "../regional/RegionalPanel";
import { SearchPanel } from "../search/SearchPanel";
import { EXPLORE_VIEWS } from "./exploreMapHref";

export function ExploreWorkspace() {
  const sub = useParams()["*"] ?? "";
  const view = EXPLORE_VIEWS.find((v) => v.path === `/explore${sub && `/${sub}`}`);
  if (!view) return <Navigate to="/explore" replace />;
  return (
    <div className="ex" aria-label="Explore page">
      <div role="tabpanel" id={`tabpanel-${view.id}`} aria-labelledby={`tab-${view.id}`} className={`ex-panel ex-panel-${view.id}`}>
        <WorkspaceBoundary key={view.id} workspace={view.label} usesDraft>
          <Routes>
            <Route index element={<MapWorkspace />} />
            <Route path="find" element={<SearchPanel />} />
            <Route path="regional" element={<RegionalPanel />} />
          </Routes>
        </WorkspaceBoundary>
      </div>
    </div>
  );
}
