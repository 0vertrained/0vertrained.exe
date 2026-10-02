// The demo character is a product surface: a golden test pins what "Try the
// demo" shows, and a rotation test proves today is always the same kind of
// day whatever the date.
import { describe, expect, it } from "vitest";
import { addDays, weekdayName } from "../../domain/dates";
import { buildProgress } from "../../domain/game/progress";
import type { Progress } from "../../domain/game/types";
import { metaFor as libraryMeta } from "../../domain/program/library";
import { plannedDay } from "../../domain/program/revisions";
import { DEMO_WEEKS, seed } from "./seed";

const TODAY = "2026-10-07"; // a Wednesday, so the preset's Friday session has to rotate
const metaFor: Parameters<typeof buildProgress>[0]["metaFor"] = (log) => libraryMeta(log.libraryId ?? log.performedName ?? log.name);

function progressOn(todayKey: string): { progress: Progress; seeded: ReturnType<typeof seed> } {
  const seeded = seed(todayKey);
  return { seeded, progress: buildProgress({ days: seeded.days, program: seeded.program, settings: seeded.settings, todayKey, metaFor }) };
}

/** The numbers a reviewer sees in the first minute, in one object. */
function summary(p: Progress) {
  const days = Object.values(p.days);
  return {
    xp: p.xp,
    level: p.level,
    rank: p.rank,
    rankTitle: p.rankTitle,
    nextRank: p.nextRank.requirements.map((r) => `${r.label}: ${r.current}/${r.target}${r.met ? " met" : ""}`),
    trial: p.trial?.spec ?? null,
    stats: { str: p.stats.str.value, end: p.stats.end.value, vit: p.stats.vit.value },
    streak: { current: p.streak.current, best: p.streak.best, shields: p.streak.shields, shieldsUsed: p.streak.shieldUsedOn.length },
    qualifyingWeeks: p.qualifyingWeeks,
    keptDays: p.keptDays,
    dayStatuses: days.reduce<Record<string, number>>((m, d) => ({ ...m, [d.status]: (m[d.status] ?? 0) + 1 }), {}),
    records: days.flatMap((d) => d.records.filter((r) => r.isRecord && !r.fromExtraWork).map((r) => `${r.name}: ${r.label}`)),
    recordXpAwarded: days.reduce((n, d) => n + d.recordXp.length, 0),
    achievements: p.achievements.filter((a) => a.unlocked).map((a) => a.id),
    titles: p.titles,
    today: { tier: p.today.tier, status: p.today.status, reason: p.today.reason },
  };
}

describe("demo seed", () => {
  const { progress, seeded } = progressOn(TODAY);

  it("covers ten weeks on the beginner preset, rotated so today is the Full Body C session", () => {
    expect(seeded.startedOn).toBe(addDays(TODAY, -(DEMO_WEEKS * 7 - 1)));
    expect(seeded.program.revisions).toHaveLength(1);
    expect(seeded.program.revisions[0]?.source).toBe("preset:beginner");
    expect(plannedDay(seeded.program, TODAY).title).toBe("Full Body C");
    expect(weekdayName(TODAY)).toBe("Wednesday");
    expect(Object.keys(seeded.days)).toHaveLength(DEMO_WEEKS * 7 - 1); // one missed day has no entry
  });

  it("opens on a reduced, untouched training day with the reason on the quest", () => {
    const today = seeded.days[TODAY];
    expect(today?.quest?.tier).toBe("REDUCED");
    expect(today?.quest?.reason).toMatch(/^Slept poorly \+ very sore: Reduced quest/);
    expect(Object.keys(today?.workout.exercises ?? {})).toHaveLength(0);
    expect(progress.today.status).toBe("open");
    expect(progress.today.tier).toBe("REDUCED");
  });

  it("leaves a push-up rep record within reach today", () => {
    const pushUp = progress.days[addDays(TODAY, -7)]?.records.find((r) => r.name === "Push-Up");
    expect(pushUp?.kind).toBe("reps");
    expect(pushUp?.current).toBe(12);
    expect(plannedDay(seeded.program, TODAY).lifting.some((l) => l.libraryId === "push-up")).toBe(true);
  });

  it("is a level-15 Initiate with the Rank Trial for C unlocked", () => {
    expect(progress.level).toBe(15);
    expect(progress.rank).toBe("D");
    expect(progress.nextRank.rank).toBe("C");
    expect(progress.nextRank.trialAvailable).toBe(true);
    expect(progress.trial?.kind).toBe("loaded");
    expect(progress.qualifyingWeeks).toBeGreaterThanOrEqual(4);
    expect(progress.stats.str.value).toBeGreaterThanOrEqual(25);
  });

  it("carries one shielded miss, one protected illness day, one honoured reduced day and eight records", () => {
    const s = summary(progress);
    expect(s.dayStatuses).toEqual({ kept: 67, missed: 1, protected: 1, open: 1 });
    expect(s.streak.shieldsUsed).toBe(1);
    expect(s.streak.current).toBe(s.streak.best);
    expect(Object.values(progress.days).filter((d) => d.tier === "REDUCED" && d.status === "kept")).toHaveLength(1);
    expect(s.records).toHaveLength(8);
    expect(s.recordXpAwarded).toBe(8);
  });

  it("matches the golden summary", () => {
    expect(summary(progress)).toMatchSnapshot();
  });

  it("is deterministic", () => {
    expect(seed(TODAY)).toEqual(seed(TODAY));
    expect(summary(progressOn(TODAY).progress)).toEqual(summary(progress));
  });

  it("opens on a reduced training day for seven consecutive dates", () => {
    for (let i = 0; i < 7; i += 1) {
      const key = addDays(TODAY, i);
      const { progress: p, seeded: s } = progressOn(key);
      expect(plannedDay(s.program, key).rest, key).toBe(false);
      expect(p.today.tier, key).toBe("REDUCED");
      expect(p.today.status, key).toBe("open");
      expect(p.level, key).toBe(15);
      expect(p.rank, key).toBe("D");
    }
  });
});
