// The last line: a render crash shows "Something broke. Your data is safe."
// with one Reload action and nothing else on screen (EmptyState error).
import { Component, type ErrorInfo, type ReactNode } from "react";
import { EmptyState } from "../design/EmptyState";
import { reportError } from "./errorReporting";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, "boundary", info.componentStack ?? undefined);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ot-takeover">
        <EmptyState error tag="ERROR" title="Something broke." body="Your data is safe." action={{ label: "Reload", variant: "secondary", onClick: () => window.location.reload() }} />
      </div>
    );
  }
}
