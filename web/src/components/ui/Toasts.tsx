import { useToasts } from "../../state/toasts";
import { Icon, type IconName } from "./Icon";

const ICON: Record<string, IconName> = { info: "info", success: "check", warning: "warn", error: "cross" };

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toast-viewport" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <Icon name={ICON[t.kind]!} size={16} strokeWidth={2} />
          <div className="toast-text">
            <div className="toast-title">{t.title}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
          </div>
          {t.action && (
            <button
              className="btn btn-sm"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          {t.actions?.map((a) => (
            <button
              key={a.label}
              className="btn btn-sm"
              onClick={() => {
                a.run();
                dismiss(t.id);
              }}
            >
              {a.label}
            </button>
          ))}
          <button className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
