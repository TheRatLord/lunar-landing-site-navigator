import type { Object3D } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

class BlobReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(b).toString("base64")}`;
      this.onloadend?.();
    });
  }
}

(globalThis as unknown as { FileReader: unknown }).FileReader ??= BlobReader;

export async function toGlb(root: Object3D): Promise<ArrayBuffer> {
  const out = await new GLTFExporter().parseAsync(root, { binary: true });
  return out as ArrayBuffer;
}
