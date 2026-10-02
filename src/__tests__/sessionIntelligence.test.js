import { describe, it, expect } from "vitest";
import { getLastPerformance, buildProgressionHint, calcPlateMath, suggestRestSeconds } from "../sessionIntelligence";

const day = (sets) => ({ workout: { exercises: { "Bench Press": { sets } } } });
const done = (weight, reps) => ({ weight: String(weight), reps: String(reps), done: true });

describe("getLastPerformance", () => {
  it("finds the most recent prior day with completed weighted sets", () => {
    const data = {
      "2026-06-28": day([done(185, 8), done(185, 8), done(185, 7)]),
      "2026-06-30": day([done(185, 8), done(185, 8), done(185, 8)]),
      "2026-07-02": day([{ weight: "", reps: "8", done: false }]),
    };
    const last = getLastPerformance(data, "Bench Press", "2026-07-02");
    expect(last.date).toBe("2026-06-30");
    expect(last.weight).toBe(185);
    expect(last.label).toBe("185×8/8/8");
  });

  it("excludes today and returns null with no history", () => {
    const data = { "2026-07-02": day([done(185, 8)]) };
    expect(getLastPerformance(data, "Bench Press", "2026-07-02")).toBeNull();
    expect(getLastPerformance({}, "Bench Press", "2026-07-02")).toBeNull();
  });

  it("ignores incomplete or weightless sets", () => {
    const data = {
      "2026-06-30": day([{ weight: "185", reps: "8", done: false }, { weight: "", reps: "8", done: true }]),
    };
    expect(getLastPerformance(data, "Bench Press", "2026-07-02")).toBeNull();
  });
});

describe("buildProgressionHint", () => {
  const exercise = { name: "Bench Press", sets: 3, reps: 8 };

  it("suggests +5 upper-body when all target reps were hit", () => {
    const last = { weight: 185, reps: [8, 8, 8], setsCompleted: 3, label: "185×8/8/8" };
    const hint = buildProgressionHint({ last, exercise });
    expect(hint.kind).toBe("load");
    expect(hint.suggestedWeight).toBe(190);
  });

  it("suggests +10 for lower-body movements", () => {
    const last = { weight: 315, reps: [5, 5, 5], setsCompleted: 3, label: "315×5/5/5" };
    const hint = buildProgressionHint({ last, exercise: { name: "Back Squat", sets: 3, reps: 5 } });
    expect(hint.suggestedWeight).toBe(325);
  });

  it("suggests repeating the weight when reps fell short", () => {
    const last = { weight: 185, reps: [8, 8, 6], setsCompleted: 3, label: "185×8/8/6" };
    const hint = buildProgressionHint({ last, exercise });
    expect(hint.kind).toBe("reps");
    expect(hint.suggestedWeight).toBe(185);
  });

  it("returns null without history", () => {
    expect(buildProgressionHint({ last: null, exercise })).toBeNull();
  });
});

describe("calcPlateMath", () => {
  it("computes standard per-side loads", () => {
    expect(calcPlateMath(225).perSide).toEqual([45, 45]);
    expect(calcPlateMath(190).perSide).toEqual([45, 25, 2.5]);
    expect(calcPlateMath(135).perSide).toEqual([45]);
  });
  it("handles the empty bar and invalid targets", () => {
    expect(calcPlateMath(45).label).toBe("empty bar");
    expect(calcPlateMath(30)).toBeNull();
    expect(calcPlateMath("abc")).toBeNull();
  });
  it("flags unloadable remainders", () => {
    const r = calcPlateMath(137); // 1 lb/side — not loadable in 2.5 steps
    expect(r.remainder).toBeGreaterThan(0);
  });
});

describe("suggestRestSeconds", () => {
  it("gives heavy compounds the longest rest", () => {
    expect(suggestRestSeconds({ name: "Back Squat", reps: 5 })).toBe(180);
    expect(suggestRestSeconds({ name: "Bench Press", reps: 10 })).toBe(120);
    expect(suggestRestSeconds({ name: "Lateral Raise", reps: 15 })).toBe(90);
  });
});
