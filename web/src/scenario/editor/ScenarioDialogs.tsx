import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Progress";
import { parseUtc } from "../../lib/time";
import { scenarioApi } from "../api";
import { forgetPlan, myPlanIds } from "../myPlans";
import { selectDirty, useScenario } from "../store";
import type { ScenarioRecord } from "../types";
import { whenText } from "../when";
import { useEditorUi } from "./editorUi";
import { useConfirm } from "./useConfirm";

export function ScenarioDialogs() {
  const dialog = useEditorUi((s) => s.dialog);
  const setDialog = useEditorUi((s) => s.setDialog);
  if (dialog === "open") return <OpenDialog onClose={() => setDialog("none")} />;
  return null;
}

async function loadMine(): Promise<ScenarioRecord[]> {
  const ids = myPlanIds();
  const settled = await Promise.allSettled(ids.map((id) => scenarioApi.get(id)));
  const out: ScenarioRecord[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") out.push(r.value);
    else if (r.reason instanceof ApiError && r.reason.notFound) forgetPlan(ids[i] ?? "");
  });
  return out.sort((a, b) => (parseUtc(b.updated_utc) ?? 0) - (parseUtc(a.updated_utc) ?? 0));
}

function OpenDialog({ onClose }: { onClose: () => void }) {
  const load = useScenario((s) => s.load);
  const current = useScenario((s) => s.saved?.id);
  const dirty = useScenario(selectDirty);
  const name = useScenario((s) => s.doc?.name);
  const { confirm, dialog } = useConfirm();
  const [plans, setPlans] = useState<ScenarioRecord[] | null>(null);

  useEffect(() => {
    let live = true;
    void loadMine().then((p) => live && setPlans(p));
    return () => {
      live = false;
    };
  }, []);

  const openOne = (p: ScenarioRecord) => {
    void (dirty ? confirm({ title: "Discard unsaved edits?", consequence: `“${name || "Untitled plan"}” has unsaved edits.`, action: "Open" }) : Promise.resolve(true)).then((ok) => {
      if (ok) void load(p.id).then(onClose);
    });
  };
  const remove = (p: ScenarioRecord) => {
    forgetPlan(p.id);
    setPlans((list) => list?.filter((x) => x.id !== p.id) ?? null);
  };

  return (
    <Modal
      title="Open plan"
      onClose={onClose}
      width={520}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {plans === null && <Spinner size={14} />}
      {plans?.length === 0 && <EmptyState icon="folder" title="No saved plans yet" />}
      {plans && plans.length > 0 && (
        <ul className="sc-list" aria-label="Your plans">
          {plans.map((p) => (
            <li key={p.id} aria-current={p.id === current ? "true" : undefined}>
              <span className="sc-list-name">{p.name}</span>
              <span className="dim num sc-list-date">{whenText(parseUtc(p.updated_utc) ?? 0)}</span>
              {p.id === current ? (
                <span className="chip chip-pass">Open</span>
              ) : (
                <Button size="sm" onClick={() => openOne(p)}>
                  Open
                </Button>
              )}
              <IconButton icon="close" label={`Remove ${p.name} from this list`} size="sm" onClick={() => remove(p)} />
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Modal>
  );
}
