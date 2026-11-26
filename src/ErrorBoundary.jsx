// src/ErrorBoundary.jsx
// Error boundaries for the app shell. Two goals: (1) one tab or overlay
// crashing must not take down the whole app; (2) every boundary catch is
// reported through errorReporting.js so beta failures are visible instead of
// silent. The fallback is a contained card with a retry, never a white
// screen.

import { Component } from "react";
import { reportError, errorKey, normalizeError } from "./errorReporting";
import { APP_VERSION, buildSupportMailto } from "./appMeta";

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, refCode: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const normalized = normalizeError(error, {
      source: `boundary:${this.props.label || "app"}`,
      componentStack: info?.componentStack,
    });
    this.setState({ refCode: errorKey(normalized) });
    reportError(error, {
      source: `boundary:${this.props.label || "app"}`,
      componentStack: info?.componentStack,
    });
  }

  reset = () => this.setState({ error: null, refCode: null });

  render() {
    const { error, refCode } = this.state;
    const { label } = this.props;
    if (!error) return this.props.children;
    const panel = (
      <section role="alert" className="card" style={{ display: "flex", flexDirection: "column", gap: 8, margin: "12px 16px" }}>
        {label && label !== "App" && <p className="t-s c2">In {label}</p>}
        <p className="t-bs">Something broke here.</p>
        <p className="t-b c2">
          {label === "App" ? "Your log is safe" : "The rest of the app still works"}, and this error was reported automatically.
          {refCode ? ` Reference ${refCode}.` : ""}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn btn-s btn-sm" onClick={this.reset}>Try again</button>
          <a
            className="btn btn-g btn-sm"
            href={buildSupportMailto({
              subject: `0VERTRAINED ${label || "app"} error`,
              body: `Version: ${APP_VERSION}\nRoute: ${typeof window !== "undefined" ? window.location.pathname : "unknown"}\nReference: ${refCode || "pending"}\n\nWhat happened?`,
            })}
          >
            Report this
          </a>
        </div>
      </section>
    );
    // The app-level boundary replaces the whole app, so it brings the page.
    return label === "App" ? <div className="ot"><main className="main" style={{ justifyContent: "center" }}>{panel}</main></div> : panel;
  }
}

export function ErrorBoundary({ label, children }) {
  return <Boundary label={label}>{children}</Boundary>;
}
