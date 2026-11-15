import { toast } from "../state/toasts";

const API_BASE = "/api/v1";

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  request_id?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly type: string | undefined;
  readonly requestId: string | undefined;
  readonly problem: ProblemDetails | undefined;

  constructor(init: { status: number; title: string; detail?: string; type?: string; requestId?: string; problem?: ProblemDetails; cause?: unknown }) {
    super(init.detail ? `${init.title}: ${init.detail}` : init.title, { cause: init.cause });
    this.name = "ApiError";
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.type = init.type;
    this.requestId = init.requestId;
    this.problem = init.problem;
  }

  get unavailable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
  get notFound(): boolean {
    return this.status === 404;
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  accept?: string;
}

export function apiUrl(path: string, query?: Query): string {
  const url = path.startsWith("/api/") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

let demoRequests = false;

export function setDemoRequests(on: boolean): void {
  demoRequests = on;
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function errorFromResponse(res: Response, sentRequestId: string): Promise<ApiError> {
  const requestId = res.headers.get("x-request-id") ?? sentRequestId;
  let problem: ProblemDetails | undefined;
  let text = "";
  try {
    text = await res.text();
    if (/json/.test(res.headers.get("content-type") ?? "")) problem = JSON.parse(text) as ProblemDetails;
  } catch {
  }
  const detail = typeof problem?.detail === "string" ? problem.detail : problem ? undefined : text.slice(0, 300) || undefined;
  const title = typeof problem?.title === "string" ? problem.title : res.statusText || `HTTP ${res.status}`;
  return new ApiError({
    status: res.status,
    title,
    detail,
    type: typeof problem?.type === "string" ? problem.type : undefined,
    requestId: (typeof problem?.request_id === "string" ? problem.request_id : undefined) ?? requestId,
    problem,
  });
}

export async function request(path: string, opts: RequestOptions = {}): Promise<Response> {
  const requestId = newRequestId();
  const headers: Record<string, string> = { Accept: opts.accept ?? "application/json", "X-Request-ID": requestId, ...opts.headers };
  if (demoRequests) headers["X-Lunarnav-Demo"] = "1";
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (typeof opts.body === "string" || opts.body instanceof FormData || opts.body instanceof Blob) body = opts.body;
    else {
      body = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), { method: opts.method ?? "GET", headers, body, signal: opts.signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError({
      status: 0,
      title: "Engine unreachable",
      detail: e instanceof Error ? e.message : String(e),
      requestId,
      cause: e,
    });
  }
  if (!res.ok) throw await errorFromResponse(res, requestId);
  return res;
}

export async function getJson<T>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
  return (await request(path, opts)).json() as Promise<T>;
}

export async function sendJson<T>(path: string, body: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
  const res = await request(path, { method: "POST", ...opts, body });
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function getText(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<string> {
  return (await request(path, { accept: "text/*, application/json", ...opts })).text();
}

export function reportError(e: unknown, context?: string): void {
  if (isAbort(e)) return;
  if (e instanceof ApiError) {
    const id = e.requestId ? ` · request ${e.requestId}` : "";
    toast({ kind: "error", title: context ? `${context}: ${e.title}` : e.title, detail: `${e.detail ?? (e.unavailable ? "The engine is not reachable." : `HTTP ${e.status}`)}${id}` });
  } else {
    toast({ kind: "error", title: context ?? "Unexpected error", detail: e instanceof Error ? e.message : String(e) });
  }
}
