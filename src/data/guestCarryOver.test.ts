// Carrying guest data into an account: only what the account lacks goes up,
// the demo never does, a failed run can be repeated, and the flags behave.
import { describe, expect, it, vi } from "vitest";
import { addDays } from "../domain/dates";
import type { DayMap } from "../domain/day/schema";
import { createFakeSupabase } from "../test/fakeSupabase";
import { threeDayProgram } from "../test/gameFixtures";
import { FullStorage, MemoryStorage } from "../test/memoryStorage";
import { sampleDay, sampleSettings } from "./contractSuite";
import type { DataSource } from "./DataSource";
import {
  GUEST_DEMO_KEY,
  GUEST_UPLOAD_PENDING_KEY,
  carrySettings,
  clearDemo,
  clearGuestUploadPending,
  isDemo,
  isGuestUploadPending,
  markDemo,
  markGuestUploadPending,
  unionHigh,
  uploadGuestData,
} from "./guestCarryOver";
import { createLocalSource } from "./localSource";
import { DEFAULT_SETTINGS, normalizeSettings, patchSettings, type SettingsV2 } from "./settings";
import { createSupabaseSource } from "./supabaseSource";

const START = "2026-10-01";

function days(count: number, seed = 0): DayMap {
  const out: DayMap = {};
  for (let i = 0; i < count; i += 1) out[addDays(START, i)] = sampleDay(seed + i);
  return out;
}

function pair() {
  const storage = new MemoryStorage();
  const local = createLocalSource(new MemoryStorage(), "guest");
  const remote = createLocalSource(new MemoryStorage(), "account");
  return { storage, local, remote };
}

const guestSettings = (): SettingsV2 => patchSettings(sampleSettings(), { profile: { name: "Guest" }, game: { high: { rank: "D", trialsPassed: [{ rank: "D", date: "2026-09-10" }], achievements: ["first-quest", "ten-sets"] } } });

describe("uploadGuestData", () => {
  it("uploads everything into an empty account, then clears the guest store and the pending flag", async () => {
    const { storage, local, remote } = pair();
    markGuestUploadPending(storage);
    await local.replaceAll({ days: days(3), program: threeDayProgram(), settings: guestSettings() });
    const result = await uploadGuestData({ local, remote, storage });
    expect(result).toEqual({ uploadedDays: 3, keptRemote: false });
    const account = await remote.load();
    expect(account.days).toEqual(days(3));
    expect(account.program).toEqual(threeDayProgram());
    expect(account.settings).toEqual(carrySettings(normalizeSettings(undefined), guestSettings()));
    expect(account.settings.onboarded).toBe(true);
    expect((await local.load()).days).toEqual({});
    expect(isGuestUploadPending(storage)).toBe(false);
  });

  it("uploads only the dates the account lacks and keeps its program and onboarded settings", async () => {
    const { storage, local, remote } = pair();
    const accountProgram = { ...threeDayProgram(), legacy: { from: "account" } };
    await remote.replaceAll({ days: { "2026-10-02": sampleDay(50), "2026-10-04": sampleDay(51) }, program: accountProgram, settings: sampleSettings() });
    await local.replaceAll({ days: days(5), program: threeDayProgram(), settings: guestSettings() });
    const saveDay = vi.spyOn(remote, "saveDay");
    const result = await uploadGuestData({ local, remote, storage });
    expect(result).toEqual({ uploadedDays: 3, keptRemote: true });
    expect(saveDay.mock.calls.map(([key]) => key)).toEqual(["2026-10-01", "2026-10-03", "2026-10-05"]);
    const account = await remote.load();
    expect(account.days["2026-10-02"]).toEqual(sampleDay(50));
    expect(account.days["2026-10-04"]).toEqual(sampleDay(51));
    expect(Object.keys(account.days)).toHaveLength(5);
    expect(account.program).toEqual(accountProgram);
    expect(account.settings).toEqual(sampleSettings());
  });

  it("uploads in chunks of 50 and reports progress after each", async () => {
    const { storage, local, remote } = pair();
    await local.replaceAll({ days: days(120), program: null, settings: DEFAULT_SETTINGS });
    const progress: [number, number][] = [];
    const saveDay = vi.spyOn(remote, "saveDay");
    const result = await uploadGuestData({ local, remote, storage, onProgress: (p) => progress.push([p.done, p.total]) });
    expect(result.uploadedDays).toBe(120);
    expect(saveDay).toHaveBeenCalledTimes(120);
    expect(progress).toEqual([[0, 120], [50, 120], [100, 120], [120, 120]]);
    expect(Object.keys((await remote.load()).days)).toHaveLength(120);
  });

  it("carries the guest's settings into an account that is not onboarded, never lowering game.high", async () => {
    const { storage, local, remote } = pair();
    const account = patchSettings(normalizeSettings(undefined), { profile: { name: "Account" }, game: { high: { rank: "C", achievements: ["first-quest", "streak-7"] } } });
    await remote.saveSettings(account);
    await local.replaceAll({ days: {}, program: null, settings: guestSettings() });
    await uploadGuestData({ local, remote, storage });
    const settings = (await remote.load()).settings;
    expect(settings).toMatchObject({ units: "imperial", bodyweightKg: 82.5, onboarded: true, session: { restSeconds: 120, sound: false } });
    expect(settings.profile).toEqual({ name: "Account" });
    expect(settings.game).toEqual({
      title: "Initiate",
      startedOn: "2026-08-01",
      high: { rank: "C", trialsPassed: [{ rank: "D", date: "2026-09-10" }], achievements: ["first-quest", "streak-7", "ten-sets"] },
    });
  });

  it("skips the demo character: nothing uploaded, guest store and flags untouched", async () => {
    const { storage, local, remote } = pair();
    markGuestUploadPending(storage);
    markDemo(storage);
    await local.replaceAll({ days: days(2), program: threeDayProgram(), settings: guestSettings() });
    const load = vi.spyOn(remote, "load");
    const result = await uploadGuestData({ local, remote, storage });
    expect(result).toEqual({ uploadedDays: 0, keptRemote: true, skipped: "demo" });
    expect(load).not.toHaveBeenCalled();
    expect(Object.keys((await local.load()).days)).toHaveLength(2);
    expect((await remote.load()).days).toEqual({});
    expect(isGuestUploadPending(storage)).toBe(true);
    expect(isDemo(storage)).toBe(true);
  });

  it("is idempotent: after a failure midway, a second run uploads only what is still missing", async () => {
    const { storage, local, remote } = pair();
    markGuestUploadPending(storage);
    await local.replaceAll({ days: days(5), program: threeDayProgram(), settings: guestSettings() });
    const flaky: DataSource = {
      ...remote,
      saveDay: (key, day) => (key === "2026-10-03" ? Promise.reject(new Error("offline")) : remote.saveDay(key, day)),
    };
    await expect(uploadGuestData({ local, remote: flaky, storage })).rejects.toThrow("offline");
    expect(Object.keys((await local.load()).days)).toHaveLength(5);
    expect(isGuestUploadPending(storage)).toBe(true);
    expect(Object.keys((await remote.load()).days).sort()).toEqual(["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05"]);
    const saveDay = vi.spyOn(remote, "saveDay");
    const result = await uploadGuestData({ local, remote, storage });
    expect(result).toEqual({ uploadedDays: 1, keptRemote: true });
    expect(saveDay.mock.calls.map(([key]) => key)).toEqual(["2026-10-03"]);
    const account = await remote.load();
    expect(account.days).toEqual(days(5));
    expect(account.program).toEqual(threeDayProgram());
    expect(Object.keys((await local.load()).days)).toHaveLength(0);
    expect(isGuestUploadPending(storage)).toBe(false);
  });

  it("works against the Supabase source", async () => {
    const storage = new MemoryStorage();
    const local = createLocalSource(new MemoryStorage(), "guest");
    const fake = createFakeSupabase({ userId: "u1" });
    const remote = createSupabaseSource(fake, "u1");
    await local.replaceAll({ days: days(60), program: threeDayProgram(), settings: guestSettings() });
    const result = await uploadGuestData({ local, remote, storage });
    expect(result).toEqual({ uploadedDays: 60, keptRemote: false });
    expect(fake.tables.entries).toHaveLength(60);
    expect(fake.tables.program).toHaveLength(1);
    expect((await remote.load()).settings.units).toBe("imperial");
  });

  it("uses window.localStorage by default", async () => {
    const local = createLocalSource(new MemoryStorage(), "guest");
    const remote = createLocalSource(new MemoryStorage(), "account");
    markDemo();
    expect(window.localStorage.getItem(GUEST_DEMO_KEY)).toBe("1");
    expect((await uploadGuestData({ local, remote })).skipped).toBe("demo");
    clearDemo();
    markGuestUploadPending();
    expect(window.localStorage.getItem(GUEST_UPLOAD_PENDING_KEY)).toBe("1");
    await uploadGuestData({ local, remote });
    expect(window.localStorage.getItem(GUEST_UPLOAD_PENDING_KEY)).toBeNull();
  });
});

describe("flags", () => {
  it("mark, read and clear each flag independently", () => {
    const storage = new MemoryStorage();
    expect(isGuestUploadPending(storage)).toBe(false);
    expect(isDemo(storage)).toBe(false);
    markGuestUploadPending(storage);
    expect(isGuestUploadPending(storage)).toBe(true);
    expect(isDemo(storage)).toBe(false);
    markDemo(storage);
    expect(isDemo(storage)).toBe(true);
    clearGuestUploadPending(storage);
    expect(isGuestUploadPending(storage)).toBe(false);
    expect(isDemo(storage)).toBe(true);
    clearDemo(storage);
    expect(isDemo(storage)).toBe(false);
    expect(storage.keys()).toEqual([]);
  });

  it("tolerates storage that throws", () => {
    const full = new FullStorage();
    expect(() => markGuestUploadPending(full)).not.toThrow();
    expect(isGuestUploadPending(full)).toBe(false);
    const broken = { ...new MemoryStorage(), getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(isDemo(broken)).toBe(false);
    expect(() => clearDemo(broken)).not.toThrow();
  });
});

describe("unionHigh", () => {
  it("takes the higher rank, the earliest date per trial rank and every achievement once", () => {
    expect(unionHigh(
      { rank: "D", trialsPassed: [{ rank: "D", date: "2026-09-10" }, { rank: "C", date: "2026-09-20" }], achievements: ["a", "b"] },
      { rank: "B", trialsPassed: [{ rank: "D", date: "2026-09-01" }], achievements: ["b", "c"] },
    )).toEqual({ rank: "B", trialsPassed: [{ rank: "D", date: "2026-09-01" }, { rank: "C", date: "2026-09-20" }], achievements: ["a", "b", "c"] });
  });

  it("returns the one side given, and only the keys either side had", () => {
    expect(unionHigh(undefined, undefined)).toBeUndefined();
    expect(unionHigh({ rank: "C" }, undefined)).toEqual({ rank: "C" });
    expect(unionHigh(undefined, { achievements: ["a"] })).toEqual({ achievements: ["a"] });
    expect(unionHigh({ rank: "C" }, { achievements: ["a"] })).toEqual({ rank: "C", achievements: ["a"] });
  });
});
