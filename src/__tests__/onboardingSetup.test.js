import { describe, it, expect } from "vitest";
import {
  ONBOARDING_GOALS,
  ONBOARDING_DATA_MODES,
  ONBOARDING_MACRO_PRESETS,
  isValidGoal,
  isValidDataMode,
  isValidMacroPreset,
  defaultMacroPresetForGoal,
  macroGoalsForPreset,
  resolveOnboardingProgramPreset,
  buildOnboardingSettingsPatch,
  mergeOnboardingSettings,
  buildFirstTask,
} from "../onboardingSetup";
import { PROGRAM_PRESETS } from "../constants";

const GOAL_KEYS = ["calories", "protein", "carbs", "fats", "water"];

describe("onboarding catalogs", () => {
  it("exposes the five required goals", () => {
    expect(ONBOARDING_GOALS.map(g => g.id)).toEqual([
      "hybrid", "muscle", "strength", "fat_loss", "endurance",
    ]);
    for (const g of ONBOARDING_GOALS) {
      expect(typeof g.label).toBe("string");
      expect(g.label.length).toBeGreaterThan(0);
      expect(typeof g.desc).toBe("string");
      expect(g.desc.length).toBeGreaterThan(0);
    }
  });

  it("represents manual, oura and later data modes with manual first", () => {
    const ids = ONBOARDING_DATA_MODES.map(m => m.id);
    expect(ids).toEqual(["manual", "oura", "later"]);
    expect(ids[0]).toBe("manual"); // manual-only is first-class / default
  });

  it("every macro preset has a full, numeric, positive goals object", () => {
    for (const preset of Object.values(ONBOARDING_MACRO_PRESETS)) {
      for (const key of GOAL_KEYS) {
        expect(typeof preset.goals[key]).toBe("number");
        expect(preset.goals[key]).toBeGreaterThan(0);
      }
    }
  });
});

describe("validators", () => {
  it("accept known ids and reject unknown", () => {
    expect(isValidGoal("hybrid")).toBe(true);
    expect(isValidGoal("nonsense")).toBe(false);
    expect(isValidDataMode("manual")).toBe(true);
    expect(isValidDataMode("garbage")).toBe(false);
    expect(isValidMacroPreset("cut")).toBe(true);
    expect(isValidMacroPreset("x")).toBe(false);
  });
});

describe("macro resolution", () => {
  it("maps each goal to a valid macro preset producing complete goals", () => {
    for (const g of ONBOARDING_GOALS) {
      const presetId = defaultMacroPresetForGoal(g.id);
      expect(isValidMacroPreset(presetId)).toBe(true);
      const goals = macroGoalsForPreset(presetId);
      for (const key of GOAL_KEYS) {
        expect(typeof goals[key]).toBe("number");
        expect(goals[key]).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to balanced for an unknown goal or preset", () => {
    expect(defaultMacroPresetForGoal("???")).toBe("balanced");
    expect(macroGoalsForPreset("does-not-exist"))
      .toEqual(ONBOARDING_MACRO_PRESETS.balanced.goals);
  });

  it("returns a fresh copy so callers cannot mutate the preset", () => {
    const a = macroGoalsForPreset("performance");
    a.calories = 1;
    expect(ONBOARDING_MACRO_PRESETS.performance.goals.calories).not.toBe(1);
  });
});

describe("program preset resolution", () => {
  it("maps every goal to an existing PROGRAM_PRESETS id", () => {
    for (const g of ONBOARDING_GOALS) {
      const id = resolveOnboardingProgramPreset(g.id);
      expect(PROGRAM_PRESETS[id]).toBeTruthy();
    }
  });

  it("falls back safely to hybrid for unknown goals", () => {
    expect(resolveOnboardingProgramPreset(undefined)).toBe("hybrid");
    expect(resolveOnboardingProgramPreset("banana")).toBe("hybrid");
    expect(PROGRAM_PRESETS.hybrid).toBeTruthy();
  });

  it("maps strength → powerlifting and endurance → running", () => {
    expect(resolveOnboardingProgramPreset("strength")).toBe("powerlifting");
    expect(resolveOnboardingProgramPreset("endurance")).toBe("running");
    expect(resolveOnboardingProgramPreset("muscle")).toBe("bodybuilding");
  });
});

describe("buildOnboardingSettingsPatch", () => {
  it("produces the documented shape with onboarded true", () => {
    const patch = buildOnboardingSettingsPatch({
      goal: "muscle",
      dataMode: "oura",
      macroPreset: "lean_gain",
      completedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(patch.onboarded).toBe(true);
    expect(patch.setup).toEqual({
      goal: "muscle",
      dataMode: "oura",
      macroPreset: "lean_gain",
      completedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(patch.goals).toEqual(ONBOARDING_MACRO_PRESETS.lean_gain.goals);
  });

  it("defaults invalid/missing inputs to hybrid + manual + goal-derived preset", () => {
    const patch = buildOnboardingSettingsPatch({});
    expect(patch.setup.goal).toBe("hybrid");
    expect(patch.setup.dataMode).toBe("manual");
    expect(patch.setup.macroPreset).toBe(defaultMacroPresetForGoal("hybrid"));
    expect(patch.setup.completedAt).toBeNull();
    expect(patch.onboarded).toBe(true);
  });

  it("derives a macro preset from the goal when none is supplied", () => {
    const patch = buildOnboardingSettingsPatch({ goal: "fat_loss", dataMode: "manual" });
    expect(patch.setup.macroPreset).toBe("cut");
    expect(patch.goals).toEqual(ONBOARDING_MACRO_PRESETS.cut.goals);
  });

  it("honors custom goals but coerces them to a valid numeric shape", () => {
    const patch = buildOnboardingSettingsPatch({
      goal: "hybrid",
      dataMode: "manual",
      customGoals: { calories: 2500, protein: "abc", carbs: -5 },
    });
    expect(patch.goals.calories).toBe(2500);           // valid override kept
    expect(patch.goals.protein).toBe(                   // invalid → preset fallback
      ONBOARDING_MACRO_PRESETS[defaultMacroPresetForGoal("hybrid")].goals.protein
    );
    expect(patch.goals.carbs).toBe(                      // negative rejected → fallback
      ONBOARDING_MACRO_PRESETS[defaultMacroPresetForGoal("hybrid")].goals.carbs
    );
    for (const key of GOAL_KEYS) expect(typeof patch.goals[key]).toBe("number");
  });

  it("normalizes null completedAt for non-string input", () => {
    const patch = buildOnboardingSettingsPatch({ goal: "hybrid", completedAt: 12345 });
    expect(patch.setup.completedAt).toBeNull();
  });
});

describe("mergeOnboardingSettings", () => {
  const existing = {
    theme: "whitepaperDark",
    socialOptIn: true,
    dietaryRestrictions: ["vegetarian"],
    supplements: ["Creatine"],
    ouraConnected: true,
    goals: { calories: 1, protein: 1, carbs: 1, fats: 1, water: 1, custom: 42 },
    onboarded: false,
  };

  it("preserves untouched fields while applying the setup patch", () => {
    const merged = mergeOnboardingSettings(existing, {
      goal: "strength",
      dataMode: "later",
      completedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(merged.theme).toBe("whitepaperDark");
    expect(merged.socialOptIn).toBe(true);
    expect(merged.dietaryRestrictions).toEqual(["vegetarian"]);
    expect(merged.supplements).toEqual(["Creatine"]);
    expect(merged.ouraConnected).toBe(true);
    expect(merged.onboarded).toBe(true);
    expect(merged.setup.goal).toBe("strength");
    expect(merged.setup.dataMode).toBe("later");
  });

  it("overwrites standard goal keys but keeps extra goal keys", () => {
    const merged = mergeOnboardingSettings(existing, { goal: "strength", dataMode: "manual" });
    // standard keys replaced by preset values
    const preset = ONBOARDING_MACRO_PRESETS[defaultMacroPresetForGoal("strength")].goals;
    expect(merged.goals.calories).toBe(preset.calories);
    // unknown extra goal key survives
    expect(merged.goals.custom).toBe(42);
  });

  it("does not mutate the input settings object", () => {
    const snapshot = JSON.parse(JSON.stringify(existing));
    mergeOnboardingSettings(existing, { goal: "muscle", dataMode: "oura" });
    expect(existing).toEqual(snapshot);
  });

  it("handles a null/undefined existing settings safely", () => {
    const merged = mergeOnboardingSettings(null, { goal: "hybrid", dataMode: "manual" });
    expect(merged.onboarded).toBe(true);
    expect(merged.goals).toEqual(ONBOARDING_MACRO_PRESETS[defaultMacroPresetForGoal("hybrid")].goals);
  });
});

describe("buildFirstTask", () => {
  it("returns Today-landing copy for every data mode", () => {
    for (const mode of ["manual", "oura", "later", undefined]) {
      const task = buildFirstTask({ dataMode: mode });
      expect(task.tab).toBe("Today");
      expect(typeof task.title).toBe("string");
      expect(task.title.length).toBeGreaterThan(0);
      expect(typeof task.body).toBe("string");
      expect(task.body.length).toBeGreaterThan(0);
    }
  });

  it("mentions manual recovery being first-class in manual mode", () => {
    expect(buildFirstTask({ dataMode: "manual" }).body.toLowerCase()).toContain("first-class");
  });

  it("points at Settings → Integrations in the later mode", () => {
    expect(buildFirstTask({ dataMode: "later" }).body).toContain("Integrations");
  });
});
