// src/__tests__/checkinMorning.test.js
// ─────────────────────────────────────────────────────────────────────────────
// V16.8 · Morning check-in. Pins the doctrine: taps land on the EXISTING 1–10
// body fields (one truth with TodayTab), caution-only at the resolver (a rough
// check-in demotes one step; a great one never raises), the score itself is
// never modified, and divergence between feel and metrics is said out loud in
// both directions — silence otherwise.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  CHECKIN_ROWS, readCheckin, checkinSeverity, checkinEvidenceLine,
  divergenceNote, selectedOption,
} from "../checkinMorning";
import { buildRecoveryVerdict } from "../recovery/verdictResolver";
import { parseManualRecovery } from "../manualRecovery";

describe("V16.8 check-in — reading the body fields", () => {
  it("writes land on the same fields manualRecovery parses (one source of truth)", () => {
    const body = { sleepQuality: 3, soreness: 8, stress: 5, energy: 6 };
    const c = readCheckin(body);
    expect(c.complete).toBe(true);
    expect(c.flags).toContain("slept_poorly");
    expect(c.flags).toContain("very_sore");
    const parsed = parseManualRecovery(body);
    expect(parsed.sleepQuality).toBe(3);
    expect(parsed.soreness).toBe(8);
  });

  it("numbers typed on Today snap to the nearest tap so both surfaces agree", () => {
    const sleepRow = CHECKIN_ROWS.find((r) => r.field === "sleepQuality");
    expect(selectedOption(sleepRow, 7).text).toBe("fine");   // 7 → nearest 6
    expect(selectedOption(sleepRow, 8).text).toBe("well");   // 8 → nearest 9
    expect(selectedOption(sleepRow, null)).toBe(null);
  });

  it("partial answers count honestly", () => {
    const c = readCheckin({ sleepQuality: 6 });
    expect(c.answered).toBe(1);
    expect(c.complete).toBe(false);
  });
});

describe("V16.8 check-in — severity and doctrine", () => {
  it("one rough answer nudges (severity 1); two independent rough signals move the call (2)", () => {
    expect(checkinSeverity(readCheckin({ sleepQuality: 3, soreness: 2, stress: 2, energy: 8 }))).toBe(1);
    expect(checkinSeverity(readCheckin({ sleepQuality: 3, soreness: 8, stress: 2, energy: 8 }))).toBe(2);
    expect(checkinSeverity(readCheckin({ sleepQuality: 9, soreness: 2, stress: 8, energy: 3 }))).toBe(1); // stress+energy pair = 1
    expect(checkinSeverity(readCheckin({ illnessOrInjury: true }))).toBe(2);
  });

  it("resolver: severity 2 demotes push → train with the check-in limiter named", () => {
    const base = { recommendation: { label: "Push", prescription: "PR attempts are allowed." }, recovery: { score: 90 } };
    const v = buildRecoveryVerdict({ ...base, checkin: { severity: 2, flags: ["slept_poorly", "very_sore"] } });
    expect(v.call).toBe("train");
    expect(v.demoted).toBe(true);
    expect(v.limiters.some((l) => l.key === "checkin")).toBe(true);
    expect(v.prescription).not.toMatch(/PR attempts/);
  });

  it("resolver: a great check-in never raises the call (caution-only)", () => {
    const low = { recommendation: { label: "Pull Back", prescription: "Keep it easy." }, recovery: { score: 48 } };
    const v = buildRecoveryVerdict({ ...low, checkin: { severity: 0, flags: [] } });
    expect(v.call).toBe("easy");
    expect(v.demoted).toBe(false);
  });

  it("resolver: illness flag floors the call at easy even from push", () => {
    const base = { recommendation: { label: "Push" }, recovery: { score: 92 } };
    const v = buildRecoveryVerdict({ ...base, checkin: { severity: 2, flags: ["illness_or_injury"] } });
    expect(["easy", "recover"]).toContain(v.call);
  });

  it("resolver: severity below 2 leaves the call untouched", () => {
    const base = { recommendation: { label: "Push" }, recovery: { score: 90 } };
    const v = buildRecoveryVerdict({ ...base, checkin: { severity: 1, flags: ["slept_poorly"] } });
    expect(v.call).toBe("push");
  });

  it("the composite score is never modified by the check-in", () => {
    const base = { recommendation: { label: "Push" }, recovery: { score: 90 } };
    buildRecoveryVerdict({ ...base, checkin: { severity: 3, flags: ["slept_poorly", "very_sore", "illness_or_injury"] } });
    // Input object untouched — nothing wrote an "adjusted" score back.
    expect(base.recovery.score).toBe(90);
    // And the same physiology without a check-in reports the raw number: the
    // check-in changed the CALL above, never the score.
    const clean = buildRecoveryVerdict(base);
    expect(clean.deck).toMatch(/90/);
  });

  it("cleared TodayTab inputs (empty strings) read as unanswered, never as zero", () => {
    const c = readCheckin({ sleepQuality: "", soreness: "", stress: "", energy: "" });
    expect(c.answered).toBe(0);
    expect(c.flags).toEqual([]);
  });
});

describe("V16.8 check-in — divergence transparency", () => {
  it("feel-bad + metrics-good says so; feel-good + metrics-bad says so; agreement stays silent", () => {
    const rough = readCheckin({ sleepQuality: 3, soreness: 8, stress: 5, energy: 6 });
    expect(divergenceNote(rough, 84)).toMatch(/feel rougher than your metrics/i);

    const great = readCheckin({ sleepQuality: 9, soreness: 2, stress: 2, energy: 9 });
    expect(divergenceNote(great, 45)).toMatch(/feel better than your metrics/i);

    expect(divergenceNote(great, 84)).toBe(null);
    expect(divergenceNote(rough, 40)).toBe(null);
    expect(divergenceNote(readCheckin({ sleepQuality: 6 }), 84)).toBe(null); // incomplete → silent
  });

  it("evidence line lists what was reported in plain words", () => {
    const c = readCheckin({ sleepQuality: 3, soreness: 8, stress: 5, energy: 6 });
    const line = checkinEvidenceLine(c);
    expect(line).toMatch(/sleep poor/);
    expect(line).toMatch(/very sore/);
    expect(checkinEvidenceLine(readCheckin({ sleepQuality: 9 }))).toBe(null);
  });
});
