import { lazy, Suspense } from "react";
import { Spinner } from "../components/ui/Progress";

const LearnPage = lazy(() => import("./LearnPage"));

export function LearnRoute() {
  return (
    <Suspense fallback={<Spinner label="Loading the Moon" />}>
      <LearnPage />
    </Suspense>
  );
}
