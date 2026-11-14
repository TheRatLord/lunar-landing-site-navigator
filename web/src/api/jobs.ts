import type { JobStatus } from "../contract/types";
import type { components } from "./generated/schema";
import { getJson, request, sendJson } from "./client";
import { openEventStream } from "./sse";

export type CancelReply = components["schemas"]["CancelReply"];

export function cancelJob(id: string, opts: { force?: boolean } = {}): Promise<CancelReply> {
  return sendJson<CancelReply>(`/jobs/${encodeURIComponent(id)}/cancel`, {}, opts.force ? { query: { force: true } } : {});
}

export interface JobWatch {
  onStatus?: (status: JobStatus) => void;
  onCancel?: (reply: CancelReply) => void;
  signal?: AbortSignal;
}

function watchJob<R>(id: string, { onStatus, onCancel, signal }: JobWatch = {}): Promise<R> {
  const { promise, resolve, reject } = Promise.withResolvers<R>();
  let finished = false;
  const finish = (fn: () => void) => {
    if (finished) return;
    finished = true;
    stream.close();
    signal?.removeEventListener("abort", onAbort);
    fn();
  };
  const stream = openEventStream({
    path: `/jobs/${encodeURIComponent(id)}/events`,
    onStatus: (info) => {
      if (info.status === "failed") finish(() => reject(info.error ?? new Error("Job stream failed")));
    },
    onMessage: (msg) => {
      let status: JobStatus;
      try {
        status = JSON.parse(msg.data) as JobStatus;
      } catch {
        return;
      }
      onStatus?.(status);
      if (status.state === "queued" || status.state === "running") return;
      if (status.state === "done") {
        getJson<R>(`/jobs/${encodeURIComponent(id)}/result`).then(
          (r) => finish(() => resolve(r)),
          (e) => finish(() => reject(e)),
        );
      } else {
        finish(() => reject(new Error(`Job ${status.state}${status.stage ? `: ${status.stage}` : ""}`)));
      }
    },
  });
  const onAbort = () => {
    void cancelJob(id).then((reply) => onCancel?.(reply));
    finish(() => reject(new DOMException("detached", "AbortError")));
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  promise.catch(() => undefined);
  return promise;
}

export async function awaitJob<R>(accepted: Response, watch: JobWatch): Promise<R> {
  const first: JobStatus = await accepted.json();
  watch.onStatus?.(first);
  return watchJob<R>(first.id, watch);
}

export async function runAnalysis<R>(path: string, body: unknown, opts: JobWatch & { onCache?: (hit: boolean) => void } = {}): Promise<R> {
  const submit = request(path, { method: "POST", body });
  let abortedBeforeAnswer = false;
  const aborted = new Promise<never>((_, reject) => {
    opts.signal?.addEventListener(
      "abort",
      () => {
        abortedBeforeAnswer = true;
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
  aborted.catch(() => undefined);
  if (opts.signal?.aborted) abortedBeforeAnswer = true;
  void submit.then(
    async (late) => {
      if (!abortedBeforeAnswer || late.status !== 202) return;
      const job: JobStatus = await late.json();
      const reply = await cancelJob(job.id).catch(() => undefined);
      if (reply) opts.onCancel?.(reply);
    },
    () => undefined,
  );
  if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
  const res = await Promise.race([submit, aborted]);
  opts.onCache?.(res.status !== 202 && res.headers.get("x-cache") === "hit");
  if (res.status !== 202) return (await res.json()) as R;

  return awaitJob<R>(res, opts);
}
