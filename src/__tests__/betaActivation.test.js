import { describe, it, expect } from "vitest";
import {
  BETA_ACTIVATION_VERSION_LABEL,
  isSocialUnderstood,
  buildBetaActivationChecklist,
  summarizeActivation,
  buildSparseGuidance,
  buildBetaFeedbackText,
} from "../firstWeekJourney";

const trainingDay = () => ({ workout: { exercises: { Squat: { sets: [{ weight: 225, reps: 5, done: true }] } } } });
const nutritionDay = () => ({ nutrition: { calories: 2400, protein: 180 } });
const recoveryDay = () => ({ body: { sleep: 7.5, energy: 6 } });
const realProgram = { Monday: { lifting: [{ name: "Squat", sets: 3 }], cardio: null } };

const onboarded = (extra = {}) => ({
  onboarded: true,
  username: "athlete1",
  setup: { goal: "hybrid", dataMode: "manual", completedAt: null },
  goals: {},
  ...extra,
});

describe("V4.5 beta activation checklist", () => {
  it("returns seven ordered items with the required fields", () => {
    const list = buildBetaActivationChecklist({ settings: onboarded(), entries: {}, program: null, username: "athlete1", ouraConnected: false });
    expect(list.map((i) => i.id)).toEqual([
      "profile", "program", "recovery-mode", "log-training", "log-fuel", "social", "review-progress",
    ]);
    for (const item of list) {
      expect(typeof item.label).toBe("string");
      expect(typeof item.detail).toBe("string");
      expect(["done", "next", "pending", "optional"]).toContain(item.status);
      expect(typeof item.cta).toBe("string");
    }
  });

  it("marks manual recovery as done (first-class, never blocking)", () => {
    const list = buildBetaActivationChecklist({ settings: onboarded(), entries: {}, program: null, username: "athlete1", ouraConnected: false });
    const recovery = list.find((i) => i.id === "recovery-mode");
    expect(recovery.status).toBe("done");
    expect(recovery.detail.toLowerCase()).toContain("manual");
  });

  it("treats social as optional — never assigned 'next'", () => {
    // Fresh user, no program: program is 'next', social remains 'optional'.
    const list = buildBetaActivationChecklist({ settings: onboarded(), entries: {}, program: null, username: "athlete1", ouraConnected: false });
    const social = list.find((i) => i.id === "social");
    expect(social.optional).toBe(true);
    expect(social.status).toBe("optional");
    const nexts = list.filter((i) => i.status === "next");
    expect(nexts).toHaveLength(1);
    expect(nexts[0].id).toBe("program");
  });

  it("social becomes done once the user opts in or acknowledges", () => {
    const optedIn = buildBetaActivationChecklist({ settings: onboarded({ socialOptIn: true }), entries: {}, program: null, username: "x", ouraConnected: false });
    expect(optedIn.find((i) => i.id === "social").status).toBe("done");

    const acked = buildBetaActivationChecklist({ settings: onboarded({ setup: { goal: "hybrid", dataMode: "manual", socialAck: true } }), entries: {}, program: null, username: "x", ouraConnected: false });
    expect(acked.find((i) => i.id === "social").status).toBe("done");
  });

  it("profile is incomplete without a username", () => {
    const noName = buildBetaActivationChecklist({ settings: onboarded({ username: null }), entries: {}, program: null, username: null, ouraConnected: false });
    expect(noName.find((i) => i.id === "profile").status).not.toBe("done");
  });

  it("whoop-only connection counts as a chosen recovery mode", () => {
    const list = buildBetaActivationChecklist({ settings: { onboarded: true, username: "x", setup: { dataMode: null } }, entries: {}, program: null, username: "x", ouraConnected: false, whoopConnected: true });
    expect(list.find((i) => i.id === "recovery-mode").status).toBe("done");
  });

  it("summarizeActivation ignores optional items in the required total", () => {
    const settings = onboarded({ goals: { protein: 180, calories: 2600 } });
    const entries = { a: trainingDay(), b: nutritionDay(), c: recoveryDay() };
    const list = buildBetaActivationChecklist({ settings, entries, program: realProgram, username: "athlete1", ouraConnected: false });
    const sum = summarizeActivation(list);
    expect(sum.total).toBe(6); // 7 items minus 1 optional (social)
    expect(sum.optionalTotal).toBe(1);
    // profile, program, recovery, training, fuel, review all done → complete
    expect(sum.complete).toBe(true);
    expect(sum.label).toBe("6/6 complete");
  });
});

describe("isSocialUnderstood", () => {
  it("is false by default", () => {
    expect(isSocialUnderstood({})).toBe(false);
    expect(isSocialUnderstood(null)).toBe(false);
  });
  it("is true after opt-in or ack", () => {
    expect(isSocialUnderstood({ socialOptIn: true })).toBe(true);
    expect(isSocialUnderstood({ socialOptIn: "true" })).toBe(true);
    expect(isSocialUnderstood({ setup: { socialAck: true } })).toBe(true);
  });
});

describe("buildSparseGuidance", () => {
  const ctx = { settings: onboarded(), entries: {}, program: null, ouraConnected: false, whoopConnected: false };

  it("covers all five tabs plus the Social subview", () => {
    for (const tab of ["Today", "Recovery", "Fuel", "Progress", "More", "Social"]) {
      const g = buildSparseGuidance(tab, ctx);
      expect(g).toBeTruthy();
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.message.length).toBeGreaterThan(0);
    }
  });

  it("explains the wearable data delay on Recovery when a wearable is chosen", () => {
    const g = buildSparseGuidance("Recovery", { ...ctx, ouraConnected: true });
    expect(g.message.toLowerCase()).toContain("after your next full sleep");
  });

  it("does not tell a manual user their setup is broken", () => {
    const g = buildSparseGuidance("Recovery", ctx);
    expect(g.message.toLowerCase()).toContain("manual recovery works now");
    expect(g.message.toLowerCase()).not.toContain("error");
  });

  it("Social copy emphasizes aggregate-only privacy", () => {
    const g = buildSparseGuidance("Social", ctx);
    expect(g.message.toLowerCase()).toContain("aggregate-only");
  });

  it("returns null for an unknown tab", () => {
    expect(buildSparseGuidance("Nope", ctx)).toBeNull();
  });
});

describe("buildBetaFeedbackText — V4.5 version stamp", () => {
  const settings = { onboarded: true, setup: { goal: "strength", dataMode: "oura" }, username: "secretUser42" };

  it("stamps the caller-provided version and stays privacy-safe", () => {
    const text = buildBetaFeedbackText({ tab: "More", settings, loggedDays: 4, userAgent: "UA", note: "great", version: BETA_ACTIVATION_VERSION_LABEL });
    expect(text).toContain("V4.5");
    expect(text).not.toContain("secretUser42");
    for (const term of ["token", "secret", "password", "oura_access", "bearer"]) {
      expect(text.toLowerCase()).not.toContain(term);
    }
  });

  it("defaults to the frozen label when no version is passed", () => {
    const text = buildBetaFeedbackText({ tab: "Today", settings, loggedDays: 0 });
    expect(text).toContain("V2.8");
  });
});
