import { describe, it, expect, beforeEach } from "vitest";
import { effectiveE1RM, buildProgressionHint } from "../sessionIntelligence";
import { buildE1RMSeries, detectStall, buildLiftIntelligence } from "../e1rmTrend";
import { buildWeeklyMuscleVolume, buildMuscleRecency } from "../muscleVolume";
import { readExerciseNote, writeExerciseNote, readSupersetPref, writeSupersetPref } from "../liftLogPrefs";

// ─── RIR-effective e1RM ───────────────────────────────────────────────────────
describe("effectiveE1RM", () => {
  it("adds logged RIR to reps (capped at 4)", () => {
    // 185×8 plain: 185*(1+8/30)=234 · @RIR2 → 10 effective: 185*(1+10/30)=247
    expect(effectiveE1RM(185, 8, "")).toBe(234);
    expect(effectiveE1RM(185, 8, "2")).toBe(247);
    expect(effectiveE1RM(185, 8, "9")).toBe(effectiveE1RM(185, 8, "4")); // cap
  });
});

// ─── RIR-aware progression hints ──────────────────────────────────────────────
describe("buildProgressionHint · RIR-aware", () => {
  const exercise = { name: "Bench Press", sets: 3, reps: 8 };
  const base = { weight: 185, reps: [8, 8, 8], setsCompleted: 3, label: "185×8/8/8" };

  it("doubles the jump when every set had 3+ in reserve", () => {
    const hint = buildProgressionHint({ last: { ...base, rirs: [3, 3, 4] }, exercise });
    expect(hint.suggestedWeight).toBe(195);
    expect(hint.text).toContain("in reserve");
  });

  it("holds the weight when reps were hit at RIR 0", () => {
    const hint = buildProgressionHint({ last: { ...base, rirs: [2, 1, 0] }, exercise });
    expect(hint.kind).toBe("reps");
    expect(hint.suggestedWeight).toBe(185);
  });

  it("keeps the plain +5 with no/partial RIR logging (pre-V12 behavior)", () => {
    expect(buildProgressionHint({ last: { ...base, rirs: [null, null, null] }, exercise }).suggestedWeight).toBe(190);
    expect(buildProgressionHint({ last: { ...base, rirs: [3, null, 3] }, exercise }).suggestedWeight).toBe(190);
  });
});

// ─── e1RM series + stall detection ────────────────────────────────────────────
const dayFor = (weight, reps, extra = {}) => ({
  workout: { exercises: { "Bench Press": { sets: [{ weight: String(weight), reps: String(reps), done: true, ...extra }] } } },
});

function seriesFixture(weights) {
  const data = {};
  weights.forEach((w, i) => {
    const d = new Date("2026-05-01T12:00:00");
    d.setDate(d.getDate() + i * 3);
    data[d.toISOString().slice(0, 10)] = dayFor(w, 8);
  });
  return data;
}

describe("buildE1RMSeries", () => {
  it("takes the best straight set per day and excludes technique sets", () => {
    const data = {
      "2026-06-01": {
        workout: { exercises: { "Bench Press": { sets: [
          { weight: "185", reps: "8", done: true },
          { weight: "205", reps: "3", done: true, type: "straight" },
          { weight: "225", reps: "12", done: true, type: "drop" }, // excluded
          { weight: "245", reps: "5", done: false },               // not done
        ] } } },
      },
    };
    const series = buildE1RMSeries(data, "Bench Press");
    expect(series.length).toBe(1);
    // 185×8 → 234 beats 205×3 → 226; the 225×12 drop set (240) is excluded.
    expect(series[0].e1rm).toBe(234);
  });
});

describe("detectStall", () => {
  it("reports building below the session minimum", () => {
    expect(detectStall(seriesFixture([185, 185, 185]) && buildE1RMSeries(seriesFixture([185, 185, 185]), "Bench Press")).status).toBe("building");
  });

  it("classifies progressing / stalled / regressing", () => {
    const prog = buildE1RMSeries(seriesFixture([185, 185, 190, 190, 195, 195, 200, 205]), "Bench Press");
    expect(detectStall(prog).status).toBe("progressing");

    const flat = buildE1RMSeries(seriesFixture([200, 200, 200, 200, 200, 200, 200, 200]), "Bench Press");
    expect(detectStall(flat).status).toBe("stalled");

    const reg = buildE1RMSeries(seriesFixture([200, 200, 200, 200, 190, 185, 185, 185]), "Bench Press");
    expect(detectStall(reg).status).toBe("regressing");
  });
});

describe("buildLiftIntelligence", () => {
  it("ranks lifts by session count and attaches verdicts", () => {
    const data = seriesFixture([185, 190, 190, 195, 195, 200, 200, 205]);
    const r = buildLiftIntelligence(data);
    expect(r.ready).toBe(true);
    expect(r.lifts[0].name).toBe("Bench Press");
    expect(r.lifts[0].verdict.status).toBe("progressing");
    expect(r.lifts[0].current).toBeGreaterThan(0);
  });
});

// ─── Hard-set RIR exclusion + recency ─────────────────────────────────────────
describe("muscleVolume · V12 additions", () => {
  it("excludes completed sets logged at RIR 5+ from weekly volume", () => {
    const data = {
      "2026-06-22": {
        workout: { exercises: { "Bench Press": { sets: [
          { weight: "185", reps: "8", done: true, rir: "2" },
          { weight: "135", reps: "10", done: true, rir: "6" }, // warm-up by own report
          { weight: "185", reps: "8", done: true },            // unlogged RIR still counts
        ] } } },
      },
    };
    const [wk] = buildWeeklyMuscleVolume(data);
    expect(wk.muscles.chest).toBe(2);
  });

  it("builds days-since recency per muscle with primary/secondary distinction", () => {
    const data = {
      "2026-06-28": dayFor(185, 8), // bench: chest primary · triceps secondary
      "2026-06-30": { workout: { exercises: { "Barbell Row": { sets: [{ weight: "185", reps: "8", done: true }] } } } },
    };
    const rec = buildMuscleRecency(data, "2026-07-01");
    const chest = rec.find(r => r.key === "chest");
    const back = rec.find(r => r.key === "back");
    const quads = rec.find(r => r.key === "quads");
    expect(chest.daysSincePrimary).toBe(3);
    expect(chest.status).toBe("ready");
    expect(back.daysSincePrimary).toBe(1);
    expect(back.status).toBe("worked");
    expect(quads.status).toBe("untrained");
  });
});

// ─── liftLogPrefs ─────────────────────────────────────────────────────────────
describe("liftLogPrefs", () => {
  beforeEach(() => { try { localStorage.clear(); } catch {} });

  it("round-trips, trims, caps, and clears sticky notes", () => {
    expect(readExerciseNote("Bench Press")).toBe("");
    writeExerciseNote("Bench Press", "  seat 4 · elbows tucked  ");
    expect(readExerciseNote("Bench Press")).toBe("seat 4 · elbows tucked");
    writeExerciseNote("Bench Press", "x".repeat(500));
    expect(readExerciseNote("Bench Press").length).toBe(200);
    writeExerciseNote("Bench Press", "");
    expect(readExerciseNote("Bench Press")).toBe("");
  });

  it("remembers superset pairing per day name", () => {
    expect(readSupersetPref("Arms", "EZ Curl")).toBe(false);
    writeSupersetPref("Arms", "EZ Curl", true);
    expect(readSupersetPref("Arms", "EZ Curl")).toBe(true);
    expect(readSupersetPref("Push A", "EZ Curl")).toBe(false); // day-scoped
    writeSupersetPref("Arms", "EZ Curl", false);
    expect(readSupersetPref("Arms", "EZ Curl")).toBe(false);
  });
});
