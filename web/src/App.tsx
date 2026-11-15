import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Spinner } from "./components/ui/Progress";
import { FrontDoor } from "./front/FrontDoor";
import { LearnRoute } from "./learn/LearnRoute";
import { AppShell } from "./shell/AppShell";
import { HOME as HOME_WORKSPACE, WORKSPACES } from "./workspaces/registry";

const Gallery = import.meta.env.DEV ? lazy(() => import("./dev/Gallery")) : null;

const HOME = HOME_WORKSPACE.path;

const REDIRECTS: Array<[string, string]> = [
  ["/explore/*", "/map"],
  ["/dates/*", "/overview"],
  ["/site/accuracy", "/site/ellipse"],
  ["/demo", "/overview"],
];

function Redirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<FrontDoor />} />
        <Route path="/learn/*" element={<LearnRoute />} />
        <Route element={<AppShell />}>
          {REDIRECTS.map(([from, to]) => (
            <Route key={from} path={from} element={<Redirect to={to} />} />
          ))}
          {WORKSPACES.map((w) => (
            <Route key={w.id} path={`${w.path}/*`} element={w.element} />
          ))}
          {Gallery && (
            <Route
              path="/dev/gallery"
              element={
                <Suspense fallback={<Spinner label="Loading gallery" />}>
                  <Gallery />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<Redirect to={HOME} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
