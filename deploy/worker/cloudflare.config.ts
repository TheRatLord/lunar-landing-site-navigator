import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "lunarnav",
    compatibilityDate: "2026-11-01",
    entrypoint: "./src/index.ts",
    domains: ["moonwalker.cinne.dev", "moonwalkr.cinne.dev", "lunar.cinne.dev"],
    workersDev: false,
    env: {
      API: bindings.vpcService({ id: "01a1db3a-5480-7102-a51e-cba24b0396d6" }),
    },
    observability: { enabled: true },
  },
});
