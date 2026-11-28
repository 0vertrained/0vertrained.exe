// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readClimbLibrary, changeClimbLibrary, packActiveClimb } from "../climb/library";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
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
