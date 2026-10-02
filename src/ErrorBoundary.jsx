// src/ErrorBoundary.jsx
// V9 · Error boundaries for the app shell. Two goals: (1) one tab or overlay
// crashing must not take down the whole app; (2) every boundary catch is
// reported through errorReporting.js so beta failures are visible instead of
// silent. Fallback stays in the whitepaper language — a ruled block, not a
// white screen.

import { Component } from "react";
import { useTheme } from "./theme";
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
    const { C, S, label } = this.props;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: "16px", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: C.block }} role="alert">
        <div style={{ fontFamily: C.fontFamily, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.red, marginBottom: 8 }}>
          {label ? `${label} · error` : "Error"}
        </div>
        <div style={{ fontFamily: S.fontSerif, fontSize: 18, color: C.text, lineHeight: 1.3, marginBottom: 6 }}>
          Something broke here.
        </div>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 12 }}>
          The rest of the app is still running, and this error was reported automatically.
          {refCode ? ` Ref ${refCode}.` : ""}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={this.reset}
            style={{ background: "none", border: `1px solid ${C.text}`, color: C.text, fontFamily: C.fontFamily, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 16px", cursor: "pointer" }}
          >
            Try again
          </button>
          <a
            href={buildSupportMailto({
              subject: `0VERTRAINED ${label || "app"} error`,
              body: `Version: ${APP_VERSION}\nRoute: ${typeof window !== "undefined" ? window.location.pathname : "unknown"}\nReference: ${refCode || "pending"}\n\nWhat happened?`,
            })}
            style={{ border: `1px solid ${C.line}`, color: C.text, fontFamily: C.fontFamily, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 16px", textDecoration: "none" }}
          >
            Report this
          </a>
        </div>
      </div>
    );
  }
}

// Hooks can't be used in class components — this wrapper feeds the theme in.
export function ErrorBoundary({ label, children }) {
  const { C, S } = useTheme();
  return <Boundary label={label} C={C} S={S}>{children}</Boundary>;
}
