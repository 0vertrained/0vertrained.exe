// The guest source: the shared DataSource contract plus what only a
// localStorage envelope has to get right (corruption, quota, v1 shapes).
import { describe, expect, it } from "vitest";
import { lbToKg } from "../domain/units";
import { FullStorage, MemoryStorage } from "../test/memoryStorage";
import { runContractSuite, sampleDay } from "./contractSuite";
import { CORRUPT_SUFFIX, ENVELOPE_VERSION, LOCAL_STORAGE_KEY, STORAGE_FULL_MESSAGE, createLocalSource, isQuotaError } from "./localSource";
import { DEFAULT_SETTINGS } from "./settings";

describe("DataSource contract", () => runContractSuite(() => createLocalSource(new MemoryStorage())));

describe("local source", () => {
  const KEY = "test-key";
  const CORRUPT_KEY = `${KEY}${CORRUPT_SUFFIX}`;

  it("writes one versioned envelope under the key, synchronously", async () => {
    const storage = new MemoryStorage();
    const source = createLocalSource(storage, KEY);
    const pending = source.saveDay("2026-10-05", sampleDay());
    const text = storage.getItem(KEY);
    expect(text).not.toBeNull();
    const envelope = JSON.parse(text as string) as { v: number; savedAt: string; days: Record<string, unknown> };
    expect(envelope.v).toBe(ENVELOPE_VERSION);
    expect(typeof envelope.savedAt).toBe("string");
    expect(Object.keys(envelope.days)).toEqual(["2026-10-05"]);
    expect(storage.keys()).toEqual([KEY]);
    await pending;
  });

  it("uses window.localStorage and the default key by default", async () => {
    const source = createLocalSource();
    expect(source.kind).toBe("local");
    await source.saveDay("2026-10-05", sampleDay());
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEY)).toContain("2026-10-05");
  });

  it("keeps a corrupt envelope under .corrupt and opens empty", async () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, "{not json");
    const source = createLocalSource(storage, KEY);
    expect(await source.load()).toEqual({ days: {}, program: null, settings: DEFAULT_SETTINGS, historyComplete: true });
    expect(storage.getItem(CORRUPT_KEY)).toBe("{not json");
    // The next write starts a fresh envelope; the stash stays.
    await source.saveDay("2026-10-05", sampleDay());
    expect(Object.keys((await source.load()).days)).toEqual(["2026-10-05"]);
    expect(storage.getItem(CORRUPT_KEY)).toBe("{not json");
  });

  it("treats an envelope of the wrong shape as corrupt", async () => {
    for (const text of ['"a string"', "[1,2]", JSON.stringify({ v: 99, days: {} }), JSON.stringify({ v: 1, days: "nope" })]) {
      const storage = new MemoryStorage();
      storage.setItem(KEY, text);
      const snapshot = await createLocalSource(storage, KEY).load();
      expect(snapshot.days).toEqual({});
      expect(storage.getItem(CORRUPT_KEY)).toBe(text);
    }
  });

  it("clear removes the envelope but leaves the corrupt stash in place", async () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, "junk");
    const source = createLocalSource(storage, KEY);
    await source.load();
    await source.saveDay("2026-10-05", sampleDay());
    await source.clear();
    expect(storage.getItem(KEY)).toBeNull();
    expect(storage.getItem(CORRUPT_KEY)).toBe("junk");
  });

  it("rejects with the storage-full message on a quota error", async () => {
    const source = createLocalSource(new FullStorage(), KEY);
    await expect(source.saveDay("2026-10-05", sampleDay())).rejects.toThrow(STORAGE_FULL_MESSAGE);
    await expect(source.saveSettings(DEFAULT_SETTINGS)).rejects.toThrow(/storage is full/);
    await expect(source.saveProgram(null)).rejects.toThrow(/storage is full/);
    await expect(source.replaceAll({ days: {}, program: null, settings: DEFAULT_SETTINGS })).rejects.toThrow(/storage is full/);
  });

  it("recognises every spelling of the quota error and nothing else", () => {
    expect(isQuotaError(new DOMException("full", "QuotaExceededError"))).toBe(true);
    expect(isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED", code: 1014 })).toBe(true);
    expect(isQuotaError({ name: "Whatever", code: 22 })).toBe(true);
    expect(isQuotaError(new Error("boom"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError("QuotaExceededError")).toBe(false);
  });

  it("passes other write errors through unchanged", async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error("read-only");
    };
    await expect(createLocalSource(storage, KEY).saveDay("2026-10-05", sampleDay())).rejects.toThrow("read-only");
  });

  it("normalises v1 day shapes on read", async () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, JSON.stringify({
      v: 1,
      savedAt: "",
      program: null,
      settings: {},
      days: {
        "2026-01-05": {
          body: { sleepQuality: "7", soreness: "11", illnessOrInjury: "true", weight: "180" },
          workout: {
            exercises: { "Back Squat": { sets: [{ weight: "225", reps: "5", done: "true" }, { weight: "", reps: "", done: false }] } },
            cardio: { miles: "3.1", time: "30:00" },
            notes: "felt good",
          },
        },
      },
    }));
    const { days } = await createLocalSource(storage, KEY).load();
    const day = days["2026-01-05"];
    expect(day?.v).toBe(2);
    expect(day?.checkin).toEqual({ sleepQuality: 7, illness: true });
    expect(day?.legacy?.body).toEqual({ soreness: "11", weight: "180" });
    const squat = day?.workout.exercises["Back Squat"];
    expect(squat?.sets[0]).toMatchObject({ id: "s1", reps: 5, done: true });
    expect(squat?.sets[0]?.weightKg).toBeCloseTo(lbToKg(225), 6);
    expect(squat?.sets[1]).toMatchObject({ id: "s2", weightKg: null, reps: null, done: false });
    expect(day?.workout.cardio[0]).toMatchObject({ id: "cardio", minutes: 30, source: "manual" });
    expect(day?.workout.notes).toBe("felt good");
  });

  it("drops entries whose key is not a date and reads settings and program through their normalisers", async () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, JSON.stringify({
      v: 1,
      savedAt: "x",
      days: { "2026-10-05": {}, "not-a-date": {}, "2026-02-30": {} },
      settings: { units: "imperial", session: { restSeconds: "slow" }, bogus: 1 },
      program: { Monday: { type: "Push", lifting: [{ name: "Bench Press", sets: "3", reps: "5" }] } },
    }));
    const snapshot = await createLocalSource(storage, KEY).load();
    expect(Object.keys(snapshot.days)).toEqual(["2026-10-05"]);
    expect(snapshot.days["2026-10-05"]?.v).toBe(2);
    expect(snapshot.settings).toEqual({ ...DEFAULT_SETTINGS, units: "imperial" });
    expect(snapshot.program?.revisions[0]?.source).toBe("imported");
    expect(snapshot.program?.revisions[0]?.week.Monday.lifting[0]?.name).toBe("Bench Press");
    expect(storage.keys()).toEqual([KEY]);
  });
});
