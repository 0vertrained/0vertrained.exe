import { describe, expect, it } from "vitest";
import { metaFor } from "../../app/useGame";
import { seed } from "../../data/demo/seed";
import { addDays } from "../../domain/dates";
import { buildProgress } from "../../domain/game/progress";
import { CHECKIN_FINE, day, threeDayProgram } from "../../test/gameFixtures";
import { scenario } from "../../test/gameScenario";
import { checkinWords, dayDetail, deleteImpactText, logCount, logRows, shortDate, xpImpactOfDelete } from "./logView";

const TODAY = "2026-10-02";
const demo = seed(TODAY);
const progress = buildProgress({ days: demo.days, program: demo.program, settings: demo.settings, todayKey: TODAY, metaFor, units: "metric" });

describe("shortDate", () => {
  it("is the weekday, the day and the month, short and local", () => {
    expect(shortDate("2026-10-02")).toBe("Fri 2 Oct");
    expect(shortDate("2026-09-30")).toBe("Wed 30 Sep");
    expect(shortDate("2026-01-01")).toBe("Thu 1 Jan");
  });
});

describe("logRows", () => {
  it("lists every judged day of the demo newest first, a page at a time", () => {
    expect(logCount(progress)).toBe(70);
    const page = logRows(progress, { limit: 20 });
    expect(page).toHaveLength(20);
    expect(page[0]).toEqual({ dateKey: TODAY, dateText: "Fri 2 Oct", tier: "REDUCED", statusWord: "Open", xp: 10 });
    expect(page[1]).toMatchObject({ dateKey: "2026-10-01", dateText: "Thu 1 Oct", tier: "REST", statusWord: "Rest", xp: 30 });
    expect(page[2]).toMatchObject({ dateKey: "2026-09-30", dateText: "Wed 30 Sep", tier: "FULL", statusWord: "Cleared", xp: 100 });
    const keys = page.map((r) => r.dateKey);
    expect(keys).toEqual([...keys].sort().reverse());
  });

  it("offsets into the log and runs out at the end", () => {
    const second = logRows(progress, { limit: 20, offset: 20 });
    expect(second).toHaveLength(20);
    expect(second[0]?.dateKey).toBe(addDays(TODAY, -20));
    expect(logRows(progress, { limit: 20, offset: 60 })).toHaveLength(10);
    expect(logRows(progress, { limit: 20, offset: 70 })).toHaveLength(0);
    expect(logRows(progress, { limit: 0 })).toHaveLength(0);
  });

  it("names a missed day, a protected day and a reduced one without judging them", () => {
    const all = logRows(progress, { limit: 100 });
    expect(all.find((r) => r.dateKey === "2026-08-26")).toMatchObject({ dateText: "Wed 26 Aug", tier: "FULL", statusWord: "Missed", xp: 0 });
    expect(all.find((r) => r.dateKey === "2026-09-07")).toMatchObject({ tier: "RECOVER", statusWord: "Protected", xp: 10 });
    expect(all.find((r) => r.dateKey === "2026-09-23")).toMatchObject({ tier: "REDUCED", statusWord: "Cleared", xp: 100 });
  });

  it("leaves out days the engine never judged, unless they paid", () => {
    const bare = buildProgress({ days: {}, program: null, settings: { startedOn: TODAY }, todayKey: TODAY, metaFor });
    expect(logCount(bare)).toBe(0);
    const checkedIn = buildProgress({ days: { [TODAY]: day({ checkin: CHECKIN_FINE }) }, program: null, settings: { startedOn: TODAY }, todayKey: TODAY, metaFor });
    expect(logRows(checkedIn, { limit: 5 })).toEqual([{ dateKey: TODAY, dateText: "Fri 2 Oct", tier: null, statusWord: "Logged", xp: 10 }]);
  });
});

describe("dayDetail", () => {
  it("reads a training day back: reason, XP lines, sets, cardio, check-in and the record", () => {
    const detail = dayDetail(progress, "2026-09-28", demo.days["2026-09-28"], "metric", metaFor);
    expect(detail).toMatchObject({ dateText: "Mon 28 Sep", tier: "FULL", statusWord: "Cleared", hasEntry: true });
    expect(detail?.reason).toMatch(/^Full quest\. Full Body A/);
    expect(detail?.lines).toEqual([
      { label: "Status check", xp: 10 },
      { label: "Training · 15 / 15 sets", xp: 90 },
      { label: "Record · Back Squat", xp: 25 },
    ]);
    expect(detail?.exercises.map((e) => e.name)).toEqual(["Back Squat", "Barbell Bench Press", "Barbell Row", "Overhead Press", "Plank"]);
    expect(detail?.exercises[0]).toEqual({ name: "Back Squat", sets: ["57.5 × 8", "57.5 × 8", "57.5 × 8"], pain: false });
    expect(detail?.exercises[4]?.sets).toEqual(["45 s", "45 s", "45 s"]);
    expect(detail?.cardio).toEqual([{ kind: "Easy Walk/Run", minutes: 29, km: 2.4, text: "29 min · 2.4 km" }]);
    expect(detail?.checkin).toEqual(["Slept fine", "Sore some", "Stress some", "Energy ok"]);
    expect(detail?.records).toEqual(["Back Squat est. max 72.8 kg (was 69.7 kg)."]);
    expect(detail?.note).toBeUndefined();
  });

  it("shows loads in the athlete's units", () => {
    const detail = dayDetail(progress, "2026-09-30", demo.days["2026-09-30"], "imperial", metaFor);
    expect(detail?.exercises[0]).toMatchObject({ name: "Conventional Deadlift", sets: ["165.3 × 6", "165.3 × 6", "165.3 × 6"] });
    expect(detail?.cardio[0]?.text).toBe("29 min · 1.5 mi");
  });

  it("reads a rest day, a protected day and a missed day with no entry", () => {
    const rest = dayDetail(progress, "2026-10-01", demo.days["2026-10-01"], "metric", metaFor);
    expect(rest).toMatchObject({ tier: "REST", statusWord: "Rest", exercises: [], cardio: [], records: [] });
    expect(rest?.lines).toEqual([{ label: "Status check", xp: 10 }, { label: "Recovery", xp: 20 }]);

    const ill = dayDetail(progress, "2026-09-07", demo.days["2026-09-07"], "metric", metaFor);
    expect(ill).toMatchObject({ tier: "RECOVER", statusWord: "Protected", reason: "Ill or injured: rest today. Streak protected." });
    expect(ill?.checkin).toContain("Ill or injured");

    const missed = dayDetail(progress, "2026-08-26", undefined, "metric", metaFor);
    expect(missed).toMatchObject({ statusWord: "Missed", lines: [], exercises: [], checkin: [], hasEntry: false });
  });

  it("is null for a day outside the log", () => {
    expect(dayDetail(progress, "2030-01-01", undefined, "metric", metaFor)).toBeNull();
  });

  it("keeps the note, the swap, a skip and a pain flag", () => {
    const d = day({ checkin: { ...CHECKIN_FINE, note: "  Shoulder twinge. " } });
    d.workout.exercises["bench"] = { name: "Barbell Bench Press", performedName: "Incline DB Press", sets: [{ id: "s1", weightKg: 20, reps: 10, done: true, pain: true }] };
    d.workout.exercises["row"] = { name: "Barbell Row", skipped: "equipment", sets: [] };
    d.workout.exercises["ohp"] = { name: "Overhead Press", sets: [{ id: "s1", weightKg: null, reps: null, done: false }] };
    const detail = dayDetail(progress, TODAY, d, "metric", metaFor);
    expect(detail?.note).toBe("Shoulder twinge.");
    expect(detail?.exercises).toEqual([
      { name: "Incline DB Press", sets: ["20 × 10"], pain: true },
      { name: "Barbell Row", skipped: "equipment", sets: [], pain: false },
    ]);
  });
});

describe("checkinWords", () => {
  it("snaps typed values to the nearest tap and skips unanswered rows", () => {
    expect(checkinWords({ sleepQuality: 8, energy: 2 })).toEqual(["Slept well", "Energy low"]);
    expect(checkinWords(undefined)).toEqual([]);
  });
});

describe("xpImpactOfDelete", () => {
  const input = { days: demo.days, program: demo.program, settings: demo.settings, todayKey: TODAY, units: "metric" as const, metaFor };

  it("costs exactly the day's XP for an ordinary kept day, and that day leaves the streak", () => {
    const impact = xpImpactOfDelete({ ...input, dateKey: "2026-09-30" });
    expect(impact.delta).toBe(-(progress.days["2026-09-30"]?.xp ?? 0));
    expect(impact).toEqual({ xpBefore: 6770, xpAfter: 6670, delta: -100, streakBefore: 67, streakAfter: 66 });
  });

  it("leaves the streak alone when a rest day goes", () => {
    expect(xpImpactOfDelete({ ...input, dateKey: "2026-10-01" })).toEqual({ xpBefore: 6770, xpAfter: 6740, delta: -30, streakBefore: 67, streakAfter: 67 });
  });

  it("shows the streak drop when the day was the only one keeping it", () => {
    const sc = scenario({ program: threeDayProgram(), startedOn: "2026-09-28", todayKey: "2026-10-01" });
    const impact = xpImpactOfDelete({ days: sc.days, program: sc.program, settings: sc.settings, todayKey: sc.todayKey, units: "metric", metaFor, dateKey: "2026-09-28" });
    expect(impact).toEqual({ xpBefore: 370, xpAfter: 240, delta: -130, streakBefore: 4, streakAfter: 3 });
    expect(deleteImpactText(impact, "Mon 28 Sep")).toBe("Removes the log for Mon 28 Sep. XP goes from 370 to 240 (−130). Streak drops to 3 days.");
  });
});

describe("deleteImpactText", () => {
  it("states the XP move with grouped digits and whether the streak holds", () => {
    expect(deleteImpactText({ xpBefore: 6770, xpAfter: 6640, delta: -130, streakBefore: 67, streakAfter: 67 }, "Fri 2 Oct"))
      .toBe("Removes the log for Fri 2 Oct. XP goes from 6,770 to 6,640 (−130). Streak stays at 67 days.");
    expect(deleteImpactText({ xpBefore: 6770, xpAfter: 6770, delta: 0, streakBefore: 2, streakAfter: 1 }, "Thu 1 Oct"))
      .toBe("Removes the log for Thu 1 Oct. XP stays at 6,770. Streak drops to 1 day.");
  });
});
