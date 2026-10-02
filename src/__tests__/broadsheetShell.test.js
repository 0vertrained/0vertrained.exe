// V15.0 · Broadsheet shell invariants (static, source-level — the house
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
    // Every broadsheet style branches to display:contents below the tier.
    const wrappers = src.match(/isBroadsheet \? \{[^}]+\} : \{ display: "contents" \}/g) || [];
    expect(wrappers.length).toBeGreaterThanOrEqual(4); // container + 3 sections
    // The session ledger opens by default on the broadsheet.
    expect(src).toContain("defaultOpen={workoutStarted || isBroadsheet}");
  });

  it("the masthead carries the outlined wordmark theta and the context strip", () => {
    const src = read("src/AppHeader.jsx");
    expect(src).toContain("<WordmarkTheta />");
    expect(src).not.toMatch(/aria-hidden="true">θ</); // the fallback-serif glyph is gone
    // V15.1.1 · calcStreak returns { count, active } — rendering the object
    // was React #31 in prod. The strip must render the COUNT.
    expect(src).toContain("Streak {calcStreak(allData || {}).count} days");
    expect(src).toContain('Logging: {logDate || "Today"}');
  });

  it("the wordmark glyph is an embedded outline, not a font dependency", () => {
    const src = read("src/ui/WordmarkTheta.jsx");
    expect(src).toContain('fill="currentColor"');
    expect(src).toMatch(/d="M[0-9]/);
    expect(src).not.toMatch(/font-family|fontFamily/);
  });

  it("V15.1 · Recovery composes the spread while mobile keeps the technical-details fold", () => {
    const src = read("src/RecoveryDashboard.jsx");
    for (const id of ["rec-verdict", "rec-plates", "rec-audit"]) {
      expect(src).toContain(`data-section="${id}"`);
    }
    expect(src).toContain('gridTemplateColumns: "var(--ovt-rail-m) 1fr var(--ovt-rail-s)"');
    // The mobile branch preserves the V13 fold exactly…
    expect(src).toMatch(/\{blkTechnicaldetailsdisclosure\}\{techOpen && \(<>/);
    // …and the broadsheet never renders the fold button (blocks are always visible).
    const broadsheetBranch = src.slice(src.indexOf('data-section="rec-verdict"'), src.indexOf(") : (<>"));
    expect(broadsheetBranch).not.toContain("blkTechnicaldetailsdisclosure");
  });

  it("V15.1 · Fuel docks the ledger + search on the right, open by default at the tier", () => {
    const src = read("src/FuelTab.jsx");
    expect(src).toContain('data-section="fuel-main"');
    expect(src).toContain('data-section="fuel-dock"');
    expect(src).toContain("{(showLedger || isBroadsheet) && (<>");
    expect(src).toContain("{!isBroadsheet && (<div"); // the fold toggle hides when docked
    expect(src).toContain('gridTemplateColumns: "1fr var(--ovt-rail-s)"');
  });

  it("V18.1.1 · Today keeps only non-duplicative broadsheet telemetry", () => {
    const src = read("src/TodayTab.jsx");
    for (const plate of ["load-model", "wearable-load"]) {
      expect(src).toContain(`data-plate="${plate}"`);
    }
    expect(src).not.toContain('data-plate="fuel-remaining"');
    expect(src).not.toContain('data-plate="tomorrow-outlook"');
    expect(read("src/PhysiqueOSPanel.jsx")).toContain('data-ui="today-command-center"');
    // Gated on the tier and never on a past-day log.
    expect(src).toContain("{isBroadsheet && !isLoggingPast && (<>");
  });

  it("V16.3 · rail tokens exist and no rogue rail widths remain", () => {
    const css = read("src/index.css");
    expect(css).toContain("--ovt-rail-s: 440px");
    expect(css).toContain("--ovt-rail-m: 480px");
    for (const f of ["src/TodayTab.jsx", "src/RecoveryDashboard.jsx", "src/FuelTab.jsx", "src/ProgressTab.jsx"]) {
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
    // Both asides are tier-gated null on mobile; the wrapper is contents.
    expect((src.match(/\{isBroadsheet && \(\s*<aside/g) || []).length).toBe(2);
    expect(src).toContain('{ display: "contents" }');
    // Mobile intelligence folds remain available in Set Flow.
    expect(src).toContain("setRampOpen((value) => !value)");
    expect(src).toContain("setSubsOpen((value) => !value)");
    expect(src).toContain("<CurrentSetComposer");
  });

  it("V15.3 · palette, two-pane settings, and the coach slide-over exist at the tier", () => {
    expect(read("src/ui/CommandPalette.jsx")).toContain('data-section="command-palette"');
    const app = read("src/App.jsx");
    expect(app).toContain('e.key.toLowerCase() === "k"');
    expect(app).toContain("onAction={handleQuickAction}");
    const settings = read("src/SettingsScreen.jsx");
    expect(settings).toContain('data-section="settings-nav"');
    expect(settings).toContain('data-section="settings-pane"');
    expect(settings).toContain('gridTemplateColumns: "300px 1fr"');
    const coach = read("src/Coach.jsx");
    expect(coach).toContain("...(isBroadsheet");
    expect(coach).toContain('{ width: 480, maxWidth: "40vw"');
  });

  it("V15.2 · every Progress sub-view composes its spread with a contents fallback", () => {
    const src = read("src/ProgressTab.jsx");
    for (const id of ["ov-verdict", "ov-plates", "ov-trends", "prog-rail", "prog-table", "form-ledger", "form-trends", "hist-master", "hist-detail"]) {
      expect(src).toContain(`data-section="${id}"`);
    }
    // Both History lenses share one day-detail panel; mobile Entries keeps its
    // full-screen takeover; the FORM badge is a view-timestamp, tier-only.
    expect(src).toContain("if (selectedDay && !isBroadsheet) return dayDetailPanel;");
    expect((src.match(/\{dayDetailPanel \|\| dayDetailHint\}/g) || []).length).toBe(2);
    // V16.4 · the planning fold is mobile chrome; the tier renders unfolded.
    expect(src).toContain("const ovFiguresGroup = (<>");
    const tierBranch = src.slice(src.indexOf("{isBroadsheet ? (\n        <Suspense"), src.indexOf(") : (<>", src.indexOf("{isBroadsheet ? (\n        <Suspense")));
    expect(tierBranch).not.toContain("DisclosureBlock");
    expect(src).toContain('t.key === "form" && isBroadsheet && formBadge > 0');
    expect(src).toContain('localStorage.setItem("ovt-form-viewed-at"');
  });

  it("tabs without a broadsheet spread stay a centered reading column at the tier", () => {
    const src = read("src/App.jsx");
    // V15.1 · Today, Fuel, and Recovery now compose their own spreads; the
    // remainder (Progress) centers at 760px until V15.2.
    expect(src).toContain('isBroadsheet && !["Today", "Fuel", "Recovery", "Progress"].includes(tab) ? { maxWidth: "var(--ovt-content-width)"');
    expect(src).toContain('{ display: "contents" }');
  });
});
