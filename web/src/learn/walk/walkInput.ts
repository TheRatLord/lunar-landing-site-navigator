export interface Drive {
  forward: number;
  turn: number;
  jump: boolean;
}

const FORWARD = new Set(["KeyW", "ArrowUp"]);
const BACK = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const HANDLED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, "Space", "KeyE", "KeyL", "KeyV"]);
const BLOCK = "input, textarea, select, [role=radio], [role=slider], [contenteditable=true]";
const PRESSABLE = "button, a, summary";

export class WalkInput {
  private readonly down = new Set<string>();
  private stick = { x: 0, y: 0 };
  private jumpQueued = false;
  onSwitch: (() => void) | null = null;
  onLights: (() => void) | null = null;
  onPov: (() => void) | null = null;
  onActive: (() => void) | null = null;
  private enabled = false;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  constructor() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.clear);
    document.addEventListener("visibilitychange", this.clear);
  }

  private readonly onDown = (e: KeyboardEvent) => {
    if (!this.enabled || !HANDLED.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(BLOCK)) return;
    if (e.code === "Space" && t?.closest?.(PRESSABLE)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === "Space") this.jumpQueued = true;
    else if (e.code === "KeyE") this.onSwitch?.();
    else if (e.code === "KeyL") this.onLights?.();
    else if (e.code === "KeyV") this.onPov?.();
    else this.down.add(e.code);
    this.onActive?.();
  };

  private readonly onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  readonly clear = () => {
    this.down.clear();
    this.stick = { x: 0, y: 0 };
    this.jumpQueued = false;
  };

  private any(keys: Set<string>): boolean {
    for (const k of keys) if (this.down.has(k)) return true;
    return false;
  }

  setStick(x: number, y: number): void {
    this.stick = { x, y };
    if (x || y) this.onActive?.();
  }

  pressJump(): void {
    this.jumpQueued = true;
    this.onActive?.();
  }

  read(): Drive {
    const kf = (this.any(FORWARD) ? 1 : 0) - (this.any(BACK) ? 1 : 0);
    const kt = (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0);
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return {
      forward: Math.max(-1, Math.min(1, kf + this.stick.y)),
      turn: Math.max(-1, Math.min(1, kt + this.stick.x)),
      jump,
    };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.clear);
    document.removeEventListener("visibilitychange", this.clear);
  }
}
