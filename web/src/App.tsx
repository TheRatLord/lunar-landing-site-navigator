import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Spinner } from "./components/ui/Progress";
import { LearnRoute } from "./learn/LearnRoute";
import { AppShell } from "./shell/AppShell";
import { WORKSPACES } from "./workspaces/registry";

const Gallery = import.meta.env.DEV ? lazy(() => import("./dev/Gallery")) : null;

const HOME = WORKSPACES[0]!.path;

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/learn/*" element={<LearnRoute />} />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={HOME} replace />} />
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
          <Route path="*" element={<Navigate to={HOME} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
