import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIODIZATION_SETTINGS,
  PERIODIZATION_GOAL_PRESETS,
  normalizePeriodizationSettings,
  describePeriodizationPreview,
  periodizationSettingsChanged,
  buildPeriodizationStoragePatch,
  buildNextBlockSettings,
  buildBlockSnapshot,
  appendBlockHistory,
} from "../periodizationSettings";

describe("normalizePeriodizationSettings", () => {
  it("fills defaults from empty input", () => {
    const s = normalizePeriodizationSettings({});
    expect(s.name).toBe(DEFAULT_PERIODIZATION_SETTINGS.name);
    expect(s.blockLengthWeeks).toBe(4);
    expect(s.deloadWeek).toBe(4);
    expect(s.runEmphasis).toBe("maintain");
    expect(s.strengthEmphasis).toBe("maintain");
    expect(s.version).toBe(1);
  });

  it("clamps block length to 4–8", () => {
    expect(normalizePeriodizationSettings({ blockLengthWeeks: 2 }).blockLengthWeeks).toBe(4);
    expect(normalizePeriodizationSettings({ blockLengthWeeks: 99 }).blockLengthWeeks).toBe(8);
    expect(normalizePeriodizationSettings({ blockLengthWeeks: "6" }).blockLengthWeeks).toBe(6);
  });

  it("clamps deload week to 1–blockLengthWeeks", () => {
    expect(normalizePeriodizationSettings({ blockLengthWeeks: 6, deloadWeek: 9 }).deloadWeek).toBe(6);
    expect(normalizePeriodizationSettings({ blockLengthWeeks: 6, deloadWeek: 0 }).deloadWeek).toBe(1);
    expect(normalizePeriodizationSettings({ blockLengthWeeks: 6, deloadWeek: 5 }).deloadWeek).toBe(5);
  });

  it("falls back empty name to default and empty goal to preset goal", () => {
    const s = normalizePeriodizationSettings({ name: "   ", goal: "", goalPreset: "hyrox_prep" });
    expect(s.name).toBe("Current Block");
    expect(s.goal).toBe(PERIODIZATION_GOAL_PRESETS.hyrox_prep.goal);
  });

  it("uses fallback start date when input date is invalid", () => {
    expect(normalizePeriodizationSettings({ startDate: "not-a-date" }, "2026-06-24").startDate).toBe("2026-06-24");
    expect(normalizePeriodizationSettings({ startDate: "2026-07-01" }, "2026-06-24").startDate).toBe("2026-07-01");
    expect(normalizePeriodizationSettings({ startDate: "garbage" }, "also-bad").startDate).toBe("");
  });

  it("rejects unknown emphasis and preset values", () => {
    const s = normalizePeriodizationSettings({ runEmphasis: "explode", strengthEmphasis: "yolo", goalPreset: "nope" });
    expect(s.runEmphasis).toBe("maintain");
    expect(s.strengthEmphasis).toBe("maintain");
    expect(s.goalPreset).toBe(DEFAULT_PERIODIZATION_SETTINGS.goalPreset);
  });
});

describe("describePeriodizationPreview", () => {
  it("describes length and deload changes with safety line last", () => {
    const prev = { blockLengthWeeks: 4, deloadWeek: 4 };
    const next = { blockLengthWeeks: 6, deloadWeek: 5 };
    const lines = describePeriodizationPreview(prev, next);
    expect(lines).toContain("Length changes from 4 to 6 weeks.");
    expect(lines).toContain("Deload moves from Week 4 to Week 5.");
    expect(lines[lines.length - 1]).toMatch(/not rewritten/i);
  });

  it("describes a start date change", () => {
    const lines = describePeriodizationPreview({ startDate: "2026-06-01" }, { startDate: "2026-06-24" });
    expect(lines.some((l) => l.includes("2026-06-01") && l.includes("2026-06-24"))).toBe(true);
  });

  it("returns a no-changes line plus safety line when nothing changed", () => {
    const same = { blockLengthWeeks: 4, deloadWeek: 4, name: "Current Block" };
    const lines = describePeriodizationPreview(same, same);
    expect(lines[0]).toMatch(/no changes/i);
    expect(lines[lines.length - 1]).toMatch(/not rewritten/i);
  });
});

describe("periodizationSettingsChanged", () => {
  it("ignores savedAt but detects real edits", () => {
    const base = { blockLengthWeeks: 4, deloadWeek: 4, savedAt: "2026-06-01T00:00:00Z" };
    expect(periodizationSettingsChanged(base, { ...base, savedAt: "later" })).toBe(false);
    expect(periodizationSettingsChanged(base, { ...base, deloadWeek: 3 })).toBe(true);
  });
});

describe("buildPeriodizationStoragePatch", () => {
  it("keeps only whitelisted keys and drops unrelated fields", () => {
    const patch = buildPeriodizationStoragePatch({
      name: "Hyrox Base",
      blockLengthWeeks: 6,
      deloadWeek: 5,
      // unrelated / unsafe fields that must NOT be persisted:
      program: { Monday: { lifting: [] } },
      workout: { exercises: {} },
      SUPABASE_SERVICE_ROLE_KEY: "secret",
      onSave: () => {},
    });
    expect(patch.name).toBe("Hyrox Base");
    expect(patch.blockLengthWeeks).toBe(6);
    expect(patch.deloadWeek).toBe(5);
    expect(patch).not.toHaveProperty("program");
    expect(patch).not.toHaveProperty("workout");
    expect(patch).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(patch).not.toHaveProperty("onSave");
    // round-trips cleanly to JSON (no functions)
    expect(JSON.parse(JSON.stringify(patch))).toEqual(patch);
  });
});

describe("buildNextBlockSettings", () => {
  it("starts the day after the current block ends and keeps length, deload last", () => {
    const plan = {
      name: "Hyrox Base",
      endDate: "2026-08-04",
      blockLengthWeeks: 6,
      goal: "Build aerobic base",
      goalPreset: "hyrox_prep",
      emphasis: { run: "build", strength: "maintain" },
    };
    const next = buildNextBlockSettings(plan);
    expect(next.startDate).toBe("2026-08-05");
    expect(next.blockLengthWeeks).toBe(6);
    expect(next.deloadWeek).toBe(6);
    expect(next.name).toBe("Next Block");
    expect(next.runEmphasis).toBe("build");
  });
});

describe("block history helpers", () => {
  it("buildBlockSnapshot excludes workout/program data", () => {
    const snap = buildBlockSnapshot({
      name: "Hyrox Base",
      startDate: "2026-06-24",
      endDate: "2026-08-04",
      blockLengthWeeks: 6,
      deloadWeek: 5,
      programAnalysis: { liftingDays: 4 },
      weeks: [{ guidance: "x" }],
    }, "2026-08-04");
    expect(snap).toEqual({
      id: "2026-06-24-hyrox-base",
      name: "Hyrox Base",
      startDate: "2026-06-24",
      endDate: "2026-08-04",
      blockLengthWeeks: 6,
      deloadWeek: 5,
      completedAt: "2026-08-04",
    });
    expect(snap).not.toHaveProperty("weeks");
    expect(snap).not.toHaveProperty("programAnalysis");
  });

  it("appendBlockHistory dedupes by id and caps at 6", () => {
    let history = [];
    for (let i = 1; i <= 8; i++) {
      history = appendBlockHistory(history, { id: `b${i}`, name: `Block ${i}` });
    }
    expect(history).toHaveLength(6);
    expect(history[0].id).toBe("b8");
    // re-adding an existing id moves it to front without growing the list
    const deduped = appendBlockHistory(history, { id: "b8", name: "Block 8 again" });
    expect(deduped).toHaveLength(6);
    expect(deduped.filter((h) => h.id === "b8")).toHaveLength(1);
  });
});
