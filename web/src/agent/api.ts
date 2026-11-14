import { getJson, request, sendJson } from "../api/client";
import type { components } from "../api/generated/schema";
import { stripBidiDeep } from "./bidi";
import type { InstructionsInfo } from "./events";

export type AssumptionItem = components["schemas"]["AssumptionItem"];
export type AssumptionList = components["schemas"]["AssumptionList"];
export type SignoffRequest = components["schemas"]["SignoffRequest"];
export type InboxEntry = components["schemas"]["InboxEntry"];
export type InboxList = components["schemas"]["InboxList"];

type Opts = { signal?: AbortSignal };

const runPath = (id: string) => `/agent/runs/${encodeURIComponent(id)}`;

export const assumptionApi = {
  list: (id: string, o: Opts = {}): Promise<AssumptionList> =>
    getJson<AssumptionList>(`${runPath(id)}/assumptions`, o).then((r) => stripBidiDeep(r)),
  signoff: (id: string, assumptionId: string, body: SignoffRequest, o: Opts = {}): Promise<AssumptionItem> =>
    sendJson<AssumptionItem>(`${runPath(id)}/assumptions/${encodeURIComponent(assumptionId)}/signoff`, body, o).then((r) => stripBidiDeep(r)),
};

export const inboxApi = {
  list: (id: string, o: Opts = {}): Promise<InboxList> => getJson<InboxList>(`${runPath(id)}/inbox`, o).then((r) => stripBidiDeep(r)),
  upload: (id: string, file: File, o: Opts = {}): Promise<InboxEntry> =>
    request(`${runPath(id)}/inbox`, { method: "POST", query: { filename: file.name }, body: file, headers: { "Content-Type": "application/octet-stream" }, ...o }).then(
      async (res) => (await res.json()) as InboxEntry,
    ),
};

export const instructionsApi = {
  get: async (o: Opts = {}) => stripBidiDeep(await getJson<InstructionsInfo>("/agent/instructions", o)),
};
