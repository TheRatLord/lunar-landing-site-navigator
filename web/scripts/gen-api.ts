import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = resolve(root, "src/api/openapi.json");
const out = resolve(root, "src/api/generated/schema.d.ts");

mkdirSync(dirname(spec), { recursive: true });
mkdirSync(dirname(out), { recursive: true });

const url = process.env["LUNARNAV_OPENAPI_URL"];
if (url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  writeFileSync(spec, JSON.stringify(await res.json(), null, 2) + "\n");
} else {
  const venv = resolve(root, "../.venv/bin/lunarnav");
  const bin = process.env["LUNARNAV_BIN"] ?? (existsSync(venv) ? venv : "lunarnav");
  const run = spawnSync(bin, ["openapi", spec], { stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`\n\`${bin} openapi ${spec}\` failed (exit ${run.status}). Set LUNARNAV_BIN to the lunarnav executable, or LUNARNAV_OPENAPI_URL to a running service's /openapi.json.`);
    process.exit(1);
  }
}

const gen = spawnSync("bunx", ["openapi-typescript", spec, "-o", out], { cwd: root, stdio: "inherit" });
if (gen.status !== 0) process.exit(gen.status ?? 1);
console.log(`wrote ${out}`);
