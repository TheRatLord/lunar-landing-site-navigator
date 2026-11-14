import { useEffect } from "react";
import { create } from "zustand";

export interface ScreenContext {
  where: string;
  summary: string;
  lines: string[];
}

interface ScreenContextStore {
  ctx: ScreenContext | null;
  set(ctx: ScreenContext | null): void;
}

export const useScreenContext = create<ScreenContextStore>((set) => ({
  ctx: null,
  set: (ctx) => set({ ctx }),
}));

export function usePublishScreenContext(ctx: ScreenContext | null): void {
  const key = ctx ? JSON.stringify(ctx) : null;
  useEffect(() => {
    useScreenContext.getState().set(key ? (JSON.parse(key) as ScreenContext) : null);
    return () => useScreenContext.getState().set(null);
  }, [key]);
}
