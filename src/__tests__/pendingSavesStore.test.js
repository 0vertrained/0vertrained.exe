// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readPendingSaves, writePendingSaves, clearPendingSaves } from "../pendingSavesStore";

const USER = "user-abc";

describe("pendingSavesStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a queue per user", () => {
    writePendingSaves(USER, { "2026-07-11": { weight: 187.2 } });
    expect(readPendingSaves(USER)).toEqual({ "2026-07-11": { weight: 187.2 } });
    expect(readPendingSaves("someone-else")).toEqual({});
  });

  it("returns an empty map with no userId or no stored value", () => {
    expect(readPendingSaves(null)).toEqual({});
    expect(readPendingSaves(USER)).toEqual({});
  });

  it("degrades malformed JSON to an empty map", () => {
    localStorage.setItem(`ovt-pending-saves-v1-${USER}`, "{not json");
    expect(readPendingSaves(USER)).toEqual({});
    localStorage.setItem(`ovt-pending-saves-v1-${USER}`, JSON.stringify(["array", "shape"]));
    expect(readPendingSaves(USER)).toEqual({});
  });

  it("removes the key when the queue empties", () => {
    writePendingSaves(USER, { "2026-07-11": { weight: 187.2 } });
    writePendingSaves(USER, {});
    expect(localStorage.getItem(`ovt-pending-saves-v1-${USER}`)).toBe(null);
  });

  it("drops null payloads instead of storing them", () => {
    writePendingSaves(USER, { "2026-07-10": null, "2026-07-11": { water: 3 } });
    expect(readPendingSaves(USER)).toEqual({ "2026-07-11": { water: 3 } });
  });

  it("drops the OLDEST days first when the queue exceeds the size ceiling", () => {
    const bigPayload = { notes: "x".repeat(150_000) };
    writePendingSaves(USER, {
      "2026-07-09": bigPayload,
      "2026-07-10": bigPayload,
      "2026-07-11": bigPayload,
    });
    const stored = readPendingSaves(USER);
    const keys = Object.keys(stored).sort();
    expect(keys).not.toContain("2026-07-09");
    expect(keys).toContain("2026-07-11");
  });

  it("clearPendingSaves removes the stored queue", () => {
    writePendingSaves(USER, { "2026-07-11": { water: 3 } });
    clearPendingSaves(USER);
    expect(readPendingSaves(USER)).toEqual({});
  });
});
