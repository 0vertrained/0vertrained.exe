// @vitest-environment jsdom
// Pays the mounted-smoke debt from V15.3 (palette, two-pane) and pins
// the U-series behaviors. Session's spread keeps static guards — its ten
// required props make a meaningful mount a fixture project, noted honestly.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { CommandPalette } from "../ui/CommandPalette";
import { SettingsScreen } from "../SettingsScreen";
import { FormCheck } from "../FormCheck";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

function forceMatchMedia(matches) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query) => ({
    matches, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

describe("V16.2 surfaces (mounted)", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("palette: number keys fire actions, Escape closes", () => {
    forceMatchMedia(true);
    const onAction = vi.fn(); const onClose = vi.fn();
    render(
      <ThemeProvider>
        <CommandPalette open actions={[{ key: "workout", label: "Log workout", sub: "" }]} tabs={["Today"]} onAction={onAction} onClose={onClose} onNavigate={() => {}} />
      </ThemeProvider>
    );
    fireEvent.keyDown(window, { key: "1" });
    expect(onAction).toHaveBeenCalledWith("workout");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("V16.4 · form workspace mounts split at the tier with the findings hint", () => {
    forceMatchMedia(true);
    const { container } = render(<ThemeProvider><FormCheck /></ThemeProvider>);
    expect(container.querySelector('[data-section="form-stage"]')).toBeTruthy();
    expect(container.querySelector('[data-section="form-results-hint"]')).toBeTruthy();
  });

  it("settings mounts as a two-pane at the tier", () => {
    forceMatchMedia(true);
    const { container } = render(
      <ThemeProvider>
        <SettingsScreen settings={{ supplements: [], goals: {}, macroTargets: {} }} onSave={() => {}} onClose={() => {}} busy={false} onThemeChange={() => {}} currentTheme="whitepaperLight" />
      </ThemeProvider>
    );
    expect(container.querySelector('[data-section="settings-nav"]')).toBeTruthy();
    expect(container.querySelector('[data-section="settings-pane"]')).toBeTruthy();
  });
});

describe("V16.2 static pins", () => {
  it("U2–U5: tier fallbacks, sticky masthead, one desktop idiom, keyboard access", () => {
    const fuel = read("src/FuelTab.jsx");
    expect(fuel).toContain(': isBroadsheet ? { maxWidth: "var(--ovt-content-width)"');
    expect(read("src/ui/primitives.jsx")).toContain('...(isBroadsheet ? { maxWidth: "var(--ovt-content-width)"');
    expect(read("src/AppHeader.jsx")).toContain('position: "sticky", top: 0');
    const app = read("src/App.jsx");
    expect(app).toContain("isBroadsheet ? setPaletteOpen(true) : setSheetOpen(true)");
    const prog = read("src/ProgressTab.jsx");
    expect(prog).toContain('role={isBroadsheet ? "button" : undefined}');
    expect(read("src/Coach.jsx")).toContain('e.key === "Escape"');
    expect(read("src/RecoveryDashboard.jsx")).toContain('"Insufficient data — no wearable signals reported"');
  });
});
