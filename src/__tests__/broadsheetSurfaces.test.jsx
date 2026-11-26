// @vitest-environment jsdom
// Pays the mounted-smoke debt from V15.3 (palette, two-pane) and pins
// the U-series behaviors. Session's spread keeps static guards — its ten
// required props make a meaningful mount a fixture project, noted honestly.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { CommandPalette } from "../ui/CommandPalette";
import { SettingsScreen } from "../SettingsScreen";
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

  it("palette: number keys fire actions, each tab has its own letter, Escape closes", () => {
    forceMatchMedia(true);
    const onAction = vi.fn(); const onClose = vi.fn(); const onNavigate = vi.fn();
    render(
      <ThemeProvider>
        <CommandPalette open actions={[{ key: "workout", label: "Log workout", sub: "" }]} tabs={["Today", "Train", "Fuel", "Progress"]} onAction={onAction} onClose={onClose} onNavigate={onNavigate} />
      </ThemeProvider>
    );
    fireEvent.keyDown(window, { key: "1" });
    expect(onAction).toHaveBeenCalledWith("workout");
    fireEvent.keyDown(window, { key: "r" });
    expect(onNavigate).toHaveBeenLastCalledWith("Train");
    fireEvent.keyDown(window, { key: "t" });
    expect(onNavigate).toHaveBeenLastCalledWith("Today");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("settings mounts as one reading column at the tier", () => {
    forceMatchMedia(true);
    const { container } = render(
      <ThemeProvider>
        <SettingsScreen settings={{ supplements: [], goals: {}, macroTargets: {} }} onSave={() => {}} onClose={() => {}} busy={false} onThemeChange={() => {}} currentTheme="whitepaperLight" />
      </ThemeProvider>
    );
    const screen = container.querySelector('[data-screen="settings"]');
    expect(screen).toBeTruthy();
    expect(screen.style.maxWidth).toBe("var(--ovt-content-width)");
    expect(container.querySelector('[data-section="settings-nav"]')).toBeNull();
  });
});

describe("V16.2 static pins", () => {
  it("U2–U5: tier fallbacks, sticky masthead, one desktop idiom, keyboard access", () => {
    const fuel = read("src/FuelTab.jsx");
    expect(fuel).toContain('maxWidth: "var(--ovt-content-width)" }');
    expect(read("src/ui/primitives.jsx")).toContain('maxWidth: "var(--ovt-content-width)", margin: "0 auto"');
    // The desktop bar stays put while the page scrolls under it.
    expect(read("src/ledger.css")).toMatch(/\.dtop \{[^}]*position: sticky; top: 0;/);
    // Log opens the same sheet at every size; the palette has its own button and ⌘K.
    const app = read("src/App.jsx");
    expect(app).toContain("onQuickAction={() => setSheetOpen(true)} onOpenPalette={() => setPaletteOpen(true)}");
    // A timeline day opens from a real button at every size, not a div with a role.
    const history = read("src/ProgressHistory.jsx");
    expect(history).toContain('<button type="button" className="row" onClick={() => onOpen(group.date)}');
    expect(history).not.toContain('role={isBroadsheet');
    expect(read("src/Coach.jsx")).toContain('e.key === "Escape"');
    expect(read("src/RecoveryView.jsx")).toContain("Not enough data yet: no wearable signals have been reported.");
  });
});
