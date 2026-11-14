import type { ApiError } from "../api/client";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import "../styles/chrome.css";

export interface ServiceNoticeProps {
  error: ApiError;
  what: string;
  onRetry?: () => void;
}

export function ServiceNotice({ error, what, onRetry }: ServiceNoticeProps) {
  const title = error.unavailable ? "Engine unreachable" : error.notFound ? "Not found" : error.title;
  const detail = error.unavailable || error.notFound ? null : error.detail;
  return (
    <div className="sn" role="alert" data-testid="service-notice">
      <Icon name={error.unavailable ? "plug" : "warn"} size={16} className="sn-icon" />
      <div className="sn-body">
        <div className="sn-head">
          <strong className="sn-title">{title}</strong>
          <span className="sn-what">{what}</span>
        </div>
        {detail && <p className="sn-detail">{detail}</p>}
        <p className="sn-meta num">
          {error.status ? `HTTP ${error.status}` : "No response"}
          {error.requestId ? ` · ${error.requestId}` : ""}
        </p>
      </div>
      {onRetry && (
        <Button size="sm" variant="ghost" icon="reset" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
