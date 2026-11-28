// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readClimbLibrary, changeClimbLibrary, packActiveClimb } from "../climb/library";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
it("keeps existing fallback workouts when IndexedDB becomes available on a later visit", async () => {
  localStorage.setItem("ot.climb/a/course/prior", JSON.stringify({ revision: "prior" }));
  const open = vi.fn(() => { throw new Error("Unexpected switch of storage"); });
  vi.stubGlobal("indexedDB", { open });
  expect((await readClimbLibrary("a")).courses).toEqual([{ revision: "prior" }]);
  expect(open).not.toHaveBeenCalled();
});

it("retains both course downloads needed by another window's active section workout", async () => {
  const current = { revision: "section", run: { id: "repeat", owner: "a" },
    previousAttempts: [{ revision: "original", run: { id: "first", owner: "a" } }] };
  await changeClimbLibrary("a", [["course/section", { revision: "section" }],
    ["course/original", { revision: "original" }], ["active", current]]);
  for (const revision of ["original", "section"]) {
    await expect(changeClimbLibrary("a", [["course/" + revision, null]])).rejects.toThrow(/finish/i);
  }
  expect((await readClimbLibrary("a")).active.previousAttempts).toHaveLength(1);
  await changeClimbLibrary("a", [["active", null]]);
  await changeClimbLibrary("a", [["course/original", null]]);
  expect((await readClimbLibrary("a")).courses.map(c => c.revision)).toEqual(["section"]);
});

it("keeps a failed multi-attempt local save from exposing a partially saved history", async () => {
  const row = { run: { id: "old", owner: "a" }, revision: "s" };
  await changeClimbLibrary("a", [["course/s", { revision: "s" }], ["active", row]]);
  const setItem = Storage.prototype.setItem;
  const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(key, value) {
    if (key.endsWith("/result/new")) throw new DOMException("Full", "QuotaExceededError");
    return setItem.call(this, key, value);
  });
  try {
    await expect(changeClimbLibrary("a", [["result/old", row], ["result/new", row], ["active", null]], "old")).rejects.toThrow();
  } finally { full.mockRestore(); }
  expect(await readClimbLibrary("a")).toMatchObject({ results: [], active: row });
});
it("keeps a newer recording if a second window tries to update or clear a stale one", async () => {
  const row = { run: { id: "attempt1", owner: "a" }, revision: "s", journalToken: "first" };
  await changeClimbLibrary("a", [["course/s", { revision: "s" }], ["active", row]], null);
  await changeClimbLibrary("a", [["active", { ...row, journalToken: "second" }]], "first");
  await expect(changeClimbLibrary("a", [["active", null]], "first")).rejects.toThrow(/another window/);
  expect((await readClimbLibrary("a")).active.journalToken).toBe("second");
  await changeClimbLibrary("a", [["active", null]], "second");
  expect((await readClimbLibrary("a")).active).toBeNull();
});
it("uses a sticky fallback when a fresh browser advertises IndexedDB but refuses to open it", async () => {
  vi.stubGlobal("indexedDB", { open() { throw new DOMException("Storage disabled", "SecurityError"); } });
  await changeClimbLibrary("a", [["course/s", { revision: "s" }]]);
  expect(localStorage.getItem("0vertrained-climbs-v1-driver")).toBe("local");
  expect((await readClimbLibrary("a")).courses).toEqual([{ revision: "s" }]);
});
it("preserves an existing database choice during a temporary outage", async () => {
  localStorage.setItem("0vertrained-climbs-v1-driver", "indexedDB");
  vi.stubGlobal("indexedDB", undefined);
  await expect(readClimbLibrary("a")).rejects.toThrow(/temporarily unavailable/);
});

it("keeps a single copy of the geometry while resuming a second timed section", async () => {
  const first = { revision: "first", points: [{ lat: 1, lon: 2 }] };
  const second = { revision: "second", points: [{ lat: 3, lon: 4 }] };
  const earlier = { course: first, dateKey: "2026-11-27", run: { owner: "a", id: "early" } };
  const current = { course: second, dateKey: "2026-11-27", run: { owner: "a", id: "late" }, previousAttempts: [earlier] };
  const packed = packActiveClimb(current, "journal-2");
  expect(JSON.stringify(packed)).not.toContain("points");
  await changeClimbLibrary("a", [["course/first", first], ["course/second", second], ["active", packed]]);
  const restored = (await readClimbLibrary("a")).active;
  expect(restored.course).toEqual(second);
  expect(restored.previousAttempts[0].course).toEqual(first);
});
