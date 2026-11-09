// V3.0 Whoop Display Cards — render + safety tests.
//
// These render the display-only cards to static markup (wrapped in the theme
// provider) and assert: they render with and without data, they never throw on
// null / undefined / partial fields, they carry a "Source: Whoop" label, and
// they contain no algorithm-blending language. Also covers the getWhoopSyncCounts
// shape and static assertions on the new server endpoint / sync ?days= param.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "../theme";
import {
  WhoopRecoveryCard,
  WhoopSleepCard,
  WhoopStrainCard,
  WhoopSourceSummary,
  getWhoopSyncCounts,
} from "../whoop";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

// Render a component inside the ThemeProvider and return the markup string.
function render(Component, props) {
  return renderToStaticMarkup(
    h(ThemeProvider, { themeId: "whitepaperDark" }, h(Component, props))
  );
}

// Language that would imply Whoop feeds the recovery algorithm. The cards must
// never contain any of these — they are display-only.
const BLENDING_TERMS = [
  "blend",
  "feeds the recovery",
  "adjusts the recovery",
  "recovery algorithm input",
  "contributes to recovery score",
];

function assertNoBlendingLanguage(markup) {
  const lower = markup.toLowerCase();
  for (const term of BLENDING_TERMS) {
    expect(lower).not.toContain(term);
  }
}

// Fixtures
const recovery = { date: "2026-07-01", recoveryScore: 67, hrvRmssd: 42.3, rhr: 55, spo2: 96.1, skinTempC: 33.4, calibrating: false };
const sleep = { date: "2026-06-30", inBedMin: 480, asleepMin: 450, efficiencyPct: 93.7, respiratoryRate: 15.4 };
const cycle = { date: "2026-07-01", strain: 12.4, avgHr: 70, maxHr: 165, kilojoule: 9000 };
const workouts = [{ date: "2026-07-01", id: "w1", strain: 9.1, avgHr: 130, maxHr: 172 }];

// WhoopRecoveryCard
describe("WhoopRecoveryCard", () => {
  test("renders with data, showing the score and source label", () => {
    const markup = render(WhoopRecoveryCard, { recovery, date: "2026-07-01" });
    expect(markup).toContain("67");
    expect(markup).toContain("Source: Whoop");
    expect(markup).toMatch(/scored/i);
    assertNoBlendingLanguage(markup);
  });

  test("renders a graceful note without data (no throw)", () => {
    const markup = render(WhoopRecoveryCard, { recovery: null });
    expect(markup).toContain("Source: Whoop");
    expect(markup).toMatch(/not available/i);
    assertNoBlendingLanguage(markup);
  });

  test("tolerates partial / undefined fields", () => {
    expect(() => render(WhoopRecoveryCard, { recovery: { recoveryScore: 40 } })).not.toThrow();
    expect(() => render(WhoopRecoveryCard, {})).not.toThrow();
    expect(() => render(WhoopRecoveryCard, { recovery: undefined })).not.toThrow();
  });
});

// WhoopSleepCard
describe("WhoopSleepCard", () => {
  test("renders with data + source label", () => {
    const markup = render(WhoopSleepCard, { sleep, date: "2026-06-30" });
    expect(markup).toContain("Source: Whoop");
    expect(markup).toMatch(/efficiency/i);
    assertNoBlendingLanguage(markup);
  });

  test("renders a graceful note without data", () => {
    const markup = render(WhoopSleepCard, { sleep: null });
    expect(markup).toContain("Source: Whoop");
    expect(markup).toMatch(/not available/i);
  });

  test("tolerates partial / undefined fields", () => {
    expect(() => render(WhoopSleepCard, { sleep: { asleepMin: 400 } })).not.toThrow();
    expect(() => render(WhoopSleepCard, {})).not.toThrow();
  });
});

// WhoopStrainCard
describe("WhoopStrainCard", () => {
  test("renders with data + source label + picks the top workout", () => {
    const markup = render(WhoopStrainCard, { cycle, workouts, date: "2026-07-01" });
    expect(markup).toContain("Source: Whoop");
    expect(markup).toMatch(/strain/i);
    assertNoBlendingLanguage(markup);
  });

  test("renders a graceful note without data", () => {
    const markup = render(WhoopStrainCard, { cycle: null, workouts: [] });
    expect(markup).toContain("Source: Whoop");
    expect(markup).toMatch(/not available/i);
  });

  test("tolerates null cycle, empty / undefined workouts", () => {
    expect(() => render(WhoopStrainCard, { cycle: null, workouts: null })).not.toThrow();
    expect(() => render(WhoopStrainCard, {})).not.toThrow();
    expect(() => render(WhoopStrainCard, { cycle: {}, workouts: [null, undefined] })).not.toThrow();
  });
});

// WhoopSourceSummary
describe("WhoopSourceSummary", () => {
  test("shows the three sources and their connection status", () => {
    const markup = render(WhoopSourceSummary, { ouraConnected: true, whoopConnected: true, manual: true });
    expect(markup).toContain("Oura");
    expect(markup).toContain("Whoop");
    expect(markup).toContain("Manual");
    expect(markup).toMatch(/connected/i);
  });

  test("distinguishes off sources and never shows raw scores", () => {
    const markup = render(WhoopSourceSummary, { ouraConnected: false, whoopConnected: true, manual: false });
    expect(markup).toContain("Whoop");
    expect(markup).toMatch(/off/i);
    // Presence bar only — no numeric score should leak in.
    expect(markup).not.toMatch(/\/100/);
    assertNoBlendingLanguage(markup);
  });

  test("renders with all defaults (no props) without throwing", () => {
    expect(() => render(WhoopSourceSummary, {})).not.toThrow();
  });
});

// getWhoopSyncCounts shape
describe("getWhoopSyncCounts", () => {
  test("returns the expected stable shape", async () => {
    const counts = await getWhoopSyncCounts();
    expect(counts).toEqual(
      expect.objectContaining({
        cycle: expect.any(Number),
        sleep: expect.any(Number),
        recovery: expect.any(Number),
        workout: expect.any(Number),
      })
    );
    expect(counts).toHaveProperty("lastSynced");
    expect(counts).toHaveProperty("latestDate");
  });
});

// Static server assertions
describe("V2.9.2 server surface", () => {
  const fnSrc = read("netlify/functions/whoop-auth.js");

  test("declares the /api/whoop/counts endpoint", () => {
    expect(fnSrc).toContain("/api/whoop/counts");
    expect(fnSrc).toMatch(/function handleCounts/);
  });

  test("sync accepts an optional ?days= backfill window, clamped server-side", () => {
    expect(fnSrc).toMatch(/searchParams\.get\(["']days["']\)/);
    expect(fnSrc).toMatch(/MAX_SYNC_DAYS/);
  });

  test("counts endpoint never selects the raw payload column", () => {
    const countsFn = fnSrc.slice(fnSrc.indexOf("async function handleCounts"));
    expect(countsFn).toContain("select=date,data_type,synced_at");
    expect(countsFn).not.toMatch(/select=[^"'`]*payload/);
  });
});
