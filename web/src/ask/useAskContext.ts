import { useMemo } from "react";
import { selectDirty, useScenario } from "../scenario/store";
import { buildContextBlock, scenarioReach, type ScenarioReach } from "./contextBlock";
import { useScreenContext, type ScreenContext } from "./screenContext";

export interface AskContext {
  screen: ScreenContext | null;
  block: string | null;
  reach: ScenarioReach | null;
}

export function useAskContext(): AskContext {
  const screen = useScreenContext((s) => s.ctx);
  const doc = useScenario((s) => s.doc);
  const saved = useScenario((s) => s.saved);
  const dirty = useScenario(selectDirty);
  return useMemo(
    () => ({
      screen,
      block: buildContextBlock(screen, doc ? { doc, saved, dirty } : null),
      reach: doc ? scenarioReach({ saved, dirty }) : null,
    }),
    [screen, doc, saved, dirty],
  );
}
