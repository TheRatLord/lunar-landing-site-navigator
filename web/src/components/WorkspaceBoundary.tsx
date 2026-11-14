import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { selectDirty, useScenario } from "../scenario/store";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import "../styles/chrome.css";

export interface WorkspaceBoundaryProps {
  workspace: string;
  usesDraft?: boolean;
  children: ReactNode;
}

interface State {
  error: unknown;
  failed: boolean;
  attempt: number;
}

export class WorkspaceBoundary extends Component<WorkspaceBoundaryProps, State> {
  override state: State = { error: null, failed: false, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`${this.props.workspace} workspace failed`, error, info.componentStack);
  }

  private reload = (): void => this.setState((s) => ({ error: null, failed: false, attempt: s.attempt + 1 }));

  private discard = (): void => {
    const s = useScenario.getState();
    if (selectDirty(s) && !window.confirm(`“${s.doc?.name ?? "The plan"}” has unsaved edits. Discard them?`)) return;
    s.discardDraft();
    this.reload();
  };

  override render(): ReactNode {
    const { workspace, usesDraft, children } = this.props;
    const { failed, error, attempt } = this.state;
    if (!failed) return <Fragment key={attempt}>{children}</Fragment>;
    return (
      <div className="sn sn-boundary" role="alert" data-testid="workspace-error">
        <Icon name="warn" size={16} className="sn-icon" />
        <div className="sn-body">
          <div className="sn-head">
            <strong className="sn-title">{workspace} page could not render</strong>
          </div>
          <p className="sn-detail">{error instanceof Error ? error.message || error.name : String(error)}</p>
        </div>
        <Button size="sm" variant="ghost" icon="reset" onClick={this.reload}>
          Reload
        </Button>
        {usesDraft && (
          <Button size="sm" variant="ghost" onClick={this.discard}>
            Discard unsaved edits
          </Button>
        )}
      </div>
    );
  }
}
