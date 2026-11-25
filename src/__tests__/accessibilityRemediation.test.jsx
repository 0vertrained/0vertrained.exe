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

  it("explains sets this week on demand and exposes each mark to assistive tech", () => {
    wrap(<MuscleVolumeSection data={volumeData} />);
    const guide = screen.getByRole("button", { name: "How to read sets this week" });
    expect(guide.getAttribute("aria-expanded")).toBe("false");
    // A full-height control: the button class carries the 44 px target.
    expect(guide.classList.contains("btn")).toBe(true);
    fireEvent.click(guide);
    expect(guide.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Hard set", { selector: "strong" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /chest: 6 hard sets this week, below range\. Your range is \d+ to \d+ sets/i })).toBeTruthy();
    // The same numbers are readable as a table.
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getByRole("table", { name: "Sets this week by muscle" })).toBeTruthy();
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
