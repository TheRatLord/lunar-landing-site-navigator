import { toast } from "../state/toasts";
import { forgetDemoSearch } from "./planSearch";
import { useScenario } from "./store";

export async function resetDemo(quiet = false): Promise<boolean> {
  forgetDemoSearch();
  const ok = await useScenario.getState().openDemo(true);
  if (ok && !quiet) toast({ kind: "info", title: "Demo reset" });
  return ok;
}
