import type { components } from "./generated/schema";
import { ApiError, request } from "./client";
import { awaitJob, type JobWatch } from "./jobs";

const FILE_URL = /\/exports\/files\/([^/?#]+)\/[^/?#]+/;

export function exportDigest(url: string): string | null {
  const m = FILE_URL.exec(url);
  return m ? decodeURIComponent(m[1]!) : null;
}

const problemText = (e: unknown): string =>
  e instanceof ApiError ? `${e.title}${e.detail ? `: ${e.detail}` : ""}${e.type ? ` (${e.type})` : ""}` : e instanceof Error ? e.message : String(e);

export async function deleteExportOutcome(digest: string): Promise<{ removed: true } | { removed: false; problem: string; error: unknown }> {
  try {
    await request(`/exports/files/${encodeURIComponent(digest)}`, { method: "DELETE" });
    return { removed: true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { removed: true };
    return { removed: false, problem: `The engine did not delete the files: ${problemText(e)}`, error: e };
  }
}

export type ExportManifest = Pick<components["schemas"]["ExportManifest"], "files">;

export interface ExportedFile {
  blob: Blob;
  filename: string;
  sha256: string | null;
}

async function responseFile(res: Response, fallback: string): Promise<ExportedFile> {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "");
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]!) : fallback, sha256: res.headers.get("x-artifact-sha256") };
}

async function fetchExportFile(url: string): Promise<ExportedFile> {
  return responseFile(await request(url, { accept: "*/*" }), url.split("/").pop() ?? "export");
}

export interface ExportRequest extends Omit<JobWatch, "onCancel"> {
  fallback: string;
  accept?: string;
  inlineManifest?: boolean;
}

export async function postExport(path: string, body: unknown, { fallback, accept = "*/*", inlineManifest = false, ...watch }: ExportRequest): Promise<ExportManifest | ExportedFile> {
  const res = await request(path, { method: "POST", body, accept, signal: watch.signal });
  if (res.status === 202) return awaitJob<ExportManifest>(res, watch);
  if (inlineManifest && /json/.test(res.headers.get("content-type") ?? "")) return (await res.json()) as ExportManifest;
  return responseFile(res, fallback);
}

export async function exportFiles(path: string, body: Record<string, unknown>, opts: Pick<ExportRequest, "fallback" | "inlineManifest">): Promise<ExportedFile[]> {
  const out = await postExport(path, { wait_s: 30, ...body }, opts);
  return "files" in out ? Promise.all(out.files.map((f) => fetchExportFile(f.url))) : [out];
}
