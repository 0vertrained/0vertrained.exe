// src/__tests__/morningEdition.test.jsx
// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// V16.8 · Morning Edition surface. The dashboard's ten-required-props mount is
// a fixture project (per the V16.2 precedent, noted honestly) — the wiring and
// reading-order anatomy are pinned as source guards, and the pieces that mount
// cleanly (Sparkline overlay) are mounted for real. The engine behavior behind
// this surface is fully mounted in recoveryTrend.test.js / checkinMorning.test.js.
//
// The anatomy being protected (the UX contract):
//   check-in taps ABOVE the verdict (rate before the number can anchor you) →
//   state row with gated delta → resolver headline → evidence deck →
//   context line → divergence → limiter → explainer. Provisional ink until
//   the check-in completes; calibration never fakes a verdict.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { Sparkline } from "../whitepaper";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

afterEach(cleanup);

describe("V16.8 Morning Edition — dashboard anatomy (source guards)", () => {
  const src = read("src/RecoveryDashboard.jsx");

  it("check-in renders ABOVE the state row, which renders above the headline", () => {
    const checkinAt = src.indexOf("CHECKIN_ROWS.map((row)");
    const stateAt = src.indexOf("{stateName}");
    const headlineAt = src.indexOf("{verdict.headline}");
    expect(checkinAt).toBeGreaterThan(-1);
    expect(stateAt).toBeGreaterThan(checkinAt);
    expect(headlineAt).toBeGreaterThan(stateAt);
  });

  it("taps write to the shared body fields through updateToday", () => {
    expect(src).toContain("updateToday(`body.${row.field}`, String(opt.value))");
  });

  it("the verdict is provisional (labelled, dimmed) until the check-in completes — and never blocked", () => {
    expect(src).toContain("!checkin.complete");
    expect(src).toContain("· before check-in");
    // Dimmed ink for provisional/calibrating, not hidden content:
    expect(src).toMatch(/provisional \|\| calibrating \? C\.textDim : C\.text/);
  });

  it("evidence deck replaces score-restating copy, with the resolver deck as fallback", () => {
    expect(src).toContain("evidenceLines.length ? evidenceLines : [verdict.deck]");
  });

  it("divergence, schedule/recency context, and the plain-language explainer are present", () => {
    expect(src).toContain("divergenceNote(checkin, recovery?.score)");
    expect(src).toContain("Recently loaded:");
    expect(src).toContain("What does this mean?");
    expect(src).toContain("trend.meaning.why");
  });

  it("the check-in caution feeds the resolver; the score object is passed through untouched", () => {
    expect(src).toContain("checkin: checkinCaution");
    expect(src).not.toMatch(/recovery\.score\s*[+-]=/);
  });

  it("trend state is computed in the data effect and restored from the session cache", () => {
    expect(src).toContain("classifyRecoveryState({");
    expect(src).toContain("trend: trendState,");
    expect(src).toContain("initialCache?.trend");
  });

  it("App passes todayKey/todayName/updateToday to the Recovery tab", () => {
    const app = read("src/App.jsx");
    expect(app).toMatch(/RecoveryDashboard[^>]*todayKey=\{todayKey\}[^>]*todayName=\{todayName\}[^>]*updateToday=\{updateToday\}/s);
  });

  it("the 35-day window feeds the chronic baseline while scoring pools stay at 15", () => {
    expect(src).toContain("loadOuraData(35)");
    const engine = read("src/wearables/recoveryEngine.js");
    expect(engine).toContain(".slice(0, 15)");
  });
});

describe("V16.8 Morning Edition — sparkline overlay (mounted)", () => {
  const points = [
    { date: "2026-07-08", value: 82 }, { date: "2026-07-09", value: 77 },
    { date: "2026-07-10", value: 88 }, { date: "2026-07-11", value: 80 },
    { date: "2026-07-12", value: 88 }, { date: "2026-07-13", value: 77 },
    { date: "2026-07-14", value: 81 },
  ];
  const rolling = points.map((p, i, arr) => {
    const win = arr.slice(Math.max(0, i - 2), i + 1);
    return { date: p.date, value: win.reduce((a, x) => a + x.value, 0) / win.length };
  });

  it("draws two paths when overlayPoints are provided — trend behind daily", () => {
    const { container } = render(
      <ThemeProvider><Sparkline points={points} overlayPoints={rolling} width={260} height={44} label="7-day trend" /></ThemeProvider>
    );
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(2);
    // Overlay is the FIRST path (painted behind) and dashed.
    expect(paths[0].getAttribute("stroke-dasharray")).toBeTruthy();
    expect(paths[1].getAttribute("stroke-dasharray")).toBeFalsy();
  });

  it("shares one min/max scale across both series (lines are honestly comparable)", () => {
    // With a shared scale, the daily min (77) must touch lower than the
    // rolling min (~79.3): compare max Y coordinates of the two paths.
    const { container } = render(
      <ThemeProvider><Sparkline points={points} overlayPoints={rolling} width={260} height={44} /></ThemeProvider>
    );
    const yMax = (d) => Math.max(...[...d.matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1])));
    const [overlay, daily] = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(yMax(daily)).toBeGreaterThan(yMax(overlay));
  });

  it("renders single-series unchanged when no overlay is passed", () => {
    const { container } = render(
      <ThemeProvider><Sparkline points={points} width={260} height={44} /></ThemeProvider>
    );
    expect(container.querySelectorAll("path").length).toBe(1);
  });
});
