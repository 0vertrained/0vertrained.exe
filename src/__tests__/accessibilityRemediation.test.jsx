import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ReadinessMethodToggle } from "../RecoveryDashboard";
import { MuscleVolumeSection } from "../MuscleVolumeSection";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

  it("reserves room for the tab bar only where the tab bar shows", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const css = readFileSync(resolve(root, "src/ledger.css"), "utf8");
    // The reserve is one custom property: zero by default, the bar's height
    // on a shell that carries has-tabs. Screens and toasts read it.
    expect(css).toContain(".ot { --tabbar-h: 0px; }");
    expect(css).toMatch(/\.ot\.has-tabs \{ --tabbar-h: \d+px; \}/);
    expect(css).toMatch(/\.main \{[^}]*var\(--tabbar-h\)[^}]*safe-area-inset-bottom/);
    expect(css).toMatch(/\.legacy-screen \{[^}]*var\(--tabbar-h\)/);
    const app = readFileSync(resolve(root, "src/App.jsx"), "utf8");
    expect(app).toContain('isDesktop ? "" : " has-tabs"');
  });
});
