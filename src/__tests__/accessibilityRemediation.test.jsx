import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ReadinessMethodToggle } from "../RecoveryDashboard";
import { MuscleVolumeSection } from "../MuscleVolumeSection";
import { appShellStyle } from "../App";

afterEach(cleanup);

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

const completedSets = (count) => Array.from({ length: count }, () => ({ weight: "100", reps: "8", done: true }));
const volumeData = {
  "2026-06-22": {
    workout: {
      exercises: {
        "Bench Press": { sets: completedSets(6) },
      },
    },
  },
};

describe("accessibility remediation", () => {
  it("makes the Recovery scoring-method control a named disclosure", () => {
    const onToggle = () => {};
    const { rerender } = wrap(<ReadinessMethodToggle open={false} onToggle={onToggle} />);
    const collapsed = screen.getByRole("button", { name: /show how readiness is scored/i });
    expect(collapsed.getAttribute("aria-expanded")).toBe("false");
    expect(collapsed.style.minHeight).toBe("44px");

    rerender(<ThemeProvider><ReadinessMethodToggle open onToggle={onToggle} /></ThemeProvider>);
    expect(screen.getByRole("button", { name: /hide readiness scoring method/i }).getAttribute("aria-expanded")).toBe("true");
  });

  it("explains the volume audit on demand and exposes bar data to assistive tech", () => {
    wrap(<MuscleVolumeSection data={volumeData} />);
    const guide = screen.getByRole("button", { name: /show how to read the muscle volume audit/i });
    expect(guide.getAttribute("aria-expanded")).toBe("false");
    expect(guide.style.minHeight).toBe("44px");
    fireEvent.click(guide);
    expect(screen.getByText("Hard set", { selector: "strong" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /chest: 6 hard sets this week/i })).toBeTruthy();
  });

  it("removes dock-reserve whitespace only while an overlay is open", () => {
    const base = { minHeight: "100dvh", paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))" };
    expect(appShellStyle(base, false)).toBe(base);
    expect(appShellStyle(base, true)).toEqual({ ...base, paddingBottom: 0 });
  });
});
