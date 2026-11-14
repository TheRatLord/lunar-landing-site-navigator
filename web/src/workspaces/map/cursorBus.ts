import type { CursorInfo } from "./engine";

export class CursorBus {
  private listeners = new Set<(c: CursorInfo | null) => void>();
  last: CursorInfo | null = null;

  emit(c: CursorInfo | null): void {
    this.last = c;
    for (const l of this.listeners) l(c);
  }

  subscribe(fn: (c: CursorInfo | null) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
