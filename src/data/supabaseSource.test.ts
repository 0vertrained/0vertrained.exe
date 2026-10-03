// The signed-in source over the in-memory Supabase fake: the shared
// DataSource contract plus what only a remote store has to get right
// (paging, failures that must not read as empty data, the save_day
// conflict dance, chunked imports, other users' rows).
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { DayV2 } from "../domain/day/schema";
import { createFakeSupabase, type FakeSupabase } from "../test/fakeSupabase";
import { threeDayProgram } from "../test/gameFixtures";
import { runContractSuite, sampleDay, sampleSettings } from "./contractSuite";
import { DEFAULT_SETTINGS, patchSettings } from "./settings";
import { CONFLICT_MESSAGE, UNKNOWN_BASE, createSupabaseSource, settingsPatch, type DayMerge, type SupabaseSource } from "./supabaseSource";
import type { DbClient, Row } from "./supabaseTypes";

const USER = "u1";
const OTHER = "u2";
const DAY = "2026-10-05";

describe("DataSource contract", () => runContractSuite(() => createSupabaseSource(createFakeSupabase({ userId: USER }), USER)));

/** `count` consecutive days from 2020-01-01 as entry rows for `userId`. */
function seedEntries(fake: FakeSupabase, userId: string, count: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(2020, 0, 1 + i));
    const key = d.toISOString().slice(0, 10);
    keys.push(key);
    fake.tables.entries.push({ user_id: userId, entry_date: key, payload: sampleDay(i), updated_at: fake.tick() });
  }
  return keys;
}

const withSet = (day: DayV2, id: string, weightKg: number): DayV2 => {
  const squat = day.workout.exercises.squat ?? { name: "Back Squat", sets: [] };
  return { ...day, workout: { ...day.workout, exercises: { ...day.workout.exercises, squat: { ...squat, sets: [...squat.sets, { id, weightKg, reps: 5, done: true }] } } } };
};

const ops = (fake: FakeSupabase, op: string) => fake.calls.filter((c) => c.op === op);

describe("supabase source", () => {
  it("accepts the real supabase-js client as a DbClient (a compile-time check; the type import is erased)", () => {
    const check = (real: SupabaseClient): DbClient => real;
    expect(typeof check).toBe("function");
  });

  it("pages through 2,300 entries until a short page and loads them all", async () => {
    const fake = createFakeSupabase({ userId: USER });
    const keys = seedEntries(fake, USER, 2300);
    const source = createSupabaseSource(fake, USER);
    expect(source.kind).toBe("supabase");
    const snapshot = await source.load();
    expect(Object.keys(snapshot.days)).toHaveLength(2300);
    expect(snapshot.days[keys[1234] ?? ""]).toEqual(sampleDay(1234));
    expect(snapshot.historyComplete).toBe(true);
    const selects = ops(fake, "entries.select");
    expect(selects).toHaveLength(3);
    expect(selects.map((c) => (c.args as { range: [number, number] }).range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(source.lastLoad).toEqual({ days: 2300, pages: 3, skipped: 0 });
  });

  it("honours a custom page size and stops after an exact multiple", async () => {
    const fake = createFakeSupabase({ userId: USER });
    seedEntries(fake, USER, 20);
    const source = createSupabaseSource(fake, USER, { pageSize: 10 });
    const snapshot = await source.load();
    expect(Object.keys(snapshot.days)).toHaveLength(20);
    expect(ops(fake, "entries.select")).toHaveLength(3);
  });

  it("rejects the load (never defaults) when entries, program or profile fail", async () => {
    for (const failing of ["entries.select", "program.select", "profiles.select"]) {
      const fake = createFakeSupabase({ userId: USER, failNext: (op) => (op === failing ? { message: `${failing} is down`, code: "08006" } : null) });
      seedEntries(fake, USER, 2);
      const source = createSupabaseSource(fake, USER);
      await expect(source.load()).rejects.toThrow(`${failing} is down`);
    }
  });

  it("loads default settings (not an error) when there is no profile row", async () => {
    const fake = createFakeSupabase({ userId: USER });
    fake.tables.profiles.length = 0;
    const source = createSupabaseSource(fake, USER);
    const snapshot = await createSupabaseSource(fake, USER).load();
    expect(snapshot.settings).toEqual(DEFAULT_SETTINGS);
    // Writing settings is another matter: the server refuses, as it would.
    await expect(source.saveSettings(sampleSettings())).rejects.toThrow("NO_PROFILE");
  });

  it("skips and counts rows whose entry_date is not a date key", async () => {
    const fake = createFakeSupabase({ userId: USER });
    seedEntries(fake, USER, 2);
    fake.tables.entries.push({ user_id: USER, entry_date: "junk", payload: sampleDay(), updated_at: fake.tick() });
    const source = createSupabaseSource(fake, USER);
    const snapshot = await source.load();
    expect(Object.keys(snapshot.days)).toHaveLength(2);
    expect(source.lastLoad?.skipped).toBe(1);
  });

  it("sends the loaded updated_at as the base, then the stamp its own write got", async () => {
    const fake = createFakeSupabase({ userId: USER });
    seedEntries(fake, USER, 1);
    const loaded = fake.tables.entries[0]?.updated_at;
    const source = createSupabaseSource(fake, USER);
    await source.load();
    await source.saveDay("2020-01-01", sampleDay(7));
    const written = fake.tables.entries[0]?.updated_at;
    await source.saveDay("2020-01-01", sampleDay(8));
    const bases = ops(fake, "rpc.save_day").map((c) => (c.args as { p_base: string }).p_base);
    expect(bases).toEqual([loaded, written]);
    expect(written).not.toBe(loaded);
  });

  it("sends the epoch as the base for a day it has never seen, never null (which the server would overwrite with)", async () => {
    const fake = createFakeSupabase({ userId: USER });
    const source = createSupabaseSource(fake, USER);
    await source.saveDay(DAY, sampleDay());
    expect(ops(fake, "rpc.save_day").map((c) => (c.args as { p_base: unknown }).p_base)).toEqual([UNKNOWN_BASE]);
    expect(fake.tables.entries).toHaveLength(1);
  });

  it("merges ours with the server copy on a conflict and lands the union", async () => {
    const fake = createFakeSupabase({ userId: USER });
    const merges: DayMerge[] = [];
    const deviceA = createSupabaseSource(fake, USER, { onMerge: (m) => merges.push(m) });
    const deviceB = createSupabaseSource(fake, USER);
    await deviceA.saveDay(DAY, sampleDay(1));
    await deviceA.load();
    await deviceB.load();
    await deviceB.saveDay(DAY, withSet(sampleDay(1), "s3", 70)); // the other device adds a set
    const ours = withSet(sampleDay(1), "s9", 90);
    await deviceA.saveDay(DAY, ours);
    const stored = fake.tables.entries[0]?.payload as DayV2;
    expect(stored.workout.exercises.squat?.sets.map((s) => s.id)).toEqual(["s1", "s2", "s9", "s3"]);
    expect(merges).toHaveLength(1);
    expect(merges[0]?.dateKey).toBe(DAY);
    expect(merges[0]?.merged).toEqual(stored);
    expect(deviceA.lastMerge).toBe(merges[0]);
    expect(ops(fake, "rpc.save_day").map((c) => (c.args as { p_date: string }).p_date)).toHaveLength(4);
    // The merged copy is now the base: the next write needs no retry.
    await deviceA.saveDay(DAY, withSet(stored, "s10", 95));
    expect(ops(fake, "rpc.save_day")).toHaveLength(5);
  });

  it("rejects with conflict after a second conflict and keeps the server's version as the base", async () => {
    const fake = createFakeSupabase({ userId: USER });
    const merges: DayMerge[] = [];
    const deviceA = createSupabaseSource(fake, USER, { onMerge: (m) => merges.push(m) });
    const deviceB = createSupabaseSource(fake, USER);
    await deviceA.saveDay(DAY, sampleDay(1));
    await deviceA.load();
    await deviceB.load();
    await deviceB.saveDay(DAY, withSet(sampleDay(1), "s3", 70));
    // Device B writes again between A's first attempt and its retry.
    const rpc = fake.rpc.bind(fake);
    let saves = 0;
    vi.spyOn(fake, "rpc").mockImplementation((fn, args) => {
      saves += fn === "save_day" ? 1 : 0;
      if (fn === "save_day" && saves === 2) fake.tables.entries[0] = { ...(fake.tables.entries[0] as Row), payload: withSet(sampleDay(1), "s4", 72), updated_at: fake.tick() };
      return rpc(fn, args);
    });
    await expect(deviceA.saveDay(DAY, withSet(sampleDay(1), "s9", 90))).rejects.toThrow(CONFLICT_MESSAGE);
    const server = fake.tables.entries[0] as Row;
    expect((server.payload as DayV2).workout.exercises.squat?.sets.map((s) => s.id)).toEqual(["s1", "s2", "s4"]);
    // The provider was handed everything merged, so the queued retry loses nothing...
    expect(merges.at(-1)?.merged.workout.exercises.squat?.sets.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s9", "s4"]);
    // ...and the retry carries the server's stamp, so it lands first time.
    await deviceA.saveDay(DAY, merges.at(-1)?.merged as DayV2);
    const bases = ops(fake, "rpc.save_day").map((c) => (c.args as { p_base: string | null }).p_base);
    expect(bases.at(-1)).toBe(server.updated_at);
    expect(ops(fake, "rpc.save_day")).toHaveLength(5);
  });

  it("treats a day another device created since the load as a conflict to merge, not to overwrite", async () => {
    const fake = createFakeSupabase({ userId: USER });
    const deviceA = createSupabaseSource(fake, USER);
    const deviceB = createSupabaseSource(fake, USER);
    await deviceA.load();
    await deviceB.saveDay(DAY, withSet(sampleDay(1), "s3", 70));
    await deviceA.saveDay(DAY, withSet(sampleDay(1), "s9", 90));
    const stored = fake.tables.entries[0]?.payload as DayV2;
    expect(stored.workout.exercises.squat?.sets.map((s) => s.id)).toEqual(["s1", "s2", "s9", "s3"]);
  });

  it("rejects an unexpected save_day response", async () => {
    const fake = createFakeSupabase({ userId: USER });
    vi.spyOn(fake, "rpc").mockImplementation(async () => ({ data: { nope: true }, error: null }));
    await expect(createSupabaseSource(fake, USER).saveDay(DAY, sampleDay())).rejects.toThrow("unexpected response");
  });

  it("saves settings as a full replace: a cleared optional key is removed on the server", async () => {
    const fake = createFakeSupabase({ userId: USER });
    const source = createSupabaseSource(fake, USER);
    await source.saveSettings(sampleSettings());
    const trimmed = patchSettings(sampleSettings(), { bodyweightKg: undefined, profile: { name: undefined }, game: { title: undefined, pauses: undefined, high: undefined } });
    await source.saveSettings(trimmed);
    expect((await source.load()).settings).toEqual(trimmed);
    const stored = fake.tables.profiles[0]?.settings as Record<string, unknown>;
    expect(stored).not.toHaveProperty("bodyweightKg");
    expect(stored.profile).toEqual({});
    expect(stored.game).toEqual({ startedOn: "2026-08-01" });
  });

  it("sends null for every absent optional key so the server deletes it", () => {
    expect(settingsPatch(DEFAULT_SETTINGS)).toEqual({
      v: 2,
      units: "metric",
      bodyweightKg: null,
      onboarded: false,
      profile: { name: null, featuredTitle: null },
      session: { restSeconds: 90, sound: true, haptics: true, cues: true },
      game: { title: null, bodyweightKg: null, startedOn: null, importedThrough: null, pauses: null, high: null },
    });
  });

  it("leaves keys it does not know in the stored settings (ignored on read)", async () => {
    const fake = createFakeSupabase({ userId: USER });
    fake.tables.profiles[0] = { id: USER, username: "ana", settings: { legacyTheme: "dark", units: "imperial" }, updated_at: fake.tick() };
    const source = createSupabaseSource(fake, USER);
    await source.saveSettings(sampleSettings());
    expect(fake.tables.profiles[0]?.settings).toMatchObject({ legacyTheme: "dark", units: "imperial" });
    expect(fake.tables.profiles[0]?.username).toBe("ana");
    expect((await source.load()).settings).toEqual(sampleSettings());
  });

  it("replaceAll upserts days in chunks of 50 and refreshes the bases", async () => {
    const fake = createFakeSupabase({ userId: USER });
    seedEntries(fake, USER, 3);
    const source = createSupabaseSource(fake, USER);
    await source.load();
    const days = Object.fromEntries(seedEntries(createFakeSupabase({ userId: USER }), USER, 120).map((key, i) => [key, sampleDay(i)]));
    await source.replaceAll({ days, program: threeDayProgram(), settings: sampleSettings() });
    const upserts = ops(fake, "entries.upsert");
    expect(upserts).toHaveLength(3);
    expect(upserts.map((c) => (c.args as unknown[]).length)).toEqual([50, 50, 20]);
    expect(upserts[0]?.args).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: USER, entry_date: "2020-01-01" })]));
    expect(fake.tables.entries).toHaveLength(120);
    const snapshot = await source.load();
    expect(Object.keys(snapshot.days)).toHaveLength(120);
    expect(snapshot.program).toEqual(threeDayProgram());
    // The first edit of an imported day needs no conflict round trip.
    fake.calls.length = 0;
    await source.saveDay("2020-01-10", sampleDay(99));
    expect(ops(fake, "rpc.save_day")).toHaveLength(1);
  });

  it("never sees or touches another user's rows", async () => {
    const fake = createFakeSupabase({ userId: USER });
    const theirs = createFakeSupabase({ userId: OTHER });
    seedEntries(theirs, OTHER, 5);
    fake.tables.entries.push(...theirs.tables.entries);
    fake.tables.program.push({ user_id: OTHER, payload: threeDayProgram(), updated_at: fake.tick() });
    fake.tables.profiles.push({ id: OTHER, username: "bo", settings: sampleSettings(), updated_at: fake.tick() });
    const source = createSupabaseSource(fake, USER);
    const empty = await source.load();
    expect(empty.days).toEqual({});
    expect(empty.program).toBeNull();
    expect(empty.settings).toEqual(DEFAULT_SETTINGS);
    await source.saveDay(DAY, sampleDay());
    await source.clear();
    await source.replaceAll({ days: {}, program: null, settings: DEFAULT_SETTINGS });
    expect(fake.tables.entries.filter((r) => r.user_id === OTHER)).toHaveLength(5);
    expect(fake.tables.program.filter((r) => r.user_id === OTHER)).toHaveLength(1);
    expect(fake.tables.profiles.find((r) => r.id === OTHER)?.settings).toEqual(sampleSettings());
  });

  it.each<[string, string, (s: SupabaseSource) => Promise<void>]>([
    ["saveDay", "rpc.save_day", (s) => s.saveDay(DAY, sampleDay())],
    ["deleteDay", "entries.delete", (s) => s.deleteDay(DAY)],
    ["saveProgram", "program.upsert", (s) => s.saveProgram(threeDayProgram())],
    ["saveProgram(null)", "program.delete", (s) => s.saveProgram(null)],
    ["saveSettings", "rpc.patch_settings", (s) => s.saveSettings(sampleSettings())],
    ["replaceAll", "entries.upsert", (s) => s.replaceAll({ days: { [DAY]: sampleDay() }, program: null, settings: sampleSettings() })],
    ["clear", "entries.delete", (s) => s.clear()],
  ])("%s rejects with the server's message when %s fails", async (_name, op, run) => {
    const fake = createFakeSupabase({ userId: USER, failNext: (o) => (o === op ? { message: "permission denied for table", code: "42501" } : null) });
    const source = createSupabaseSource(fake, USER);
    await expect(run(source)).rejects.toMatchObject({ message: "permission denied for table", cause: { code: "42501" } });
  });

  it("lets a thrown network error pass through", async () => {
    const fake = createFakeSupabase({ userId: USER });
    const offline = new TypeError("Failed to fetch");
    vi.spyOn(fake, "rpc").mockImplementation(() => Promise.reject(offline));
    await expect(createSupabaseSource(fake, USER).saveDay(DAY, sampleDay())).rejects.toBe(offline);
  });

  it("clear removes days and program and resets the settings, keeping the profile row", async () => {
    const fake = createFakeSupabase({ userId: USER });
    fake.tables.profiles[0] = { id: USER, username: "ana", settings: { units: "imperial", stale: 1 }, updated_at: fake.tick() };
    const source = createSupabaseSource(fake, USER);
    await source.saveDay(DAY, sampleDay());
    await source.saveProgram(threeDayProgram());
    await source.clear();
    expect(fake.tables.entries).toEqual([]);
    expect(fake.tables.program).toEqual([]);
    expect(fake.tables.profiles[0]).toMatchObject({ username: "ana", settings: { stale: 1 } });
    expect((await source.load()).settings).toEqual(DEFAULT_SETTINGS);
  });
});
