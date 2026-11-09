// src/__tests__/errorVisibility.test.jsx
// Error-visibility tests: the reporter's dedupe/cap logic (pure) and a
// rendered ErrorBoundary check (fallback shows, catch is reported, Try again
// recovers). React logs caught errors to console.error by design — silenced
// per-test so real failures stay visible.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ErrorBoundary } from "../ErrorBoundary";
import { normalizeError, errorKey, createReporterState, shouldReport, MAX_REPORTS_PER_SESSION } from "../errorReporting";

afterEach(cleanup);

describe("errorReporting helpers", () => {
  it("normalizes and hard-caps every field", () => {
    const n = normalizeError(new Error("x".repeat(1000)), { componentStack: "y".repeat(5000), source: "boundary:Today tab" });
    expect(n.message.length).toBe(500);
    expect(n.component_stack.length).toBe(2000);
    expect(n.source).toBe("boundary:Today tab");
    expect(n.app_version).toBeTruthy();
  });

  it("handles non-Error throwables", () => {
    expect(normalizeError("plain string").message).toBe("plain string");
    expect(normalizeError(undefined).message).toBe("Unknown error");
  });

  it("dedupes repeats and enforces the session cap", () => {
    const state = createReporterState();
    const a = normalizeError(new Error("same"), { source: "window" });
    expect(shouldReport(state, a)).toBe(true);
    expect(shouldReport(state, a)).toBe(false); // duplicate suppressed

    for (let i = 0; i < MAX_REPORTS_PER_SESSION + 5; i++) {
      shouldReport(state, normalizeError(new Error("unique " + i), { source: "window" }));
    }
    expect(state.sent).toBe(MAX_REPORTS_PER_SESSION);
  });

  it("keys are stable for identical errors and differ across sources", () => {
    const a = normalizeError(new Error("boom"), { source: "window" });
    const b = normalizeError(new Error("boom"), { source: "window" });
    const c = normalizeError(new Error("boom"), { source: "boundary:Fuel tab" });
    expect(errorKey(a)).toBe(errorKey(b));
    expect(errorKey(a)).not.toBe(errorKey(c));
  });
});

describe("ErrorBoundary", () => {
  function Bomb({ defused }) {
    if (!defused) throw new Error("kaboom");
    return <div>recovered content</div>;
  }

  it("catches a child crash, shows the whitepaper fallback, and recovers via Try again", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let defused = false;
    const { rerender } = render(
      <ThemeProvider><ErrorBoundary label="Test area"><Bomb defused={defused} /></ErrorBoundary></ThemeProvider>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Something broke here/)).toBeTruthy();
    expect(screen.getByText(/Test area/)).toBeTruthy();

    // Defuse, then reset the boundary — content should render again.
    defused = true;
    rerender(
      <ThemeProvider><ErrorBoundary label="Test area"><Bomb defused={defused} /></ErrorBoundary></ThemeProvider>
    );
    fireEvent.click(screen.getByText(/Try again/i));
    expect(screen.getByText("recovered content")).toBeTruthy();
    spy.mockRestore();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ThemeProvider><ErrorBoundary label="Quiet"><div>all fine</div></ErrorBoundary></ThemeProvider>
    );
    expect(screen.getByText("all fine")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
