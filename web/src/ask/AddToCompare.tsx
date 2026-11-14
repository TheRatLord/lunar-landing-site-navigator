import { Button } from "../components/ui/Button";
import type { SiteFact } from "./siteFacts";

export function AddToCompare({ facts, onAdd }: { facts: readonly SiteFact[]; onAdd: ((facts: readonly SiteFact[]) => void) | undefined }) {
  if (facts.length === 0 || !onAdd) return null;
  return (
    <Button size="sm" icon="compare" onClick={() => onAdd(facts)}>
      {facts.length === 1 ? "Add to Compare" : `Add ${facts.length} to Compare`}
    </Button>
  );
}
