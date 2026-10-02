import { describe, expect, it } from "vitest";
import { addDays, type DateKey } from "../dates";
import { getPreset } from "./presets";
import {
  appendRevision, plannedCardioMinutes, plannedDay, plannedSetsForDay, revisionAt, trainingDaysPerWeek,
} from "./revisions";
import { MAX_REVISIONS, restDay, type ProgramPayloadV2, type ProgramWeek } from "./types";

const preset = (id: string) => getPreset(id)?.week as ProgramWeek;
const beginner = preset("beginner");
const running = preset("running");
const bodybuilding = preset("bodybuilding");

const payload: ProgramPayloadV2 = {
  v: 2,
  revisions: [
    { effectiveFrom: "2026-01-05", source: "preset:beginner", week: beginner },
    { effectiveFrom: "2026-03-02", source: "preset:running", week: running },
  ],
};

describe("revisionAt / plannedDay", () => {
  it.each([
    ["2025-12-01", "preset:beginner"], // before the first: the earliest plan
    ["2026-01-05", "preset:beginner"],
    ["2026-03-01", "preset:beginner"],
    ["2026-03-02", "preset:running"],
    ["2027-01-01", "preset:running"],
  ])("%s uses %s", (dateKey, source) => {
    expect(revisionAt(payload, dateKey).source).toBe(source);
  });

  it("doesn't rely on revision order", () => {
    const shuffled = { ...payload, revisions: [...payload.revisions].reverse() };
    expect(revisionAt(shuffled, "2026-02-01").source).toBe("preset:beginner");
    expect(revisionAt(shuffled, "2025-02-01").source).toBe("preset:beginner");
  });

  it("throws on a payload with no revisions", () => {
    expect(() => revisionAt({ v: 2, revisions: [] }, "2026-01-01")).toThrow(RangeError);
  });

  it("picks the weekday of the live plan", () => {
    expect(plannedDay(payload, "2026-03-07").title).toBe("Long Run"); // a Saturday on the running plan
    expect(plannedDay(payload, "2026-02-07").title).toBe("Active Recovery"); // a Saturday on the beginner plan
  });
});

describe("appendRevision", () => {
  it("starts a payload from nothing", () => {
    const builderInput = { goal: "strength", daysPerWeek: 4, equipment: "full_gym", experience: "beginner" } as const;
    expect(appendRevision(null, beginner, { effectiveFrom: "2026-04-01", source: "generator", builderInput })).toEqual({
      v: 2, revisions: [{ effectiveFrom: "2026-04-01", source: "generator", builderInput, week: beginner }],
    });
  });

  it("keeps revisions sorted and leaves the input untouched", () => {
    const before = JSON.stringify(payload);
    const next = appendRevision(payload, bodybuilding, { effectiveFrom: "2026-02-01", source: "custom" });
    expect(next.revisions.map((r) => r.effectiveFrom)).toEqual(["2026-01-05", "2026-02-01", "2026-03-02"]);
    expect(next.revisions[1]).not.toHaveProperty("builderInput");
    expect(JSON.stringify(payload)).toBe(before);
  });

  it("replaces a revision on the same day", () => {
    const next = appendRevision(payload, bodybuilding, { effectiveFrom: "2026-03-02", source: "custom" });
    expect(next.revisions.map((r) => [r.effectiveFrom, r.source])).toEqual([["2026-01-05", "preset:beginner"], ["2026-03-02", "custom"]]);
  });

  it("keeps the imported v1 week", () => {
    const imported = { ...payload, legacy: { Monday: { type: "Push" } } };
    expect(appendRevision(imported, running, { effectiveFrom: "2026-05-04", source: "custom" }).legacy).toEqual(imported.legacy);
  });

  it(`caps at ${MAX_REVISIONS}, handing the oldest start date to the earliest kept revision`, () => {
    let p: ProgramPayloadV2 | null = null;
    const start: DateKey = "2025-01-06";
    for (let i = 0; i < MAX_REVISIONS + 3; i += 1) {
      p = appendRevision(p, i % 2 ? running : beginner, { effectiveFrom: addDays(start, i * 7), source: `custom:${i}` });
    }
    const revisions = (p as ProgramPayloadV2).revisions;
    expect(revisions).toHaveLength(MAX_REVISIONS);
    expect(revisions[0]).toMatchObject({ effectiveFrom: start, source: "custom:3" });
    expect(revisions[1]?.source).toBe("custom:4");
    expect(revisionAt(p as ProgramPayloadV2, "2025-01-07").source).toBe("custom:3");
  });

  it("rejects an invalid date", () => {
    expect(() => appendRevision(payload, running, { effectiveFrom: "2026-13-01", source: "custom" })).toThrow(RangeError);
  });
});

describe("planned volume", () => {
  it("counts training days", () => {
    expect(trainingDaysPerWeek(running)).toBe(5);
    expect(trainingDaysPerWeek(bodybuilding)).toBe(5);
  });

  it("sums a day's planned sets, ignoring junk counts", () => {
    expect(plannedSetsForDay(bodybuilding.Monday)).toBe(16);
    expect(plannedSetsForDay(restDay())).toBe(0);
    const odd = { ...bodybuilding.Monday, lifting: bodybuilding.Monday.lifting.map((l, i) => ({ ...l, sets: i === 0 ? Number.NaN : i === 1 ? -2 : l.sets })) };
    expect(plannedSetsForDay(odd)).toBe(16 - 4 - 3);
  });

  it("uses planned minutes, else estimates them from distance by kind", () => {
    expect(plannedCardioMinutes(null)).toBe(0);
    expect(plannedCardioMinutes({ kind: "Bike Zone 2", minutes: 40 })).toBe(40);
    expect(plannedCardioMinutes({ kind: "Long Run", km: 10 })).toBe(60);
    expect(plannedCardioMinutes({ kind: "Easy Walk/Run", km: 2.4 })).toBe(29);
    expect(plannedCardioMinutes({ kind: "Brisk Walk", km: 1.6 })).toBe(19);
    expect(plannedCardioMinutes({ kind: "Bike / Elliptical", km: 10 })).toBe(30);
    expect(plannedCardioMinutes({ kind: "Mobility" })).toBe(0);
    expect(plannedCardioMinutes({ kind: "Run", minutes: 0, km: 5 })).toBe(30);
  });
});
