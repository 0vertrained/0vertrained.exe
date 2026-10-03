// Onboarding answers → the first program revision and the game's start.
// Pure: the screen collects answers, this turns them into what gets saved.
import type { DateKey } from "../../domain/dates";
import { buildProgram } from "../../domain/program/builder";
import { getPreset } from "../../domain/program/presets";
import { appendRevision } from "../../domain/program/revisions";
import {
  BUILDER_GOALS, EQUIPMENT_MODES, EXPERIENCE_LEVELS, TRAINING_DAY_OPTIONS,
  type BuilderGoal, type BuilderInput, type DaysPerWeek, type EquipmentMode, type ProgramPayloadV2, type ProgramWeek,
} from "../../domain/program/types";
import type { UnitSystem } from "../../domain/units";

export interface OnboardingAnswers {
  goal: BuilderGoal;
  daysPerWeek: DaysPerWeek;
  equipment: EquipmentMode;
  experience: (typeof EXPERIENCE_LEVELS)[number];
  units: UnitSystem;
  /** Optional; entered in the chosen units, stored in kg. */
  bodyweightKg?: number;
}

export const ONBOARDING_DEFAULTS: OnboardingAnswers = { goal: "basic_fitness", daysPerWeek: 3, equipment: "full_gym", experience: "beginner", units: "metric" };

export const GOAL_LABELS: Record<BuilderGoal, string> = {
  strength: "Strength", bodybuilding: "Muscle", endurance: "Endurance", basic_fitness: "General fitness", hybrid: "Hybrid",
};
export const EQUIPMENT_LABELS: Record<EquipmentMode, string> = { full_gym: "Full gym", dumbbells: "Dumbbells", bodyweight: "Bodyweight" };
export const EXPERIENCE_LABELS: Record<OnboardingAnswers["experience"], string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export const GOAL_OPTIONS = BUILDER_GOALS.map((value) => ({ value, label: GOAL_LABELS[value] }));
export const DAY_OPTIONS = TRAINING_DAY_OPTIONS.map((value) => ({ value: String(value), label: String(value) }));
export const EQUIPMENT_OPTIONS = EQUIPMENT_MODES.map((value) => ({ value, label: EQUIPMENT_LABELS[value] }));
export const EXPERIENCE_OPTIONS = EXPERIENCE_LEVELS.map((value) => ({ value, label: EXPERIENCE_LABELS[value] }));

export function builderInputFor(a: OnboardingAnswers): BuilderInput {
  return { goal: a.goal, daysPerWeek: a.daysPerWeek, equipment: a.equipment, experience: a.experience };
}

/** The week the generator makes for these answers. */
export function previewWeek(a: OnboardingAnswers): ProgramWeek {
  return buildProgram(builderInputFor(a));
}

export interface FirstProgram {
  program: ProgramPayloadV2;
  startedOn: DateKey;
}

/** Revision 1, effective today, so today's quest is already issued. */
export function firstProgram(a: OnboardingAnswers, todayKey: DateKey): FirstProgram {
  const week = previewWeek(a);
  return { program: appendRevision(null, week, { effectiveFrom: todayKey, source: "generator", builderInput: builderInputFor(a) }), startedOn: todayKey };
}

/** The demo's preset as a first program, for "Start fresh" users who pick a preset instead. */
export function presetProgram(presetId: string, todayKey: DateKey): FirstProgram | null {
  const preset = getPreset(presetId);
  if (!preset) return null;
  return { program: appendRevision(null, preset.week, { effectiveFrom: todayKey, source: `preset:${preset.id}` }), startedOn: todayKey };
}

/** kg from the number typed in the user's units. */
export function bodyweightKgFrom(text: string, units: UnitSystem): number | undefined {
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const kg = units === "imperial" ? n / 2.20462 : n;
  return Math.round(kg * 10) / 10;
}
