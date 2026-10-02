// src/__tests__/recoveryTrend.test.js
// ─────────────────────────────────────────────────────────────────────────────
// V16.8 · Morning Edition state machine. Pins: (1) calibration is honest and
// specific below 7 mornings; (2) each state's entry conditions; (3) the
// parasympathetic-saturation trap (elevated HRV + rising RHR under high load)
// classifies protective, not celebratory; (4) score deltas are gated on the
// user's own noise band so ordinary mornings read "steady"; (5) devices are
// never mixed in one series; (6) evidence is plain language (no z-scores).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  classifyRecoveryState, computeHrvTrend, gatedScoreDelta,
  ouraLnHrvSeries, whoopLnHrvSeries, TREND_MIN_DAYS,
} from "../wearables/recoveryTrend";

function day(dayKey, hrv, rhr) {
  return {
    sleep: { data: [{
      day: dayKey, type: "long_sleep",
      total_sleep_duration: 6.9 * 3600, time_in_bed: 7.4 * 3600,
      efficiency: 89, latency: 700,
      average_hrv: hrv, lowest_heart_rate: rhr, average_heart_rate: rhr + 6,
    }]},
    readiness: { data: [{ day: dayKey, score: 76, temperature_deviation: 0.05, contributors: {} }] },
  };
}

// Build N days ending 2026-07-30, oldest → newest arrays of [hrv, rhr].
function ouraFixture(pairs) {
  const oura = {};
  const start = new Date("2026-07-01T12:00:00");
  pairs.forEach(([hrv, rhr], i) => {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    oura[d] = day(d, hrv, rhr);
  });
  return oura;
}

const FLAT = Array.from({ length: 21 }, () => [70, 58]);

describe("V16.8 recovery trend — calibration honesty", () => {
  it("below 7 mornings → Calibrating, with the exact remaining count", () => {
    const oura = ouraFixture(FLAT.slice(0, 4));
    const t = classifyRecoveryState({ ouraData: oura });
    expect(t.state.key).toBe("calibrating");
    expect(t.evidence[0]).toMatch(/4 of 7 mornings/);
    expect(t.evidence[0]).toMatch(/3 more nights/);
  });

  it("zero history says how to start, not an error", () => {
    const t = classifyRecoveryState({ ouraData: {} });
    expect(t.state.key).toBe("calibrating");
    expect(t.evidence[0]).toMatch(/wear your device tonight/i);
  });

  it("7–13 mornings classifies but hedges with the early flag", () => {
    const oura = ouraFixture(FLAT.slice(0, 9));
    const t = classifyRecoveryState({ ouraData: oura });
    expect(t.state.key).not.toBe("calibrating");
    expect(t.early).toBe(true);
  });
});

describe("V16.8 recovery trend — states", () => {
  it("flat HRV, steady RHR, no load context → Steady/Fresh family", () => {
    const t = classifyRecoveryState({ ouraData: ouraFixture(FLAT) });
    expect(["steady", "fresh"]).toContain(t.state.key);
  });

  it("suppressed week + rising RHR → Deload advised, with both evidence lines", () => {
    const pairs = [...FLAT.slice(0, 14)];
    // A week suppressed ~12% with RHR climbing 58 → 63.
    [62, 62, 61, 62, 61, 62, 61].forEach((h, i) => pairs.push([h, 58 + i * 0.8]));
    const t = classifyRecoveryState({ ouraData: ouraFixture(pairs) });
    expect(t.state.key).toBe("deload");
    expect(t.evidence.join(" ")).toMatch(/below your normal range/i);
    expect(t.evidence.join(" ")).toMatch(/resting heart rate/i);
    expect(t.state.tone).toBe("act");
  });

  it("suppressed week alone (RHR flat) → Accumulating fatigue (watch, not act)", () => {
    const pairs = [...FLAT.slice(0, 14)];
    [62, 62, 61, 62, 61, 62, 61].forEach((h) => pairs.push([h, 58]));
    const t = classifyRecoveryState({ ouraData: ouraFixture(pairs) });
    expect(t.state.key).toBe("accumulating");
    expect(t.state.tone).toBe("watch");
  });

  it("in-band HRV under high load → Absorbing load", () => {
    const t = classifyRecoveryState({ ouraData: ouraFixture(FLAT), loadZone: "high_risk" });
    expect(t.state.key).toBe("absorbing");
    expect(t.evidence.join(" ")).toMatch(/absorbing the work/i);
  });

  it("parasympathetic saturation: HRV ABOVE range + rising RHR + high load → Deload, explained", () => {
    const pairs = [...FLAT.slice(0, 14)];
    [78, 79, 80, 80, 81, 82, 82].forEach((h, i) => pairs.push([h, 58 + i * 0.9]));
    const t = classifyRecoveryState({ ouraData: ouraFixture(pairs), loadZone: "overreaching" });
    expect(t.state.key).toBe("deload");
    expect(t.evidence.join(" ")).toMatch(/ABOVE your normal range/);
    expect(t.evidence.join(" ")).toMatch(/saturation/i);
  });

  it("elevated HRV with falling RHR and light load → Fresh", () => {
    const pairs = [...FLAT.slice(0, 14)];
    [76, 77, 77, 78, 78, 79, 79].forEach((h, i) => pairs.push([h, 58 - i * 0.5]));
    const t = classifyRecoveryState({ ouraData: ouraFixture(pairs), loadZone: "low" });
    expect(t.state.key).toBe("fresh");
  });

  it("evidence stays plain-language — never a z-score", () => {
    const pairs = [...FLAT.slice(0, 14)];
    [62, 62, 61, 62, 61, 62, 61].forEach((h) => pairs.push([h, 58]));
    const t = classifyRecoveryState({ ouraData: ouraFixture(pairs) });
    expect(t.evidence.join(" ")).not.toMatch(/z[- ]?score|z\s*=/i);
    expect(t.meaning.why).toMatch(/normal range/i);
  });
});

describe("V16.8 recovery trend — series and delta discipline", () => {
  it("devices never mix in one series; Whoop is the fallback when Oura is thin", () => {
    const oura = ouraFixture(FLAT.slice(0, 3)); // too thin
    const whoop = {};
    for (let i = 1; i <= 10; i++) {
      const d = `2026-07-${String(i).padStart(2, "0")}`;
      whoop[d] = { recovery: { score: { hrv_rmssd_milli: 72 } } };
    }
    const t = classifyRecoveryState({ ouraData: oura, whoopData: whoop });
    expect(t.source).toBe("whoop");
    expect(t.state.key).not.toBe("calibrating");
    // And with enough Oura, Oura wins even when Whoop also has history.
    const t2 = classifyRecoveryState({ ouraData: ouraFixture(FLAT), whoopData: whoop });
    expect(t2.source).toBe("oura");
    expect(ouraLnHrvSeries(ouraFixture(FLAT)).length).toBe(21);
    expect(whoopLnHrvSeries(whoop).length).toBe(10);
  });

  it("computeHrvTrend reports band position and % deviation", () => {
    const series = ouraLnHrvSeries(ouraFixture([...FLAT.slice(0, 14), [62, 58], [62, 58], [61, 58], [62, 58], [61, 58], [62, 58], [61, 58]]));
    const h = computeHrvTrend(series);
    expect(h.calibrating).toBe(false);
    expect(h.position).toBeLessThanOrEqual(-1);
    expect(h.deviationPct).toBeLessThan(-5);
  });

  it("score deltas are gated on the user's own noise: ±2 reads steady, a real drop reads down", () => {
    const hist = [82, 84, 81, 83, 82, 84].map((v, i) => ({ date: `2026-07-0${i + 1}`, value: v }));
    expect(gatedScoreDelta(84, hist).label).toBe("steady");
    expect(gatedScoreDelta(84, hist).arrow).toBe("→");
    const drop = gatedScoreDelta(71, hist);
    expect(drop.arrow).toBe("↘");
    expect(drop.label).toMatch(/down/);
    expect(gatedScoreDelta(80, []).label).toBe("steady"); // no history → no fake arrows
  });

  it("TREND_MIN_DAYS is the single source of the calibration threshold", () => {
    expect(TREND_MIN_DAYS).toBe(7);
  });
});
