// Broadsheet shell invariants (static, source-level — the house
// pattern for layout contracts). Pins the three properties the desktop plan
// promised: (1) the tier exists and is exactly 1440; (2) below the tier every
// broadsheet wrapper is display:contents, so mobile/desktop-narrow layout is
// byte-identical to V14; (3) Today's three columns exist with the mockup's
// exact recipe and the section inventory is complete.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BROADSHEET_QUERY, DESKTOP_QUERY } from "../ui/useMediaQuery";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

describe("broadsheet shell (V15.0)", () => {
  it("defines the tier at exactly 1440px, above the existing desktop tier", () => {
    expect(BROADSHEET_QUERY).toBe("(min-width: 1440px)");
    expect(DESKTOP_QUERY).toBe("(min-width: 1024px)");
  });

  it("TodayTab composes the three mockup columns with a contents fallback", () => {
    const src = read("src/TodayTab.jsx");
    for (const id of ["decision-rail", "session-ledger", "telemetry"]) {
      expect(src).toContain(`data-section="${id}"`);
    }
    expect(src).toContain('gridTemplateColumns: "var(--ovt-rail-m) 1fr var(--ovt-rail-s)"');
    // The same regions are present when the medium or wide grid opens.
    expect((src.match(/className="today-rail"/g) || []).length).toBe(2);
    expect(read("src/ledger.css")).toMatch(/\.today-rail \{ display: contents; \}/);
    expect(src).toMatch(/data-section="session-ledger"[^>]*aria-labelledby="today-plan"/);
  });

  it("the top bar carries the drawn mark, and no streak", () => {
    const src = read("src/AppHeader.jsx");
    expect(src).toContain("<Wordmark ");
    expect(src).not.toMatch(/aria-hidden="true">θ</); // never a font glyph
    // The mark is drawn, so it does not depend on a typeface having a theta.
    const kit = read("src/ui/ledger.jsx");
    expect(kit).toMatch(/<ellipse cx="12" cy="12" rx="6\.5" ry="9\.5" \/>/);
    expect(kit).toContain('translate="no"');
    // A streak is a fact on Progress, never chrome that follows you around.
    expect(src).not.toMatch(/Streak \{/);
  });

  it("V15.1 · Recovery composes the spread: the call, the figures, the audit", () => {
    const src = read("src/RecoveryView.jsx");
    for (const id of ["rec-verdict", "rec-plates", "rec-audit"]) {
      expect(src).toContain(`data-section="${id}"`);
    }
    expect(src).toContain('gridTemplateColumns: "var(--ovt-rail-m) minmax(0, 1fr) var(--ovt-rail-s)"');
    // A phone reads the same three parts in one column, in the same order.
    expect(src).toMatch(/\{head\}\s*\{figures\}\s*\{audit\}/);
  });

  it("V15.1 · Fuel docks Log food on the right at the tier; on a phone it is its own screen", () => {
    const src = read("src/FuelTab.jsx");
    expect(src).toContain('data-section="fuel-main"');
    expect(src).toContain('data-section="fuel-dock"');
    expect(src).toContain("{isBroadsheet && (\n          <section data-section=\"fuel-dock\"");
    expect(src).toContain('{!isBroadsheet && <button type="button" className="btn btn-p btn-b" onClick={() => setFuelView("log")}>Log food</button>}');
    expect(src).toContain('gridTemplateColumns: "1fr var(--ovt-rail-s)"');
  });

  it("V18.1.1 · Today keeps only non-duplicative broadsheet telemetry", () => {
    const src = read("src/TodayTab.jsx");
    for (const plate of ["load-model", "wearable-load"]) {
      expect(src).toContain(`data-plate="${plate}"`);
    }
    expect(src).not.toContain('data-plate="fuel-remaining"');
    expect(src).not.toContain('data-plate="tomorrow-outlook"');
    expect(read("src/TodayCall.jsx")).toContain('data-ui="today-command-center"');
    // Gated on the tier and never on a past-day log.
    expect(src).toContain("{isBroadsheet && !isLoggingPast && (<>");
  });

  it("V16.3 · rail tokens exist and no rogue rail widths remain", () => {
    const css = read("src/index.css");
    expect(css).toContain("--ovt-rail-s: 440px");
    expect(css).toContain("--ovt-rail-m: 480px");
    for (const f of ["src/TodayTab.jsx", "src/RecoveryView.jsx", "src/FuelTab.jsx", "src/ProgressTab.jsx"]) {
      const src = read(f);
      expect(src).not.toMatch(/gridTemplateColumns: "4[468]0px 1fr/);
      expect(src).not.toMatch(/1fr 460px/);
    }
  });

  it("V18.0 · session desktop composes queue and rail around the current-set workspace", () => {
    const src = read("src/SessionMode.jsx");
    expect(src).toContain('data-section="session-queue"');
    expect(src).toContain('data-section="session-rail"');
    expect(src).toContain('gridTemplateColumns: "340px minmax(0, 1fr) 380px"');
    // Only the queue docks in a medium window. The detail rail stays wide-only.
    expect(src).toMatch(/\{dockQueue && \(\s*<aside data-section="session-queue"/);
    expect(src).toMatch(/\{isBroadsheet && \(\s*<aside data-section="session-rail"/);
    // On a phone the same detail is one tap away: exercise options and the queue are sheets.
    expect(src).toContain('setSheet("options")');
    expect(src).toContain('setSheet("queue")');
    expect(src).toContain("<CurrentSetComposer");
  });

  it("V15.3 · palette, two-pane settings, and the coach slide-over exist at the tier", () => {
    expect(read("src/ui/CommandPalette.jsx")).toContain('data-section="command-palette"');
    const app = read("src/App.jsx");
    expect(app).toContain('e.key.toLowerCase() === "k"');
    expect(app).toContain("onAction={handleQuickAction}");
    const settings = read("src/SettingsScreen.jsx");
    // Settings is one reading column at every width, like Profile: a page
    // of targets, cues and theme with its own screens behind rows.
    expect(settings).toContain('<div ref={shellRef} className="shell" data-screen="settings" style={{ maxWidth: "var(--ovt-content-width)" }}>');
    expect(settings).not.toMatch(/settings-nav|settings-pane/);
    const coach = read("src/Coach.jsx");
    expect(coach).toContain("...(isBroadsheet");
    expect(coach).toContain('{ width: 480, maxWidth: "40vw"');
  });

  it("V15.2 · every Progress screen composes its own spread at the tier", () => {
    const src = read("src/ProgressTab.jsx");
    for (const id of ["ov-verdict", "ov-plates", "ov-trends"]) {
      expect(src).toContain(`data-section="${id}"`);
    }
    // The Block left Progress for Train and took its spread with it: the
    // week it is and the suggestion on the rail, every week and the settings
    // in the wide column.
    const block = read("src/BlockScreen.jsx");
    for (const id of ["prog-rail", "prog-table"]) {
      expect(block).toContain(`data-section="${id}"`);
      expect(src).not.toContain(`data-section="${id}"`);
    }
    expect(block).toContain('gridTemplateColumns: "var(--ovt-rail-m) minmax(0, 1fr)"');
    // Progress keeps one read-only row about the block; it saves nothing.
    expect(src).not.toMatch(/writeStoredPeriodization|buildNextBlockSettings|legacy-screen/);
    expect(src).toContain("onClick={() => onOpenBlock?.()}");
    // A trend screen is one column on a phone and two halves side by side at the tier.
    expect(src).toContain("const [first, second] = screens[subView];");
    expect(src).toContain('gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 48');
    // History docks the day beside the list at the tier and takes the screen on a phone.
    const history = read("src/ProgressHistory.jsx");
    for (const id of ["hist-master", "hist-detail", "hist-detail-hint", "day-detail"]) {
      expect(history).toContain(`data-section="${id}"`);
    }
    expect(history).toContain("if (selectedDay && !isBroadsheet) return");
    expect(history).toContain('gridTemplateColumns: "var(--ovt-rail-m) minmax(0, 1fr)"');
  });

  it("a screen without a spread stays a centered reading column at the tier", () => {
    const src = read("src/App.jsx");
    // Screens that compose their own spread take the shell width; Profile
    // has none and keeps the reading column.
    expect(src).toContain('<div className={!accountUnavailable && loaded ? "tab-screen" : "legacy-screen"} style={isBroadsheet ? { maxWidth: "var(--ovt-content-width)" } : undefined}>');
    expect(read("src/ledger.css")).toMatch(/\.legacy-screen \{[^}]*max-width: var\(--ovt-shell-width, var\(--ovt-content-width\)\)/);
  });
});
