import { Icon } from "../components/ui/Icon";

export function CreditNotice() {
  return (
    <div className="ask-credit" role="status" data-testid="credit-spent">
      <Icon name="alert" size={14} />
      <div>
        <strong>The assistant's free credit is used up.</strong>
        <p>It runs on a shared budget that every visitor draws from, and that budget has been spent, so it can't take new questions right now. Earlier answers stay readable, and the rest of Moonwalker works without it.</p>
      </div>
    </div>
  );
}
