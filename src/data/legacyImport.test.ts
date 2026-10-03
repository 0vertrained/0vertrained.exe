// The importer is a product surface for everyone arriving from v19: golden
// tests pin what a real v19 backup and a raw day map become once imported,
// how the engine pays them, and that the app's own export reads back whole.
import { describe, expect, it } from "vitest";
import { addDays, type DateKey } from "../domain/dates";
import { emptyDay, type DayMap, type DayV2 } from "../domain/day/schema";
import { buildProgress } from "../domain/game/progress";
import type { Progress } from "../domain/game/types";
import { XP } from "../domain/game/config";
import { metaFor as libraryMeta } from "../domain/program/library";
import { didTrain } from "../domain/readiness/loadGuard";
import { lbToKg, miToKm } from "../domain/units";
import { emptySnapshot, type SnapshotData } from "./DataSource";
import { seed } from "./demo/seed";
import backupV1 from "./fixtures/legacy-backup-v1.json";
import rawMap from "./fixtures/legacy-raw-map.json";
import { BACKUP_FORMAT, buildExport, exportFileName, mergeImport, newDayKeys, parseImport, type ImportParse } from "./legacyImport";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

const metaFor: Parameters<typeof buildProgress>[0]["metaFor"] = (log) => libraryMeta(log.libraryId ?? log.performedName ?? log.name);

const text = (value: unknown): string => JSON.stringify(value);
const empty = (): SnapshotData => emptySnapshot();

function imported(parsed: ImportParse, todayKey: DateKey): { snapshot: SnapshotData; progress: Progress } {
  const snapshot = mergeImport(empty(), parsed, { mode: "missing-only" });
  const progress = buildProgress({ days: snapshot.days, program: snapshot.program, settings: snapshot.settings.game, todayKey, metaFor });
  return { snapshot, progress };
}

/** What a reviewer checks after an import, in one object. */
function summary(p: Progress) {
  const days = Object.values(p.days);
  return {
    xp: p.xp,
    level: p.level,
    rank: p.rank,
    keptDays: p.keptDays,
    streak: { current: p.streak.current, best: p.streak.best },
    stats: { str: p.stats.str.value, end: p.stats.end.value, vit: p.stats.vit.value },
    dayStatuses: days.reduce<Record<string, number>>((m, d) => ({ ...m, [d.status]: (m[d.status] ?? 0) + 1 }), {}),
    legacyDays: days.filter((d) => d.legacy && d.status === "kept").map((d) => d.dateKey),
    records: days.flatMap((d) => d.records.filter((r) => r.isRecord && !r.fromExtraWork).map((r) => `${d.dateKey} ${r.name}: ${r.label}`)),
    achievements: p.achievements.filter((a) => a.unlocked).map((a) => a.id),
  };
}

const workDays = (days: DayMap): number => Object.values(days).filter(didTrain).length;

describe("parseImport", () => {
  it("reads the raw {date: day} map, converting v1 days and skipping undated keys", () => {
    const parsed = parseImport(text(rawMap));
    expect(parsed.kind).toBe("raw-map");
    expect(parsed.counts).toEqual({ days: 7, skipped: 1 });
    expect(parsed.range).toEqual({ from: "2026-01-05", to: "2026-01-12" });
    expect(parsed.program).toBeNull();
    expect(parsed.settings).toEqual({ game: { importedThrough: "2026-01-12" } });
    expect(parsed.warnings).toEqual(["Skipped 1 entry that is not a dated day."]);

    const bench = parsed.days["2026-01-05"]?.workout.exercises["Barbell Bench Press"];
    expect(bench?.libraryId).toBe("barbell-bench-press");
    expect(bench?.sets[0]).toMatchObject({ weightKg: lbToKg(185), reps: 6, done: true });
    expect(parsed.days["2026-01-05"]?.workout.exercises["Leg Ext. Machine"]?.name).toBe("Leg Ext. Machine");
    expect(parsed.days["2026-01-08"]?.workout.exercises["Pull-Ups"]?.libraryId).toBe("pull-up");
    expect(parsed.days["2026-01-09"]?.workout.exercises["Farmer Carry"]?.sets[0]?.distanceM).toBeCloseTo(36.58, 2);
    expect(parsed.days["2026-01-06"]?.workout.cardio[0]).toMatchObject({ minutes: 28, km: miToKm(3.1) });
    expect(parsed.days["2026-01-05"]?.legacy?.nutrition).toEqual({ calories: "2600", protein: "190" });
  });

  it("reads the v19 backup envelope: entries, the v1 program and the legacy cut-off", () => {
    const parsed = parseImport(text(backupV1));
    expect(parsed.kind).toBe("backup-v1");
    expect(parsed.counts).toEqual({ days: 7, skipped: 0 });
    expect(parsed.range).toEqual({ from: "2025-12-01", to: "2025-12-09" });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.program?.revisions).toHaveLength(1);
    expect(parsed.program?.revisions[0]).toMatchObject({ effectiveFrom: "1970-01-01", source: "imported" });
    expect(parsed.program?.revisions[0]?.week.Tuesday.lifting.map((l) => l.libraryId)).toEqual(["back-squat", undefined]);
    expect(parsed.settings).toEqual({ game: { importedThrough: "2025-12-09" } });
  });

  it("maps v19 units and bodyweight when the backup carries them, and nothing else", () => {
    const parsed = parseImport(text({ format: BACKUP_FORMAT, v: 1, entries: {}, program: null, settings: { units: "lb", bodyweight: "176", theme: "terminal", trainingCues: { haptics: false } } }));
    expect(parsed.settings).toEqual({ units: "imperial", bodyweightKg: 79.8, game: { bodyweightKg: 79.8 } });
    expect(parseImport(text({ format: BACKUP_FORMAT, v: 1, entries: {}, settings: { unitSystem: "metric", bodyweightKg: 80.26 } })).settings).toEqual({ units: "metric", bodyweightKg: 80.3, game: { bodyweightKg: 80.3 } });
  });

  it("warns when a backup's program cannot be read", () => {
    const parsed = parseImport(text({ format: BACKUP_FORMAT, v: 1, entries: rawMap, program: { nope: true }, settings: {} }));
    expect(parsed.program).toBeNull();
    expect(parsed.warnings).toContain("The program in this backup could not be read. Your current program stays.");
  });

  it("never throws on junk: every bad input is kind unknown with one warning", () => {
    for (const bad of ["not json", "{}", "[]", "42", text({ format: BACKUP_FORMAT, v: 3 }), text({ hello: "world" })]) {
      const parsed = parseImport(bad);
      expect(parsed.kind).toBe("unknown");
      expect(parsed.counts).toEqual({ days: 0, skipped: 0 });
      expect(parsed.warnings).toHaveLength(1);
    }
    expect(parseImport("not json").warnings[0]).toMatch(/not valid JSON/);
    expect(parseImport(text({ format: BACKUP_FORMAT, v: 3 })).warnings[0]).toBe("Backup version 3 is not supported by this app.");
  });
});

describe("golden: a raw map imported into an empty character", () => {
  const parsed = parseImport(text(rawMap));
  const { snapshot, progress } = imported(parsed, "2026-01-20");

  it("pays the legacy rule: a flat XP per imported day with work, nothing for the rest", () => {
    expect(workDays(snapshot.days)).toBe(6);
    expect(progress.xp).toBe(XP.legacyTrainingDay * 6);
    expect(progress.days["2026-01-07"]).toMatchObject({ legacy: true, status: "neutral", xp: 0 });
    expect(progress.days["2026-01-05"]).toMatchObject({ legacy: true, status: "kept", xp: XP.legacyTrainingDay });
  });

  it("matches the golden summary", () => {
    expect(summary(progress)).toMatchSnapshot();
  });
});

describe("golden: a v19 backup imported into an empty character", () => {
  const parsed = parseImport(text(backupV1));
  const { snapshot, progress } = imported(parsed, "2025-12-09"); // the cut-off day: nothing after it is judged yet

  it("pays the legacy rule and installs the v1 program", () => {
    expect(workDays(snapshot.days)).toBe(6);
    expect(progress.xp).toBe(XP.legacyTrainingDay * 6);
    expect(snapshot.program?.revisions[0]?.source).toBe("imported");
    expect(snapshot.settings.game.importedThrough).toBe("2025-12-09");
  });

  it("matches the golden summary", () => {
    expect(summary(progress)).toMatchSnapshot();
  });

  it("reproduces the records: a later set compares against the imported history", () => {
    const key = "2025-12-15"; // a Monday: Upper A, bench
    const day: DayV2 = emptyDay();
    day.workout.exercises["barbell-bench-press"] = {
      name: "Barbell Bench Press", libraryId: "barbell-bench-press", trackingMode: "loaded_reps",
      sets: [{ id: "s1", weightKg: lbToKg(195), reps: 8, done: true, completedAt: `${key}T17:00:00.000Z` }],
    };
    const days = { ...snapshot.days, [key]: day };
    const p = buildProgress({ days, program: snapshot.program, settings: snapshot.settings.game, todayKey: key, metaFor });
    const bench = p.days[key]?.records.find((r) => r.exerciseId === "barbell-bench-press");
    expect(bench).toMatchObject({ isRecord: true, baseline: false, priorExposures: 2 });
    expect(bench?.previous).toBeGreaterThan(0);
    expect(bench?.current).toBeGreaterThan(bench?.previous ?? Infinity);
  });
});

describe("mergeImport", () => {
  const parsed = parseImport(text(rawMap));

  function current(): SnapshotData {
    const mine = emptyDay();
    mine.workout.notes = "mine";
    const snapshot = empty();
    snapshot.days["2026-01-05"] = mine;
    return snapshot;
  }

  it("missing-only keeps every existing day and adds only the dates not stored yet", () => {
    const merged = mergeImport(current(), parsed, { mode: "missing-only" });
    expect(merged.days["2026-01-05"]?.workout.notes).toBe("mine");
    expect(Object.keys(merged.days)).toHaveLength(7);
    expect(newDayKeys(current(), parsed)).toEqual(["2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-12"]);
  });

  it("replace takes the imported days as the whole log", () => {
    const merged = mergeImport(current(), parsed, { mode: "replace" });
    expect(merged.days["2026-01-05"]?.workout.notes).toBe("solid");
    expect(Object.keys(merged.days)).toHaveLength(7);
  });

  it("keeps the current program unless there is none", () => {
    const withProgram = empty();
    withProgram.program = seed("2026-10-07").program;
    const fromBackup = parseImport(text(backupV1));
    expect(mergeImport(withProgram, fromBackup, { mode: "missing-only" }).program).toBe(withProgram.program);
    expect(mergeImport(empty(), fromBackup, { mode: "missing-only" }).program).toBe(fromBackup.program);
    expect(mergeImport(withProgram, parsed, { mode: "replace" }).program).toBe(withProgram.program);
    expect(mergeImport(withProgram, fromBackup, { mode: "replace" }).program).toBe(fromBackup.program);
  });

  it("patches settings in without lowering a high-water mark, and keeps the later legacy cut-off", () => {
    const snapshot = empty();
    snapshot.settings = normalizeSettings({ ...DEFAULT_SETTINGS, units: "imperial", onboarded: true, game: { importedThrough: "2026-02-01", high: { rank: "C", achievements: ["first_quest"], trialsPassed: [{ rank: "C", date: "2026-01-20" }] } } });
    const incoming = parseImport(text(buildExport({ days: {}, program: null, settings: normalizeSettings({ v: 2, units: "metric", game: { importedThrough: "2026-01-12", high: { rank: "D", achievements: ["calibrated"], trialsPassed: [{ rank: "C", date: "2026-01-20" }] } } }) }, "2026-10-03T00:00:00.000Z")));
    const merged = mergeImport(snapshot, incoming, { mode: "missing-only" });
    expect(merged.settings.units).toBe("metric");
    expect(merged.settings.game.high).toEqual({ rank: "C", achievements: ["first_quest", "calibrated"], trialsPassed: [{ rank: "C", date: "2026-01-20" }] });
    expect(merged.settings.game.importedThrough).toBe("2026-02-01");
    expect(mergeImport(empty(), parsed, { mode: "missing-only" }).settings.game.importedThrough).toBe("2026-01-12");
  });
});

describe("export", () => {
  it("round-trips the app's own backup without loss", () => {
    const today = "2026-10-07";
    const demo = seed(today);
    const snapshot: SnapshotData = { days: demo.days, program: demo.program, settings: normalizeSettings({ ...DEFAULT_SETTINGS, onboarded: true, bodyweightKg: 80, game: demo.settings }) };
    const envelope = buildExport(snapshot, "2026-10-07T08:00:00.000Z");
    expect(envelope).toMatchObject({ format: BACKUP_FORMAT, v: 2, exportedAt: "2026-10-07T08:00:00.000Z" });
    const parsed = parseImport(JSON.stringify(envelope));
    expect(parsed.kind).toBe("backup-v2");
    expect(parsed.counts).toEqual({ days: Object.keys(demo.days).length, skipped: 0 });
    expect(parsed.days).toEqual(demo.days);
    expect(parsed.program).toEqual(demo.program);
    expect(parsed.settings).toEqual(snapshot.settings);
    expect(parsed.warnings).toEqual([]);
    const merged = mergeImport(empty(), parsed, { mode: "replace" });
    expect(merged).toEqual(snapshot);
  });

  it("names the file after the day", () => {
    expect(exportFileName("2026-10-03")).toBe("0vertrained-backup-2026-10-03.json");
    expect(exportFileName(addDays("2026-10-03", 1))).toBe("0vertrained-backup-2026-10-04.json");
  });
});
