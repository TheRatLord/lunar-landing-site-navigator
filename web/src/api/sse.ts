import { ApiError, apiUrl, errorFromResponse, isAbort } from "./client";

interface SseMessage {
  id: string | undefined;
  event: string;
  data: string;
}

class SseParser {
  private buffer = "";
  private data: string[] = [];
  private event = "";
  private id: string | undefined;
  retryMs: number | undefined;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    let start = 0;
    for (;;) {
      const m = /\r\n|\n|\r/.exec(this.buffer.slice(start));
      if (!m) break;
      if (m[0] === "\r" && start + m.index + 1 === this.buffer.length) break;
      const line = this.buffer.slice(start, start + m.index);
      start += m.index + m[0].length;
      const msg = this.line(line);
      if (msg) out.push(msg);
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  private line(line: string): SseMessage | null {
    if (line === "") {
      if (this.data.length === 0 && !this.event) return null;
      const msg: SseMessage = { id: this.id, event: this.event || "message", data: this.data.join("\n") };
      this.data = [];
      this.event = "";
      return msg;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.event = value;
    else if (field === "id" && !value.includes("\0")) this.id = value;
    else if (field === "retry" && /^\d+$/.test(value)) this.retryMs = Number(value);
    return null;
  }
}

export interface StreamStatusInfo {
  status: "connecting" | "open" | "reconnecting" | "ended" | "failed";
  attempt?: number;
  error?: ApiError | Error;
}

const MAX_RETRIES = 8;
const IDLE_MS = 45_000;

export function openEventStream(opts: {
  path: string;
  lastEventId?: string;
  onMessage: (msg: SseMessage) => void;
  onStatus?: (info: StreamStatusInfo) => void;
  reconnectOnEnd?: () => boolean;
}): { close(): void } {
  const ctl = new AbortController();
  let lastId = opts.lastEventId;

  const sleep = (ms: number) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const t = setTimeout(resolve, ms);
    ctl.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
    return promise;
  };

  void (async () => {
    let failures = 0;
    let first = true;
    while (!ctl.signal.aborted) {
      opts.onStatus?.(first ? { status: "connecting" } : { status: "reconnecting", attempt: Math.max(1, failures) });
      first = false;
      const parser = new SseParser();
      const attempt = new AbortController();
      const onAbort = () => attempt.abort();
      ctl.signal.addEventListener("abort", onAbort, { once: true });
      let stalled = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const kick = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => ((stalled = true), attempt.abort()), IDLE_MS);
      };
      try {
        const headers: Record<string, string> = { Accept: "text/event-stream", "Cache-Control": "no-cache" };
        if (lastId !== undefined) headers["Last-Event-ID"] = lastId;
        kick();
        const res = await fetch(apiUrl(opts.path), { headers, signal: attempt.signal });
        if (!res.ok) {
          const err = await errorFromResponse(res, "");
          if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
            opts.onStatus?.({ status: "failed", error: err });
            return;
          }
          throw err;
        }
        if (!res.body) throw new Error("Response has no body");
        opts.onStatus?.({ status: "open" });
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          kick();
          failures = 0;
          for (const msg of parser.push(value)) {
            if (msg.id !== undefined) lastId = msg.id;
            opts.onMessage(msg);
          }
        }
        if (!opts.reconnectOnEnd?.()) {
          opts.onStatus?.({ status: "ended" });
          return;
        }
        await sleep(parser.retryMs ?? 1000);
      } catch (e) {
        if (ctl.signal.aborted) return;
        if (isAbort(e) && !stalled) return;
        const err = stalled ? new Error(`No data for ${IDLE_MS / 1000} s; the connection is presumed dead.`) : e instanceof Error ? e : new Error(String(e));
        failures += 1;
        if (failures > MAX_RETRIES) {
          opts.onStatus?.({ status: "failed", error: err });
          return;
        }
        opts.onStatus?.({ status: "reconnecting", attempt: failures, error: err });
        await sleep(parser.retryMs ?? Math.min(10_000, 500 * 2 ** (failures - 1)));
      } finally {
        clearTimeout(watchdog);
        ctl.signal.removeEventListener("abort", onAbort);
      }
    }
  })();

  return { close: () => ctl.abort() };
}
