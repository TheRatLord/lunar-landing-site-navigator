import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tabs } from "../../components/ui/Panel";
import { EXPLORE_VIEWS as VIEWS, exploreMapHref, rememberMapSearch } from "./exploreMapHref";

/** Sub-view tabs of the Explore page; rendered in each sub-page's `PageHeader`. */
export function ExploreTabs() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const path = pathname.replace(/\/+$/, "");
  const view = VIEWS.find((v) => v.path === path) ?? VIEWS[0];

  useEffect(() => {
    if (view.id === "map") rememberMapSearch(search);
  }, [view.id, search]);

  const open = (id: string) => {
    const next = VIEWS.find((v) => v.id === id)!;
    navigate(next.id === "map" ? exploreMapHref() : next.path);
  };
  return <Tabs tabs={VIEWS.map(({ id, label }) => ({ id, label }))} value={view.id} onChange={open} label="Explore views" panels />;
}
