// Onboarding + Setup Flow — pure helpers
//
// Everything here is deterministic and side-effect free so it can be unit
// tested without React, Supabase, or a browser. The Tutorial component drives
// the UI; App.jsx wires the resulting payload into program + settings saves.
//
// Design notes on the settings shape this produces:
//   setup: {
//     goal:       one of ONBOARDING_GOALS ids,
//     dataMode:   one of ONBOARDING_DATA_MODES ids,
//     macroPreset:one of ONBOARDING_MACRO_PRESETS ids,
//     completedAt:ISO string | null   (null when not supplied — callers pass one),
//   }
//   onboarded: true,
//   goals: { calories, protein, carbs, fats, water }
//
// Manual logging is a first-class data mode — never treated as "incomplete".
// No tokens or raw biometric/video payloads are touched here.

import { PROGRAM_PRESETS } from "./constants";
import {
  mapOnboardingGoalToBuilderGoal,
  normalizeProgramBuilderInput,
} from "./programBuilder";

// Goals
export const ONBOARDING_GOALS = [
  {
    id: "hybrid",
    label: "Hybrid",
    desc: "Lift heavy and run seriously. Strength and endurance, side by side.",
  },
  {
    id: "muscle",
    label: "Muscle",
    desc: "Hypertrophy focus — build size with structured volume per muscle.",
  },
  {
    id: "strength",
    label: "Strength",
    desc: "Squat, bench, deadlift. Heavy, low-rep, competition-oriented.",
  },
  {
    id: "fat_loss",
    label: "Fat Loss",
    desc: "Hold muscle in a deficit. High protein, mixed training, more movement.",
  },
  {
    id: "endurance",
    label: "Endurance",
    desc: "Miles first. Run-focused training with strength as support.",
  },
];

const GOAL_IDS = ONBOARDING_GOALS.map((g) => g.id);
const DEFAULT_GOAL = "hybrid";

export function isValidGoal(goal) {
  return GOAL_IDS.includes(goal);
}

// Data modes
// "manual" is first-class: full readiness and recovery from logged sleep/energy.
export const ONBOARDING_DATA_MODES = [
  {
    id: "manual",
    label: "Manual only",
    desc: "Log sleep, energy, soreness and stress yourself. Full recovery scoring, no wearable required.",
  },
  {
    id: "oura",
    label: "Wearable connected",
    desc: "Add HRV, resting heart rate, sleep and workout context from Oura or Whoop. Connect from Settings → Integrations.",
  },
  {
    id: "later",
    label: "Connect later",
    desc: "Start with manual logging now. Link a wearable whenever you like from Settings → Integrations.",
  },
];

const DATA_MODE_IDS = ONBOARDING_DATA_MODES.map((m) => m.id);
const DEFAULT_DATA_MODE = "manual";

export function isValidDataMode(mode) {
  return DATA_MODE_IDS.includes(mode);
}

// Macro presets
// Absolute daily targets. Water is fixed at the app default (oz) across presets.
export const ONBOARDING_MACRO_PRESETS = {
  balanced: {
    id: "balanced",
    label: "Balanced",
    desc: "Even split for general training.",
    goals: { calories: 2800, protein: 180, carbs: 300, fats: 80, water: 128 },
  },
  performance: {
    id: "performance",
    label: "Performance",
    desc: "Higher carbs to fuel hard sessions.",
    goals: { calories: 3600, protein: 200, carbs: 400, fats: 100, water: 128 },
  },
  lean_gain: {
    id: "lean_gain",
    label: "Lean Gain",
    desc: "Slight surplus with protein priority.",
    goals: { calories: 3200, protein: 210, carbs: 340, fats: 90, water: 128 },
  },
  cut: {
    id: "cut",
    label: "Cut",
    desc: "Deficit with high protein to hold muscle.",
    goals: { calories: 2200, protein: 200, carbs: 180, fats: 60, water: 128 },
  },
  endurance: {
    id: "endurance",
    label: "Endurance",
    desc: "Carb-forward for mileage and recovery.",
    goals: { calories: 3000, protein: 160, carbs: 400, fats: 80, water: 128 },
  },
};

const MACRO_PRESET_IDS = Object.keys(ONBOARDING_MACRO_PRESETS);
const DEFAULT_MACRO_PRESET = "balanced";

export function isValidMacroPreset(preset) {
  return MACRO_PRESET_IDS.includes(preset);
}

// Sensible starting macro preset for each goal. Users can still change it.
const GOAL_TO_MACRO_PRESET = {
  hybrid: "performance",
  muscle: "lean_gain",
  strength: "performance",
  fat_loss: "cut",
  endurance: "endurance",
};

export function defaultMacroPresetForGoal(goal) {
  return GOAL_TO_MACRO_PRESET[goal] || DEFAULT_MACRO_PRESET;
}

const GOAL_KEYS = ["calories", "protein", "carbs", "fats", "water"];

// Return a fresh, validated goals object for a macro preset id.
export function macroGoalsForPreset(presetId) {
  const preset = ONBOARDING_MACRO_PRESETS[presetId] || ONBOARDING_MACRO_PRESETS[DEFAULT_MACRO_PRESET];
  return { ...preset.goals };
}

// Coerce a partial/untrusted goals object onto a valid numeric shape.
function normalizeGoals(input, fallback) {
  const out = { ...fallback };
  if (input && typeof input === "object") {
    for (const key of GOAL_KEYS) {
      const n = Number(input[key]);
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    }
  }
  return out;
}

// Program preset resolution
// Maps a training goal to a starter PROGRAM_PRESETS id. Used to pre-select the
// program step; the user can still override. Falls back to "hybrid", the
// Hybrid Athlete preset.
const GOAL_TO_PROGRAM_PRESET = {
  hybrid: "hybrid",
  muscle: "bodybuilding",
  strength: "powerlifting",
  fat_loss: "hybrid",
  endurance: "running",
};

export function resolveOnboardingProgramPreset(goal) {
  const id = GOAL_TO_PROGRAM_PRESET[goal];
  if (id && PROGRAM_PRESETS[id]) return id;
  return "hybrid";
}

// Onboarding → Program Builder bridge
// Maps the onboarding goal + the compact builder preferences the Tutorial
// collects into a normalized Program Builder input. Pure, so App.jsx can feed
// it straight into buildProgramPlan()/buildProgramBuilderSettingsPatch() and it
// is unit-testable without React. `generatedAt` is passed IN by the caller.
export function buildOnboardingBuilderInput({ goal, builderPrefs, generatedAt } = {}) {
  const builderGoal = mapOnboardingGoalToBuilderGoal(isValidGoal(goal) ? goal : DEFAULT_GOAL);
  return normalizeProgramBuilderInput({
    ...(builderPrefs && typeof builderPrefs === "object" ? builderPrefs : {}),
    goal: builderGoal,
    generatedAt: typeof generatedAt === "string" ? generatedAt : null,
  });
}

// Settings patch
// Builds ONLY the fields onboarding owns. Never returns theme/social/dietary/
// supplements so a merge can preserve those untouched.
export function buildOnboardingSettingsPatch({
  goal,
  dataMode,
  macroPreset,
  customGoals,
  completedAt,
} = {}) {
  const safeGoal = isValidGoal(goal) ? goal : DEFAULT_GOAL;
  const safeMode = isValidDataMode(dataMode) ? dataMode : DEFAULT_DATA_MODE;
  const safePreset = isValidMacroPreset(macroPreset)
    ? macroPreset
    : defaultMacroPresetForGoal(safeGoal);
  const presetGoals = macroGoalsForPreset(safePreset);
  const goals = customGoals ? normalizeGoals(customGoals, presetGoals) : presetGoals;

  return {
    setup: {
      goal: safeGoal,
      dataMode: safeMode,
      macroPreset: safePreset,
      completedAt: typeof completedAt === "string" && completedAt ? completedAt : null,
    },
    onboarded: true,
    goals,
  };
}

// Merge an onboarding payload onto existing settings, preserving every field the
// setup flow does not own (theme, socialOptIn, dietaryRestrictions, supplements,
// ouraConnected, username, …). Pure — App.jsx uses this before saveSettings().
export function mergeOnboardingSettings(existing, payload) {
  const base = existing && typeof existing === "object" ? existing : {};
  const patch = buildOnboardingSettingsPatch(payload || {});
  return {
    ...base,
    ...patch,
    // Merge goals so any extra caller-specific goal keys survive.
    goals: { ...(base.goals || {}), ...patch.goals },
  };
}

// First-task copy for the Today landing
export function buildFirstTask({ dataMode } = {}) {
  const base = { tab: "Today", title: "Log today's session" };
  if (dataMode === "oura") {
    return {
      ...base,
      body: "Your program is loaded and your wearable can sync in the background once connected. Open Today to see your readiness call, then log your first sets.",
    };
  }
  if (dataMode === "later") {
    return {
      ...base,
      body: "Your program is loaded. Log sleep and energy under Recovery for a readiness call — or connect a wearable later in Settings → Integrations.",
    };
  }
  // manual (and any fallback)
  return {
    ...base,
    body: "Your program is loaded. Manual recovery is first-class: log sleep and energy under Recovery, then start today's sets.",
  };
}
