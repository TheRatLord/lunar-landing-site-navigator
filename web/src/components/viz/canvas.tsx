import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { syncFonts, type Size } from "./draw";

export interface CanvasProps extends Omit<HTMLAttributes<HTMLCanvasElement>, "children"> {
  draw: (ctx: CanvasRenderingContext2D, size: Size) => void;
  label: string;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  wrapStyle?: CSSProperties;
  onSize?: (size: Size) => void;
  children?: ReactNode;
}

export function Canvas({ draw, label, canvasRef, onSize, wrapStyle, children, className, ...rest }: CanvasProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? own;
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [fontTick, setFontTick] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize((p) => (p.w === Math.floor(r.width) && p.h === Math.floor(r.height) ? p : { w: Math.floor(r.width), h: Math.floor(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (size.w > 0) onSize?.(size);
  }, [size, onSize]);

  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFontTick((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(size.w * dpr);
    const ph = Math.round(size.h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    syncFonts();
    draw(ctx, size);
  }, [draw, size, fontTick, ref]);

  return (
    <div ref={wrap} className={`canvas-wrap ${className ?? ""}`} style={wrapStyle}>
      <canvas ref={ref} role="img" aria-label={label} {...rest} />
      {children}
    </div>
  );
}
