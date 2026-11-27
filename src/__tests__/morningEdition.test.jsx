// src/__tests__/morningEdition.test.jsx
// @vitest-environment jsdom
// Data flow for the Morning Edition and its chart. RecoveryView's mounted
// tests cover the visual reading order, fresh evidence, and explanations.
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
