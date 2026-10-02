// Ready-made weekly programs the athlete can start from.
//
// Ported from src/constants.js (PROGRAM_PRESETS) @ c955d5a. Deliberate changes:
//   - Five presets kept: beginner, calisthenics, bodybuilding, powerlifting,
//     running. hybrid (DEFAULT_PROGRAM), highIntensityHybrid, ramiHybridCut,
//     doubleEdition and raceEdition50k are dropped: personal programs, AM/PM
//     two-a-days or a build tied to one race date.
//   - Lifts are library movements under their catalog names ("Squat" → Back
//     Squat, "Core Work" → Crunch, "DB Lunges" → Walking Lunge), with
//     explicit tracking modes; cardio miles are km (whole miles in imperial) and notes
//     that named miles are unit-free.
//   - Superman Hold is a timed hold (as v19 logged it), so its note no longer
//     says "hold 2 seconds each".

import { WEEKDAYS } from "../dates";
import { kmFromMiles } from "./cardio";
import { getExercise } from "./library";
import { restDay, type PlannedCardio, type PlannedLift, type ProgramDay, type ProgramWeek } from "./types";

export interface Preset {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  week: ProgramWeek;
}

function lift(id: string, sets: number, reps: number, notes?: string): PlannedLift {
  const e = getExercise(id);
  if (!e) throw new Error(`Preset names unknown exercise "${id}".`);
  const planned: PlannedLift = { id, name: e.name, libraryId: id, sets, reps: String(reps), trackingMode: e.trackingMode };
  return notes ? { ...planned, notes } : planned;
}

const cardio = (kind: string, miles: number, effort: string, notes: string): PlannedCardio => ({ kind, km: kmFromMiles(miles), effort, notes });

const day = (title: string, code: string, lifting: PlannedLift[], withCardio: PlannedCardio | null = null): ProgramDay => ({
  title, code, rest: false, lifting, cardio: withCardio,
});

/** Days not listed are rest days. */
const week = (days: Partial<ProgramWeek>): ProgramWeek =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, days[d] ?? restDay()])) as ProgramWeek;

const finisher = (notes: string) => cardio("Easy Walk/Run", 1.5, "Light", notes);
const brisk = (miles: number, notes: string) => cardio("Brisk Walk", miles, "Easy", notes);

export const PRESETS: readonly Preset[] = Object.freeze([
  {
    id: "beginner",
    name: "Beginner Full Body",
    description: "3 days per week. Squat, hinge, push, pull — the fundamentals.",
    tags: ["Beginner", "Full Body", "3 Days"],
    week: week({
      Monday: day("Full Body A", "LIFT A", [lift("back-squat", 3, 8), lift("barbell-bench-press", 3, 8), lift("barbell-row", 3, 8), lift("overhead-press", 3, 8), lift("plank", 3, 45)], finisher("Light cardio to finish — walk or easy jog.")),
      Wednesday: day("Full Body B", "LIFT B", [lift("conventional-deadlift", 3, 6), lift("incline-db-press", 3, 10), lift("lat-pulldown", 3, 10), lift("walking-lunge", 3, 10), lift("standing-calf-raise", 3, 15)], finisher("Light cardio to finish.")),
      Friday: day("Full Body C", "LIFT C", [lift("goblet-squat", 3, 10), lift("push-up", 3, 12), lift("one-arm-db-row", 3, 10), lift("romanian-deadlift", 3, 10), lift("crunch", 3, 15)], finisher("Light cardio to finish.")),
      Saturday: day("Active Recovery", "ACTIVE", [], cardio("Easy Walk", 2, "Very Light", "Optional — light walk or stretching only.")),
    }),
  },
  {
    id: "calisthenics",
    name: "Calisthenics — Absolute Beginner",
    description: "No equipment needed. Build strength from zero using only your bodyweight. 3 days per week, short sessions, full rest between.",
    tags: ["Beginner", "Bodyweight", "No Equipment"],
    week: week({
      Monday: day("Push Day", "PUSH", [
        lift("incline-push-up", 3, 10, "Hands on a counter or bench — easier than floor."),
        lift("wall-sit", 3, 30, "Hold 30 seconds. Thighs parallel to floor."),
        lift("shoulder-tap", 3, 10, "In push-up position, tap opposite shoulder. Counts each side."),
        lift("glute-bridge", 3, 12, "Lie on back, feet flat, drive hips up. Squeeze at the top."),
        lift("dead-bug", 3, 8, "Slow and controlled. Lower opposite arm/leg together."),
      ], brisk(1, "10–15 minute walk to finish. Focus on breathing.")),
      Wednesday: day("Pull & Hinge Day", "PULL", [
        lift("inverted-row", 3, 8, "Lie under a table edge, pull chest to it. Angle your body to adjust difficulty."),
        lift("bodyweight-good-morning", 3, 12, "Hands behind head, hinge at the hip, slight knee bend. Feel the hamstrings."),
        lift("reverse-lunge", 3, 8, "Step backward, not forward — much easier on the knees."),
        lift("superman-hold", 3, 10, "Lie face down, lift arms and chest slightly. Hold, then lower with control."),
        lift("plank", 3, 20, "Hold 20 seconds. Elbows under shoulders, flat back, don't hold your breath."),
      ], brisk(1, "10–15 minute walk. Keep it comfortable.")),
      Friday: day("Full Body Day", "FULL", [
        lift("bodyweight-squat", 3, 12, "Feet shoulder-width, toes slightly out. Sit back into it, keep chest up."),
        lift("push-up", 3, 6, "If 6 is too many, go back to incline for now. Never sacrifice form."),
        lift("step-up", 3, 10, "Use a sturdy chair or low step. Drive through the heel of the lead foot."),
        lift("scapular-row", 3, 10, "Arms out in front, pinch shoulder blades together. Can use a resistance band."),
        lift("hollow-body-hold", 3, 15, "Lie on back, lower back pressed to floor, legs slightly lifted. Hold 15 sec."),
      ], brisk(1.5, "Slightly longer walk today — you've earned it.")),
      Saturday: day("Active Recovery", "ACTIVE", [], cardio("Easy Walk", 1, "Very Light", "Optional. Just move — 10 minutes of walking is enough.")),
    }),
  },
  {
    id: "bodybuilding",
    name: "Bodybuilding",
    description: "Classic bro split. High volume per muscle group, 5 days.",
    tags: ["Hypertrophy", "Volume", "Aesthetics"],
    week: week({
      Monday: day("Chest Day", "CHEST", [lift("barbell-bench-press", 4, 8), lift("incline-db-press", 3, 10), lift("cable-fly", 3, 12), lift("dip", 3, 12), lift("triceps-pushdown", 3, 15)]),
      Tuesday: day("Back Day", "BACK", [lift("conventional-deadlift", 4, 6), lift("barbell-row", 4, 8), lift("lat-pulldown", 3, 10), lift("cable-row", 3, 12), lift("face-pull", 3, 15)]),
      Wednesday: day("Shoulder Day", "SHOULDERS", [lift("seated-db-press", 4, 8), lift("lateral-raise", 4, 12), lift("front-raise", 3, 12), lift("rear-delt-fly", 3, 15), lift("shrugs", 3, 12)]),
      Friday: day("Legs Day", "LEGS", [lift("back-squat", 4, 8), lift("leg-press", 3, 10), lift("romanian-deadlift", 3, 10), lift("lying-leg-curl", 3, 12), lift("standing-calf-raise", 4, 15)]),
      Saturday: day("Arms Day", "ARMS", [lift("barbell-curl", 4, 10), lift("incline-db-curl", 3, 12), lift("hammer-curl", 3, 12), lift("skull-crusher", 4, 10), lift("triceps-pushdown", 3, 12), lift("overhead-triceps-extension", 3, 12)]),
    }),
  },
  {
    id: "powerlifting",
    name: "Powerlifting",
    description: "Squat, bench, deadlift and accessories. 4 days, heavy.",
    tags: ["Strength", "Heavy", "Competition"],
    week: week({
      Monday: day("Squat Focus", "SQUAT", [lift("back-squat", 5, 3), lift("romanian-deadlift", 3, 5), lift("leg-press", 3, 8), lift("walking-lunge", 3, 8), lift("lying-leg-curl", 3, 10)]),
      Tuesday: day("Bench Focus", "BENCH", [lift("barbell-bench-press", 5, 3), lift("close-grip-bench-press", 3, 5), lift("dumbbell-bench-press", 3, 8), lift("triceps-pushdown", 3, 10), lift("lateral-raise", 3, 12)]),
      Thursday: day("Deadlift Focus", "DEAD", [lift("conventional-deadlift", 5, 3), lift("deficit-deadlift", 3, 5), lift("barbell-row", 3, 6), lift("lat-pulldown", 3, 8), lift("face-pull", 3, 15)]),
      Friday: day("Overhead & Accessory", "OHP", [lift("overhead-press", 4, 5), lift("seated-db-press", 3, 8), lift("barbell-curl", 3, 8), lift("skull-crusher", 3, 10), lift("crunch", 3, 15)]),
    }),
  },
  {
    id: "running",
    name: "Running Focus",
    description: "Race training with strength support. 3 runs + 2 lift days.",
    tags: ["Cardio", "Endurance", "5K/10K"],
    week: week({
      Monday: day("Easy Run", "EASY", [], cardio("Easy Run", 4, "Zone 2", "Conversational pace. Base building.")),
      Tuesday: day("Full Body Strength", "LIFT", [lift("back-squat", 3, 8), lift("romanian-deadlift", 3, 8), lift("barbell-bench-press", 3, 8), lift("barbell-row", 3, 8), lift("plank", 3, 60)]),
      Wednesday: day("Tempo Run", "TEMPO", [], cardio("Tempo Run", 4, "85%", "Comfortably hard. First quarter easy, middle half at tempo, last quarter easy.")),
      Thursday: restDay("Rest / Cross Train"),
      Friday: day("Full Body Strength", "LIFT", [lift("conventional-deadlift", 3, 6), lift("pull-up", 3, 8), lift("walking-lunge", 3, 10), lift("seated-db-press", 3, 8), lift("standing-calf-raise", 3, 15)]),
      Saturday: day("Long Run", "LONG", [], cardio("Long Run", 8, "Zone 2", "Easy conversational pace. This is your weekly distance anchor.")),
    }),
  },
]);

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
