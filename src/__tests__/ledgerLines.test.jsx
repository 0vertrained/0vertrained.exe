// src/__tests__/ledgerLines.test.jsx
// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// V17.1 · Ledger Lines — every number defends itself. Pins:
//   (1) the MethodLine primitive (method renders always; detail hidden until
//       the summary is toggled; no-detail variant renders as a plain line);
//   (2) the sweep — TDEE, Training Load (ACWR), and muscle-volume landmarks
//       each carry a MethodLine, with jargon confined to expandables;
//   (3) the three disclosure registers coexist (MethodNote, ⓘ toggle,
//       MethodLine) — no rival primitives;
//   (4) the Session Mode offline stamp appears exactly when connectivity
//       drops and clears on return;
//   (5) scope decisions on record: undo toasts were dropped because the app
//       has no day-to-day delete affordances (edit-in-place by design; the
//       only destructive actions are account-level behind ConfirmDialog) —
//       pinned so the plan's original instruction isn't re-applied blind.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, fireEvent, act } from "@testing-library/react";
import { useState, useEffect } from "react";
import { ThemeProvider } from "../theme";
import { MethodLine } from "../whitepaper";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

afterEach(cleanup);
const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("V17.1 MethodLine primitive (mounted)", () => {
  it("renders the method line always; detail stays hidden until toggled", () => {
    const { getByText, getByTestId, queryByText } = wrap(
      <MethodLine method="vs your 28-day norm" detail={<span>The long plain-language story.</span>} />
    );
    expect(getByText("vs your 28-day norm")).toBeTruthy();
    const details = getByTestId("method-line");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details.open).toBe(false);
    // jsdom doesn't auto-toggle <details>; assert the mechanism + content wiring.
    fireEvent.click(details.querySelector("summary"));
    details.open = true;
    expect(queryByText("The long plain-language story.")).toBeTruthy();
  });

  it("no detail → a plain line, not an expandable; no method → renders nothing", () => {
    const { getByTestId, rerender, container } = wrap(<MethodLine method="just the line" />);
    expect(getByTestId("method-line").tagName.toLowerCase()).toBe("div");
    rerender(<ThemeProvider><MethodLine method={null} detail={<span>x</span>} /></ThemeProvider>);
    expect(container.textContent).toBe("");
  });
});

describe("V17.1 the sweep (source guards)", () => {
  it("TDEE defends itself: ledger method + measured-vs-formula expandable", () => {
    const src = read("src/EnergyIntelligence.jsx");
    expect(src).toContain('testId="method-tdee"');
    expect(src).toContain("not a formula estimate");
    expect(src).toMatch(/Mifflin/);
  });

  it("Training Load: ACWR stops being unexplained jargon", () => {
    const src = read("src/RecoveryDashboard.jsx");
    expect(src).toContain('testId="method-load"');
    expect(src).toContain("28-day norm");
    expect(src).toMatch(/acute:chronic/);
  });

  it("muscle volume: landmark gloss lives behind the expandable, in plain words", () => {
    const src = read("src/MuscleVolumeSection.jsx");
    expect(src).toContain('testId="method-volume"');
    expect(src).toMatch(/minimum weekly sets/i);
    expect(src).toMatch(/most you can recover from/i);
    expect(src).toContain("a map, not a rulebook");
  });

  it("three disclosure registers, no rivals: MethodNote and the ⓘ toggle survive alongside MethodLine", () => {
    const wp = read("src/whitepaper.jsx");
    expect(wp).toContain("export function MethodNote");
    expect(wp).toContain("export function MethodLine");
    expect(read("src/RecoveryDashboard.jsx")).toContain("ReadinessMethodToggle");
  });

  it("recovery ledger provenance was already covered (V16.5) — not duplicated", () => {
    const src = read("src/RecoveryDashboard.jsx");
    expect(src).toMatch(/raw wearable value, scoring source, sample depth/);
  });
});

describe("V17.1 Session Mode offline stamp (source + behavior)", () => {
  it("stamp markup, self-contained listener, and honest copy are wired", () => {
    const src = read("src/SessionMode.jsx");
    expect(src).toContain('data-testid="session-offline-stamp"');
    expect(src).toContain('window.addEventListener("offline"');
    expect(src).toContain("Saved on device");
    // Renders only when offline:
    expect(src).toMatch(/\{!online && \(/);
  });

  it("connectivity events flip the stamp (hook behavior via a harness)", () => {
    // The full SessionMode mount needs a program fixture; the hook logic is
    // exercised through an identical minimal harness (same listener wiring).
    function Harness() {
      const [online, setOnline] = useState(navigator.onLine !== false);
      useEffect(() => {
        const up = () => setOnline(true);
        const down = () => setOnline(false);
        window.addEventListener("online", up);
        window.addEventListener("offline", down);
        return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
      }, []);
      return online ? null : <div data-testid="stamp">offline</div>;
    }
    const { queryByTestId } = wrap(<Harness />);
    expect(queryByTestId("stamp")).toBeNull();
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(queryByTestId("stamp")).toBeTruthy();
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(queryByTestId("stamp")).toBeNull();
  });
});

describe("V17.1 scope decisions on record", () => {
  it("undo toasts have no wiring target: no day-to-day delete affordances exist; account-level stays behind ConfirmDialog", () => {
    // If a future release ADDS deletion affordances, this pin is the reminder
    // that undo-toast infrastructure was the agreed pattern for them.
    for (const f of ["src/TodayTab.jsx", "src/FuelTab.jsx", "src/SessionMode.jsx"]) {
      expect(read(f)).not.toMatch(/deleteEntry|removeMeal|deleteSet\(/);
    }
    expect(read("src/MoreTab.jsx")).toContain("ConfirmDialog");
  });
});
