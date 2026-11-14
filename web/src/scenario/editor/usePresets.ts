import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { presetsApi, type ConstraintPreset, type NetworkPreset, type ProfileEntry } from "../api";

export interface Presets {
  profiles: ProfileEntry[];
  constraints: ConstraintPreset[];
  networks: NetworkPreset[];
}

export type PresetsState = { status: "loading" } | { status: "ready"; data: Presets } | { status: "error"; error: ApiError };

let shared: Promise<Presets> | null = null;

export function loadPresets(): Promise<Presets> {
  shared ??= Promise.all([presetsApi.profiles(), presetsApi.constraints(), presetsApi.networks()]).then(
    ([profiles, constraints, networks]) => ({ profiles, constraints, networks }),
    (e: unknown) => {
      shared = null;
      throw e;
    },
  );
  return shared;
}

export function usePresets(): PresetsState {
  const [state, setState] = useState<PresetsState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    loadPresets().then(
      (data) => live && setState({ status: "ready", data }),
      (e: unknown) => live && setState({ status: "error", error: e instanceof ApiError ? e : new ApiError({ status: 0, title: "Could not load presets", detail: String(e) }) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
