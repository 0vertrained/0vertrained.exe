// src/__tests__/morningEdition.test.jsx
// @vitest-environment jsdom
// Morning Edition surface. The dashboard's ten-required-props mount is
// a fixture project (per the V16.2 precedent, noted honestly) — the wiring and
// reading-order anatomy are pinned as source guards, and the pieces that mount
// cleanly (the trend chart's running average) are mounted for real. The engine behavior behind
// this surface is fully mounted in recoveryTrend.test.js / checkinMorning.test.js.
//
// The anatomy being protected (the UX contract):
//   check-in taps ABOVE the verdict (rate before the number can anchor you) →
//   state row with gated delta → resolver headline → evidence deck →
//   context line → divergence → limiter → explainer. Provisional ink until
//   the check-in completes; calibration never fakes a verdict.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LineChart } from "../sections/charts";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

afterEach(cleanup);

describe("V16.8 Morning Edition — dashboard anatomy (source guards)", () => {
  const src = read("src/RecoveryDashboard.jsx");
  const view = read("src/RecoveryView.jsx");

  it("the call leads with its sentence and the state of the last days; the check-in follows the reasons", () => {
    // The headline is the app's one call when there is one (sharedCall.js).
    const headlineAt = view.indexOf("{shared ? shared.headline : verdict.headline}");
    const stateAt = view.indexOf("{state && <p");
    expect(headlineAt).toBeGreaterThan(-1);
    expect(stateAt).toBeGreaterThan(headlineAt);
    // On the screen: the call, any alert, why, then the check-in with its way to Today.
    const order = ["{verdict && <Call ", "<Alerts ", "{verdict && <Why ", "<CheckinBanner "].map((token) => view.indexOf(token));
    expect(order.every((at) => at > -1), order.join(",")).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(view).toContain('data-testid="checkin-line"');
  });

  it("taps live on Today and write to the shared body fields through updateToday", () => {
    expect(read("src/MorningCheckin.jsx")).toContain("updateToday(`body.${row.field}`, String(value))");
    expect(src).not.toContain("CHECKIN_ROWS.map");
    expect(read("src/TodayTab.jsx")).toContain("<MorningCheckin body={bod} updateToday={updateToday} />");
  });

  it("the verdict is provisional (labelled, dimmed) until the check-in completes — and never blocked", () => {
    expect(view).toContain("!checkin.complete");
    expect(view).toContain('provisional ? "before check-in" : null');
    // Quieter ink for provisional/calibrating, not hidden content:
    expect(view).toContain('provisional || calibrating ? "t-ss c2" : "t-ss"');
  });

  it("evidence deck replaces score-restating copy, with the resolver deck as fallback", () => {
    expect(view).toContain("evidenceLines.length ? evidenceLines : [verdict.deck]");
  });

  it("divergence, schedule/recency context, and the plain-language explainer are present", () => {
    expect(view).toContain("divergenceNote(checkin, recovery?.score)");
    expect(view).toContain("Recently loaded:");
    expect(view).toContain("What does this mean?");
    expect(view).toContain("trend.meaning.why");
  });

  it("the check-in caution feeds the resolver; the score object is passed through untouched", () => {
    // Recovery and Today read the verdict through one function.
    expect(read("src/sharedCall.js")).toContain("checkin: checkinCaution");
    expect(src).toContain("} = deriveRecoveryVerdict({");
    expect(src).not.toMatch(/recovery\.score\s*[+-]=/);
  });

  it("trend state is computed in the data load and restored from the session cache", () => {
    // The load is its own module now, run by Recovery and once at app start.
    const load = read("src/recoveryLoad.js");
    expect(load).toContain("classifyRecoveryState({");
    expect(load).toContain("trend: trendState,");
    expect(src).toContain("const out = await loadRecoveryData(");
    expect(src).toContain("setTrend(out.snapshot?.trend ?? null);");
    expect(src).toContain("initialCache?.trend");
  });

  it("App passes todayKey/todayName and the way to Today's check-in to the Recovery tab", () => {
    const app = read("src/App.jsx");
    expect(app).toMatch(/RecoveryDashboard[^>]*todayKey=\{todayKey\}[^>]*todayName=\{todayName\}[^>]*onOpenCheckin=\{openCheckin\}/s);
  });

  it("the 35-day window feeds the chronic baseline while scoring pools stay at 15", () => {
    expect(read("src/recoveryLoad.js")).toContain("loadOuraData(35)");
    const engine = read("src/wearables/recoveryEngine.js");
    expect(engine).toContain(".slice(0, 15)");
  });
});

describe("V16.8 Morning Edition — trend with its running average (mounted)", () => {
  const daily = [82, 77, 88, 80, 88, 77, 81];
  const points = daily.map((value, i, arr) => {
    const win = arr.slice(Math.max(0, i - 2), i + 1);
    return { date: `2026-07-${String(8 + i).padStart(2, "0")}`, value, also: win.reduce((a, x) => a + x, 0) / win.length };
  });
  const yValues = (line) => line.getAttribute("points").split(" ").map((pair) => Number(pair.split(",")[1]));

  it("draws the running average as a dashed second line behind the days", () => {
    const { container } = render(<LineChart label="Recovery, last 7 days" points={points} second />);
    const lines = container.querySelectorAll("polyline");
    expect(lines.length).toBe(2);
    expect(lines[0].getAttribute("class")).toBe("ln2");
    expect(lines[1].getAttribute("class")).toBe("ln");
  });

  it("shares one scale across both lines, so they are honestly comparable", () => {
    const { container } = render(<LineChart label="Recovery, last 7 days" points={points} second />);
    const [average, days] = container.querySelectorAll("polyline");
    // The daily low (77) sits lower on the chart than the average's low.
    expect(Math.max(...yValues(days))).toBeGreaterThan(Math.max(...yValues(average)));
  });
});
