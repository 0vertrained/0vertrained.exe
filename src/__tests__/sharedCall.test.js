// One call across the app: Today and Recovery show the more cautious of
// their two reads, with the same recovery score beside it.
import { describe, expect, it } from "vitest";
import { resolveSharedCall, deriveRecoveryVerdict, recoveryVerdictFromLoad, CALL_ORDER } from "../sharedCall";
import { buildTodayDecision } from "../todayDecision";

const normal = { readiness: "normal", confidence: "high", reasons: [] };

describe("resolveSharedCall", () => {
  it("takes Today's call when Today's read is the cautious one", () => {
    const call = resolveSharedCall({ todayCall: "modify", recoveryVerdict: { call: "capped" }, score: 68.6 });
    expect(call).toMatchObject({ call: "easy", stamp: "Easy", level: 2, source: "today", score: 69 });
  });

  it("takes Recovery's call when Recovery's read is the cautious one, even a capped day", () => {
    expect(resolveSharedCall({ todayCall: "maintain", recoveryVerdict: { call: "capped" } })).toMatchObject({ call: "capped", stamp: "Train — capped", source: "recovery" });
    expect(resolveSharedCall({ todayCall: "push", recoveryVerdict: { call: "recover" } })).toMatchObject({ call: "recover", source: "recovery" });
  });

  it("says when both reads agree", () => {
    expect(resolveSharedCall({ todayCall: "modify", recoveryVerdict: { call: "easy" } })).toMatchObject({ call: "easy", source: "both" });
  });

  it("uses whichever read exists, and nothing when neither does", () => {
    expect(resolveSharedCall({ todayCall: "push" })).toMatchObject({ call: "push", source: "today", score: null });
    expect(resolveSharedCall({ recoveryVerdict: { call: "train" } })).toMatchObject({ call: "train", source: "recovery" });
    expect(resolveSharedCall({})).toBeNull();
  });

  it("is never less cautious than either read", () => {
    const today = ["push", "maintain", "modify", "recover"];
    const asShared = { push: "push", maintain: "train", modify: "easy", recover: "recover" };
    for (const t of today) {
      for (const r of CALL_ORDER) {
        const shared = resolveSharedCall({ todayCall: t, recoveryVerdict: { call: r } });
        expect(CALL_ORDER.indexOf(shared.call)).toBeGreaterThanOrEqual(CALL_ORDER.indexOf(asShared[t]));
        expect(CALL_ORDER.indexOf(shared.call)).toBeGreaterThanOrEqual(CALL_ORDER.indexOf(r));
      }
    }
  });
});

describe("deriveRecoveryVerdict", () => {
  const recovery = { score: 78, band: "good" };
  const recommendation = { label: "Normal Load", prescription: "Keep the plan." };

  it("reads the morning check-in as a caution-only limiter", () => {
    expect(deriveRecoveryVerdict({ recovery, recommendation }).verdict.call).toBe("train");
    // Slept poorly and very sore: two rough answers step the call down one.
    const { verdict, checkin } = deriveRecoveryVerdict({ recovery, recommendation, todayBody: { sleepQuality: "3", soreness: "8" } });
    expect(checkin.flags).toEqual(expect.arrayContaining(["slept_poorly", "very_sore"]));
    expect(verdict.call).toBe("capped");
    expect(verdict.limiter.key).toBe("checkin");
    // A great morning never raises it.
    expect(deriveRecoveryVerdict({ recovery, recommendation, todayBody: { sleepQuality: "9", soreness: "1" } }).verdict.call).toBe("train");
  });

  it("has no verdict before a wearable has scored the night", () => {
    expect(deriveRecoveryVerdict({ recommendation }).verdict).toBeNull();
    expect(recoveryVerdictFromLoad(null)).toBeNull();
    expect(recoveryVerdictFromLoad({ connected: false, snapshot: { connected: false } })).toBeNull();
  });

  it("reads a load the same way Recovery reads its own state", () => {
    const snapshot = { recovery, recommendation, sleepDebt: { debtHours: 2.5 }, alerts: [], trainingLoad: null, confidence: { level: "high" } };
    const fromLoad = recoveryVerdictFromLoad({ connected: true, snapshot, whoopConnected: false }, { data: {}, todayKey: "2026-11-27", yesterdayKey: "2026-11-26" });
    const direct = deriveRecoveryVerdict({ ...snapshot }).verdict;
    expect(fromLoad).toEqual(direct);
  });
});

describe("Today's decision under Recovery's verdict", () => {
  it("caps Today's call to Recovery's, keeping Today's own call and saying why", () => {
    const out = buildTodayDecision({ recommendation: normal, recoveryVerdict: { call: "easy", limiter: { detail: "Sleep debt lowers today's ceiling." } } });
    expect(out.engineCall).toBe("maintain");
    expect(out.call).toBe("modify");
    expect(out.subtitle).toBe("Recovery's read is more cautious today, so the call follows it. Sleep debt lowers today's ceiling.");
    expect(out.reasons).toContain(out.subtitle);
  });

  it("never raises Today's call", () => {
    const pullBack = { readiness: "pull_back", confidence: "high", reasons: [] };
    expect(buildTodayDecision({ recommendation: pullBack, recoveryVerdict: { call: "push" } }).call).toBe("modify");
    expect(buildTodayDecision({ recommendation: normal, recoveryVerdict: { call: "capped" } }).call).toBe("maintain");
    expect(buildTodayDecision({ recommendation: normal }).call).toBe("maintain");
  });
});
