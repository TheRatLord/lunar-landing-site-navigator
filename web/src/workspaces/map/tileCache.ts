interface TileEntry<T> {
  state: "loading" | "ready" | "missing" | "error";
  value: T | null;
  failedAt: number;
  controller: AbortController | null;
}

export interface TileWant {
  key: string;
  url: string;
}

interface TileCacheOptions<T> {
  capacity: number;
  maxConcurrent: number;
  fetch(url: string, signal: AbortSignal): Promise<T | null>;
  dispose?(value: T): void;
  onSettled(): void;
  onError(e: unknown, url: string): void;
}

const RETRY_AFTER_MS = 5000;

export class TileCache<T> {
  private readonly entries = new Map<string, TileEntry<T>>();
  private queue: TileWant[] = [];
  private wanted = new Set<string>();
  private active = 0;

  constructor(private readonly opts: TileCacheOptions<T>) {}

  get(key: string): TileEntry<T> | undefined {
    const e = this.entries.get(key);
    if (e) {
      this.entries.delete(key);
      this.entries.set(key, e);
    }
    return e;
  }

  stats(): { loading: number; failed: number } {
    let loading = 0;
    let failed = 0;
    for (const e of this.entries.values()) {
      if (e.state === "loading") loading++;
      else if (e.state === "error") failed++;
    }
    return { loading, failed };
  }

  want(list: TileWant[]): void {
    this.wanted = new Set(list.map((w) => w.key));
    this.queue = [];
    for (const [key, e] of this.entries) {
      if (e.state === "loading" && !this.wanted.has(key)) {
        e.controller?.abort();
        this.entries.delete(key);
      }
    }
    const t = performance.now();
    for (const w of list) {
      const e = this.entries.get(w.key);
      if (e && (e.state !== "error" || t - e.failedAt < RETRY_AFTER_MS)) continue;
      this.queue.push(w);
    }
    this.pump();
    this.evict();
  }

  clear(): void {
    this.queue = [];
    this.wanted.clear();
    for (const e of this.entries.values()) {
      e.controller?.abort();
      if (e.value !== null) this.opts.dispose?.(e.value);
    }
    this.entries.clear();
  }

  private pump(): void {
    while (this.active < this.opts.maxConcurrent && this.queue.length > 0) {
      this.start(this.queue.shift()!);
    }
  }

  private start({ key, url }: TileWant): void {
    const old = this.entries.get(key);
    const controller = new AbortController();
    const entry: TileEntry<T> = { state: "loading", value: null, failedAt: old?.failedAt ?? 0, controller };
    this.entries.set(key, entry);
    this.active++;
    void this.opts
      .fetch(url, controller.signal)
      .then((value) => {
        if (this.entries.get(key) !== entry) {
          if (value !== null) this.opts.dispose?.(value);
          return;
        }
        entry.controller = null;
        entry.value = value;
        entry.state = value === null ? "missing" : "ready";
        this.opts.onSettled();
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || this.entries.get(key) !== entry) return;
        entry.controller = null;
        entry.state = "error";
        entry.failedAt = performance.now();
        this.opts.onError(e, url);
        this.opts.onSettled();
      })
      .finally(() => {
        this.active--;
        this.pump();
        this.evict();
      });
  }

  private evict(): void {
    if (this.entries.size <= this.opts.capacity) return;
    for (const [key, e] of this.entries) {
      if (this.entries.size <= this.opts.capacity) break;
      if (e.state === "loading" || this.wanted.has(key)) continue;
      if (e.value !== null) this.opts.dispose?.(e.value);
      this.entries.delete(key);
    }
  }
}

export function tileKey(tileset: string, layer: string, z: number, x: number, y: number): string {
  return `${tileset}/${layer}/${z}/${x}/${y}`;
}
