import { horizonBins, type BinsRequest } from "./horizonBins";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BinsRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const out = horizonBins(e.data);
  scope.postMessage(out, [out.buffer]);
};
