// The behaviour every DataSource must have, as a reusable vitest suite. The
// local source runs it today; the Supabase source runs the same suite later,
// so both are known to agree before the app can switch between them.

import { beforeEach, expect, it } from "vitest";
import { emptyDay, type DayV2 } from "../domain/day/schema";
import type { ProgramPayloadV2 } from "../domain/program/types";
import { threeDayProgram } from "../test/gameFixtures";
import type { DataSource } from "./DataSource";
import { DEFAULT_SETTINGS, normalizeSettings, patchSettings, type SettingsV2 } from "./settings";

export function sampleDay(seedValue = 1): DayV2 {
  const day = emptyDay();
  day.checkin = { sleepQuality: 7, soreness: 3, energy: 8 };
  day.workout.exercises.squat = {
    name: "Back Squat",
    libraryId: "back-squat",
    trackingMode: "loaded_reps",
    sets: [
      { id: "s1", weightKg: 60 + seedValue, reps: 5, done: true, completedAt: "2026-10-01T10:00:00.000Z" },
      { id: "s2", weightKg: 60 + seedValue, reps: 5, done: false },
    ],
  };
  day.workout.cardio = [{ id: "c1", kind: "Easy Walk", minutes: 20, km: null, source: "manual" }];
  return day;
}

export function sampleSettings(): SettingsV2 {
  return patchSettings(normalizeSettings(undefined), {
    units: "imperial",
    bodyweightKg: 82.5,
    onboarded: true,
    profile: { name: "Ana" },
    session: { restSeconds: 120, sound: false },
    game: { title: "Initiate", startedOn: "2026-08-01", pauses: [{ from: "2026-09-01", to: "2026-09-03", reason: "travel" }], high: { rank: "D", achievements: ["first-quest"] } },
  });
}

/**
 * Runs the contract against a fresh source per test. `make` must return a
 * source over empty storage each time it is called.
 */
export function runContractSuite(make: () => DataSource | Promise<DataSource>): void {
  let source: DataSource;
  const program: ProgramPayloadV2 = threeDayProgram();

  beforeEach(async () => {
    source = await make();
  });

  it("loads an empty snapshot before anything is saved", async () => {
    const snapshot = await source.load();
    expect(snapshot.days).toEqual({});
    expect(snapshot.program).toBeNull();
    expect(snapshot.settings).toEqual(DEFAULT_SETTINGS);
    expect(typeof snapshot.historyComplete).toBe("boolean");
  });

  it("round-trips days, keyed by date", async () => {
    const monday = sampleDay(1);
    const tuesday = sampleDay(2);
    await source.saveDay("2026-10-05", monday);
    await source.saveDay("2026-10-06", tuesday);
    const { days } = await source.load();
    expect(Object.keys(days).sort()).toEqual(["2026-10-05", "2026-10-06"]);
    expect(days["2026-10-05"]).toEqual(monday);
    expect(days["2026-10-06"]).toEqual(tuesday);
  });

  it("overwrites a day saved again", async () => {
    await source.saveDay("2026-10-05", sampleDay(1));
    const edited = sampleDay(5);
    await source.saveDay("2026-10-05", edited);
    const { days } = await source.load();
    expect(days["2026-10-05"]).toEqual(edited);
    expect(Object.keys(days)).toHaveLength(1);
  });

  it("deletes a day and tolerates deleting one that is not there", async () => {
    await source.saveDay("2026-10-05", sampleDay(1));
    await source.saveDay("2026-10-06", sampleDay(2));
    await source.deleteDay("2026-10-05");
    await expect(source.deleteDay("2026-01-01")).resolves.toBeUndefined();
    const { days } = await source.load();
    expect(Object.keys(days)).toEqual(["2026-10-06"]);
  });

  it("round-trips the program, including clearing it", async () => {
    await source.saveProgram(program);
    expect((await source.load()).program).toEqual(program);
    await source.saveProgram(null);
    expect((await source.load()).program).toBeNull();
  });

  it("round-trips the settings", async () => {
    const settings = sampleSettings();
    await source.saveSettings(settings);
    expect((await source.load()).settings).toEqual(settings);
  });

  it("keeps each piece independent of the others", async () => {
    await source.saveDay("2026-10-05", sampleDay(1));
    await source.saveProgram(program);
    await source.saveSettings(sampleSettings());
    await source.saveDay("2026-10-06", sampleDay(2));
    const snapshot = await source.load();
    expect(Object.keys(snapshot.days)).toHaveLength(2);
    expect(snapshot.program).toEqual(program);
    expect(snapshot.settings).toEqual(sampleSettings());
  });

  it("replaceAll swaps everything at once", async () => {
    await source.saveDay("2026-10-05", sampleDay(1));
    await source.saveProgram(program);
    const settings = sampleSettings();
    await source.replaceAll({ days: { "2026-11-01": sampleDay(9) }, program: null, settings });
    const snapshot = await source.load();
    expect(Object.keys(snapshot.days)).toEqual(["2026-11-01"]);
    expect(snapshot.program).toBeNull();
    expect(snapshot.settings).toEqual(settings);
  });

  it("clear leaves an empty snapshot", async () => {
    await source.saveDay("2026-10-05", sampleDay(1));
    await source.saveProgram(program);
    await source.saveSettings(sampleSettings());
    await source.clear();
    const snapshot = await source.load();
    expect(snapshot.days).toEqual({});
    expect(snapshot.program).toBeNull();
    expect(snapshot.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("reads days back through the normaliser (ids filled in, junk coerced)", async () => {
    const day = sampleDay(1);
    const loose = { ...day, workout: { ...day.workout, exercises: { squat: { ...day.workout.exercises.squat, sets: [{ weightKg: "70", reps: 5, done: "yes" }] } } } };
    await source.saveDay("2026-10-05", loose as unknown as DayV2);
    const { days } = await source.load();
    expect(days["2026-10-05"]?.workout.exercises.squat?.sets[0]).toMatchObject({ id: "s1", weightKg: 70, reps: 5, done: false });
  });
}
