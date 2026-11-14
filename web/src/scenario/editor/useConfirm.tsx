import { useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";

interface Ask {
  title: string;
  consequence: string;
  action: string;
}

/** In-app replacement for window.confirm: `confirm(ask)` resolves true when the user accepts. Render `dialog` once. */
export function useConfirm(): { confirm: (ask: Ask) => Promise<boolean>; dialog: ReactNode } {
  const [ask, setAsk] = useState<Ask | null>(null);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  const confirm = (a: Ask) => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    settle.current = resolve;
    setAsk(a);
    return promise;
  };
  const answer = (ok: boolean) => {
    settle.current?.(ok);
    settle.current = null;
    setAsk(null);
  };

  const dialog = ask && (
    <Modal
      title={ask.title}
      width={420}
      onClose={() => answer(false)}
      footer={
        <>
          <Button onClick={() => answer(false)}>Cancel</Button>
          <Button variant="primary" data-autofocus onClick={() => answer(true)}>
            {ask.action}
          </Button>
        </>
      }
    >
      <p className="sc-consequence">{ask.consequence}</p>
    </Modal>
  );
  return { confirm, dialog };
}
