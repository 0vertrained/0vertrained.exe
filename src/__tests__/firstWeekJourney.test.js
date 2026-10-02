import { describe, it, expect } from "vitest";
import {
  APP_VERSION_LABEL,
  FIRST_WEEK_DAYS,
  PROGRESS_UNLOCK_DAYS,
  dayHasSignal,
  countLoggedDays,
  countLoggedChannels,
  setupAgeDays,
  isFirstWeekUser,
  resolveDataMode,
  buildFirstWeekChecklist,
  summarizeChecklist,
  buildNewUserEmptyState,
  buildFirstWeekCoachCopy,
  buildBetaFeedbackText,
} from "../firstWeekJourney";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const trainingDay = () => ({ workout: { exercises: { Squat: { sets: [{ weight: 225, reps: 5, done: true }] } } } });
const cardioDay = () => ({ workout: { cardio: { miles: 3 } } });
const noteDay = () => ({ workout: { notes: "easy recovery walk" } });
const nutritionDay = () => ({ nutrition: { calories: 2400, protein: 180 } });
const recoveryDay = () => ({ body: { sleep: 7.5, energy: 6, soreness: 2 } });
const emptyDay = () => ({ workout: { exercises: {}, cardio: { miles: "", time: "" }, notes: "" }, nutrition: { calories: "", protein: "" }, body: { sleep: "", energy: "" } });

const onboarded = (extra = {}) => ({ onboarded: true, setup: { goal: "hybrid", dataMode: "manual", completedAt: null }, goals: {}, ...extra });

// A program with real content on one day (matches DEFAULT_PROGRAM day shape).
const realProgram = { Monday: { lifting: [{ name: "Squat", sets: 3 }], cardio: null } };

describe("dayHasSignal / countLoggedDays", () => {
  it("recognizes each meaningful channel", () => {
    expect(dayHasSignal(trainingDay())).toBe(true);
    expect(dayHasSignal(cardioDay())).toBe(true);
    expect(dayHasSignal(noteDay())).toBe(true);
    expect(dayHasSignal(nutritionDay())).toBe(true);
    expect(dayHasSignal(recoveryDay())).toBe(true);
  });

  it("treats empty scaffolding and junk as no signal", () => {
    expect(dayHasSignal(emptyDay())).toBe(false);
    expect(dayHasSignal({})).toBe(false);
    expect(dayHasSignal(null)).toBe(false);
    expect(dayHasSignal(undefined)).toBe(false);
    expect(dayHasSignal("nope")).toBe(false);
  });

  it("counts distinct logged days from an entries map", () => {
    const entries = {
      "2026-07-01": trainingDay(),
      "2026-07-02": nutritionDay(),
      "2026-07-03": emptyDay(),      // not counted
      "2026-07-04": recoveryDay(),
    };
    expect(countLoggedDays(entries)).toBe(3);
  });

  it("accepts an array of day payloads too", () => {
    expect(countLoggedDays([trainingDay(), emptyDay(), cardioDay()])).toBe(2);
  });

  it("returns 0 for empty / invalid input", () => {
    expect(countLoggedDays({})).toBe(0);
    expect(countLoggedDays(null)).toBe(0);
    expect(countLoggedDays(undefined)).toBe(0);
  });

  it("breaks the count down by channel", () => {
    const entries = {
      a: { ...trainingDay(), ...nutritionDay() }, // training + nutrition
      b: recoveryDay(),                            // recovery only
      c: emptyDay(),                               // nothing
    };
    const ch = countLoggedChannels(entries);
    expect(ch.total).toBe(2);
    expect(ch.training).toBe(1);
    expect(ch.nutrition).toBe(1);
    expect(ch.recovery).toBe(1);
  });
});

describe("setupAgeDays", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  it("computes days since completedAt", () => {
    const s = { setup: { completedAt: "2026-07-07T12:00:00.000Z" } };
    expect(setupAgeDays(s, now)).toBeCloseTo(3, 5);
  });
  it("returns null when missing or invalid", () => {
    expect(setupAgeDays({}, now)).toBeNull();
    expect(setupAgeDays({ setup: { completedAt: null } }, now)).toBeNull();
    expect(setupAgeDays({ setup: { completedAt: "not-a-date" } }, now)).toBeNull();
  });
});

describe("isFirstWeekUser", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("is false for users who have not onboarded", () => {
    expect(isFirstWeekUser({ onboarded: false }, {}, now)).toBe(false);
  });

  it("is true for an onboarded user with < 7 logged days", () => {
    const entries = { a: trainingDay(), b: nutritionDay() };
    expect(isFirstWeekUser(onboarded(), entries, now)).toBe(true);
  });

  it("is true when setup completed within the last 7 days despite many logged days", () => {
    const entries = {};
    for (let i = 0; i < 10; i++) entries[`d${i}`] = trainingDay();
    const s = onboarded({ setup: { goal: "hybrid", dataMode: "manual", completedAt: "2026-07-07T12:00:00.000Z" } });
    expect(countLoggedDays(entries)).toBe(10);
    expect(isFirstWeekUser(s, entries, now)).toBe(true);
  });

  it("is false once past 7 logged days and setup is old", () => {
    const entries = {};
    for (let i = 0; i < 8; i++) entries[`d${i}`] = trainingDay();
    const s = onboarded({ setup: { goal: "hybrid", dataMode: "manual", completedAt: "2026-06-01T12:00:00.000Z" } });
    expect(isFirstWeekUser(s, entries, now)).toBe(false);
  });

  it("accepts the string 'true' onboarded flag", () => {
    expect(isFirstWeekUser({ onboarded: "true", setup: {} }, {}, now)).toBe(true);
  });
});

describe("resolveDataMode — manual is first-class", () => {
  it("defaults to manual", () => {
    expect(resolveDataMode({}, false)).toBe("manual");
    expect(resolveDataMode({ setup: { dataMode: "manual" } }, false)).toBe("manual");
  });
  it("reports oura when connected or chosen", () => {
    expect(resolveDataMode({ setup: { dataMode: "manual" } }, true)).toBe("oura");
    expect(resolveDataMode({ setup: { dataMode: "oura" } }, false)).toBe("oura");
  });
  it("keeps 'later' when chosen and not connected", () => {
    expect(resolveDataMode({ setup: { dataMode: "later" } }, false)).toBe("later");
  });
});

describe("buildFirstWeekChecklist", () => {
  it("returns the six ordered items with the required fields", () => {
    const list = buildFirstWeekChecklist({ settings: onboarded(), entries: {}, program: null, ouraConnected: false });
    expect(list.map((i) => i.id)).toEqual([
      "setup", "program", "recovery-mode", "log-training", "log-fuel", "review-progress",
    ]);
    for (const item of list) {
      expect(typeof item.label).toBe("string");
      expect(typeof item.detail).toBe("string");
      expect(["done", "next", "pending"]).toContain(item.status);
      expect(typeof item.cta).toBe("string");
      expect(item.targetTab || item.targetAction).toBeTruthy();
    }
  });

  it("marks manual recovery mode as done (first-class, never incomplete)", () => {
    const list = buildFirstWeekChecklist({ settings: onboarded(), entries: {}, program: null, ouraConnected: false });
    const recovery = list.find((i) => i.id === "recovery-mode");
    expect(recovery.status).toBe("done");
    expect(recovery.detail.toLowerCase()).toContain("manual");
  });

  it("assigns exactly one 'next' — the first incomplete item", () => {
    // Fresh onboarded user, no program, no logs: setup + recovery-mode done,
    // program is the first incomplete → 'next'.
    const list = buildFirstWeekChecklist({ settings: onboarded(), entries: {}, program: null, ouraConnected: false });
    const nexts = list.filter((i) => i.status === "next");
    expect(nexts).toHaveLength(1);
    expect(nexts[0].id).toBe("program");
    // everything after the next incomplete is pending
    expect(list.find((i) => i.id === "log-training").status).toBe("pending");
  });

  it("transitions items to done as data arrives", () => {
    const settings = onboarded({ goals: { protein: 180, calories: 2600 } });
    const entries = { a: trainingDay(), b: nutritionDay(), c: recoveryDay() };
    const list = buildFirstWeekChecklist({ settings, entries, program: realProgram, ouraConnected: false });
    const byId = Object.fromEntries(list.map((i) => [i.id, i.status]));
    expect(byId.setup).toBe("done");
    expect(byId.program).toBe("done");         // realProgram has content
    expect(byId["recovery-mode"]).toBe("done");
    expect(byId["log-training"]).toBe("done");  // training logged
    expect(byId["log-fuel"]).toBe("done");      // nutrition logged
    expect(byId["review-progress"]).toBe("done"); // 3 logged days
  });

  it("keeps review-progress incomplete under 3 logged days", () => {
    const list = buildFirstWeekChecklist({ settings: onboarded(), entries: { a: trainingDay() }, program: realProgram, ouraConnected: false });
    expect(list.find((i) => i.id === "review-progress").status).not.toBe("done");
  });

  it("summarizeChecklist reports progress + the next step", () => {
    const list = buildFirstWeekChecklist({ settings: onboarded(), entries: {}, program: null, ouraConnected: false });
    const sum = summarizeChecklist(list);
    expect(sum.total).toBe(6);
    expect(sum.done).toBeGreaterThan(0);
    expect(sum.label).toBe(`${sum.done}/6 complete`);
    expect(sum.next.id).toBe("program");
    expect(sum.complete).toBe(false);
  });
});

describe("buildNewUserEmptyState — copy for all tabs", () => {
  const ctx = { settings: onboarded(), entries: {}, program: null, ouraConnected: false };

  it("returns friendly copy for every primary tab", () => {
    for (const tab of ["Today", "Recovery", "Fuel", "Progress", "More"]) {
      const es = buildNewUserEmptyState(tab, ctx);
      expect(es).toBeTruthy();
      expect(typeof es.title).toBe("string");
      expect(es.title.length).toBeGreaterThan(0);
      expect(typeof es.message).toBe("string");
      expect(es.message.length).toBeGreaterThan(0);
    }
  });

  it("uses the required spec copy per tab", () => {
    expect(buildNewUserEmptyState("Today", ctx).message).toContain("unlock the daily call");
    expect(buildNewUserEmptyState("Recovery", ctx).message).toContain("Manual recovery works now");
    expect(buildNewUserEmptyState("Fuel", ctx).message).toContain("learn your pattern");
    expect(buildNewUserEmptyState("Progress", ctx).message).toContain("3 logged days");
    expect(buildNewUserEmptyState("More", ctx).message).toContain("integrations");
  });

  it("tailors Recovery copy for a connected user without telling them to log manually", () => {
    const es = buildNewUserEmptyState("Recovery", { ...ctx, ouraConnected: true });
    expect(es.message.toLowerCase()).toContain("oura");
  });

  it("nudges Today toward logging when a program already exists", () => {
    const es = buildNewUserEmptyState("Today", { ...ctx, program: realProgram });
    expect(es.message.toLowerCase()).toContain("log today");
  });

  it("returns null for an unknown tab", () => {
    expect(buildNewUserEmptyState("Nonsense", ctx)).toBeNull();
  });
});

describe("buildFirstWeekCoachCopy — conservative baseline language", () => {
  const JUDGMENTAL = ["declining", "off track", "poor", "bad", "failing", "behind", "regress", "worse"];

  it("never uses judgmental / trend language before enough data (0–6 days)", () => {
    for (let days = 0; days < FIRST_WEEK_DAYS; days++) {
      const copy = buildFirstWeekCoachCopy({ loggedDays: days, setupGoal: "hybrid", dataMode: "manual" });
      const text = `${copy.headline} ${copy.body}`.toLowerCase();
      for (const word of JUDGMENTAL) expect(text).not.toContain(word);
      expect(text).toContain("baseline");
      expect(copy.baselineComplete).toBe(false);
    }
  });

  it("marks the baseline complete at a full week", () => {
    const copy = buildFirstWeekCoachCopy({ loggedDays: 7, setupGoal: "hybrid", dataMode: "manual" });
    expect(copy.baselineComplete).toBe(true);
  });

  it("mentions manual logging is enough (no wearable required) in manual mode", () => {
    const copy = buildFirstWeekCoachCopy({ loggedDays: 1, setupGoal: "strength", dataMode: "manual" });
    expect(copy.body.toLowerCase()).toContain("no wearable");
  });

  it("is null-safe with no arguments", () => {
    const copy = buildFirstWeekCoachCopy();
    expect(typeof copy.headline).toBe("string");
    expect(typeof copy.body).toBe("string");
  });
});

describe("buildBetaFeedbackText — privacy safe", () => {
  const settings = {
    onboarded: true,
    setup: { goal: "strength", dataMode: "oura" },
    username: "secretUser42",
    goals: { calories: 3000, protein: 210 },
    // Adversarial fields that must never leak:
    ouraAccessToken: "tok_live_ABCDEF123456",
    supabaseKey: "sk-ant-should-not-appear",
    password: "hunter2",
  };

  const text = buildBetaFeedbackText({
    tab: "Progress",
    settings,
    loggedDays: 4,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    note: "The baseline card was clear.",
  });

  it("includes the required non-identifying fields", () => {
    expect(text).toContain(APP_VERSION_LABEL);
    expect(text).toContain("Current tab: Progress");
    expect(text).toContain("Logged days: 4");
    expect(text).toContain("Strength");       // goal label
    expect(text).toContain("Wearable connected");  // data mode label
    expect(text).toContain("Mozilla/5.0");     // user agent
    expect(text).toContain("The baseline card was clear."); // freeform note
  });

  it("excludes usernames, tokens, keys, passwords, and secret-ish terms", () => {
    const lower = text.toLowerCase();
    expect(text).not.toContain("secretUser42");
    expect(text).not.toContain("tok_live_ABCDEF123456");
    expect(text).not.toContain("sk-ant-should-not-appear");
    expect(text).not.toContain("hunter2");
    for (const term of ["token", "secret", "password", "apikey", "api_key", "access_token", "refresh", "sk-ant", "bearer"]) {
      expect(lower).not.toContain(term);
    }
  });

  it("does not dump entries / biometric payloads", () => {
    const lower = text.toLowerCase();
    for (const term of ["hrv", "restingheartrate", "\"workout\"", "\"nutrition\"", "\"body\"", "payload", "biometric"]) {
      expect(lower).not.toContain(term.toLowerCase());
    }
  });

  it("uses a placeholder when no note is supplied and stays safe", () => {
    const t = buildBetaFeedbackText({ tab: "Today", settings, loggedDays: 0 });
    expect(t).toContain("describe what worked");
    expect(t).not.toContain("secretUser42");
  });
});

describe("module constants", () => {
  it("exposes the expected thresholds", () => {
    expect(APP_VERSION_LABEL).toBe("V2.8");
    expect(FIRST_WEEK_DAYS).toBe(7);
    expect(PROGRESS_UNLOCK_DAYS).toBe(3);
  });
});
