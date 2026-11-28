import { expect, it, vi } from "vitest";
import { entryBackupError, restoreEntryBackup, entryStatsCsv } from "../entryBackup";
import { buildDemoEntries } from "../demoData";
import { backupSession, clearCachedUserId, setCachedUserId, importEntries } from "../data";

const db = vi.hoisted(() => ({ upsert: vi.fn(async () => ({ error: null })) }));
vi.mock("../supabaseClient", () => ({ supabase: { from: () => db } }));

it("preserves zero and ordinary numeric strings, protects spreadsheet text and escapes multiline fields", () => {
  const csv = entryStatsCsv({
    "2026-02-09": { body: { energy: 0, weight: "172.00", sleep: '6, then "7"\nnext line' },
      nutrition: { calories: 0, protein: " =1+1" }, workout: { cardio: { miles: 0 } } },
  });
  expect(csv.split("\r\n")[1]).toBe('2026-02-09,172.00,0,\' =1+1,,,,"6, then ""7""\nnext line",0,,0,No');
});

it("validates the entire date map before making an account write, including in demo", async () => {
  const oldDay = { body: { weight: "198" }, workout: { exercises: { Curl: { sets: [{ reps: 3 }] } } }, customData: { v: 9 } };
  setCachedUserId("a");
  const invalid = [null, [], {}, { "2026-02-30": {} }, { "2026-02-10": [] },
    { "2026-02-10": { nutrition: { meals: "invalid" } } }, { "2026-02-10": { workout: { exercises: { Curl: { sets: "invalid" } } } } },
    JSON.parse('{"2026-02-10":{"customData":{"__proto__":{"flag":true}}}}'), { "2026-02-09": oldDay, typo: oldDay }];
  for (const value of invalid) {
    expect(entryBackupError(value)).toBeTruthy();
    expect((await importEntries(value, "a")).error).toBeTruthy();
  }
  expect(db.upsert).not.toHaveBeenCalled();
  const valid = { "2026-02-09": oldDay, "2024-02-29": {} };
  expect(entryBackupError(valid)).toBeNull();
  expect((await importEntries(valid, "a")).count).toBe(2);
  expect(db.upsert.mock.lastCall[0][0]).toEqual({ user_id: "a", entry_date: "2026-02-09", payload: oldDay });
  expect((await importEntries(valid, "b")).error).toBeTruthy();
});

it("invalidates transfers across account switches, including a return to the initial athlete", () => {
  setCachedUserId("a");
  const current = backupSession("a");
  setCachedUserId("a");
  expect(current()).toBe(true);
  setCachedUserId("b");
  expect(current()).toBe(false);
  setCachedUserId("a");
  expect(current()).toBe(false);
  const second = backupSession("a");
  clearCachedUserId();
  expect(second()).toBe(false);
});


it("accepts the 140-day app-generated backup and preserves older sparse sets at the same indexes", () => {
  const demo = JSON.parse(JSON.stringify(buildDemoEntries()));
  expect(Object.keys(demo)).toHaveLength(140);
  expect(entryBackupError(demo)).toBeNull();
  expect(restoreEntryBackup(demo)).toEqual(demo);
  const old = { "2025-01-02": { workout: { exercises: { Curl: { sets: [null, {}, { reps: "8", done: true }] } } } } };
  expect(entryBackupError(old)).toBeNull();
  expect(restoreEntryBackup(old)["2025-01-02"].workout.exercises.Curl.sets).toEqual([{ done: false }, {}, { reps: "8", done: true }]);
  expect(old["2025-01-02"].workout.exercises.Curl.sets[0]).toBeNull();
});
