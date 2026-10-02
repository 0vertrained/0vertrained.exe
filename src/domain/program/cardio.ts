// Cardio session catalog the generator draws from, with intensity buckets
// for its recovery-spacing rules.
//
// Ported from src/programExerciseLibrary.js (CARDIO_SESSIONS, buildCardio,
// cardioIntensity) @ c955d5a. Deliberate changes: distances are km, rounded
// to 0.1 so an imperial athlete still sees v19's whole miles; bike and rower
// sessions (v19: "0 miles") carry minutes instead; notes are unit-free.

import { miToKm, round1 } from "../units";
import type { PlannedCardio } from "./types";

export type CardioIntensity = "recovery" | "easy" | "moderate" | "hard";

export interface CardioSession {
  kind: string;
  intensity: CardioIntensity;
  km?: number;
  minutes?: number;
  effort: string;
  notes: string;
}

/** v19 authored distances in miles; keep them whole for imperial display. */
export const kmFromMiles = (miles: number): number => round1(miToKm(miles));

export const CARDIO_SESSIONS = {
  easy_run: { kind: "Easy Run", intensity: "easy", km: kmFromMiles(4), effort: "Zone 2", notes: "Conversational pace throughout — you can speak in full sentences. Aerobic base." },
  zone2_run: { kind: "Zone 2 Run", intensity: "easy", km: kmFromMiles(5), effort: "Zone 2", notes: "Steady aerobic effort, nose-breathing pace. The bulk of endurance progress lives here." },
  long_run: { kind: "Long Run", intensity: "moderate", km: kmFromMiles(8), effort: "Zone 2", notes: "Easy, conversational — your weekly distance anchor. Add a little each week, finish with mobility." },
  tempo_run: { kind: "Tempo Run", intensity: "hard", km: kmFromMiles(5), effort: "Threshold", notes: "Comfortably hard: easy warm-up, sustained tempo in the middle, easy cool-down." },
  intervals: { kind: "Intervals", intensity: "hard", km: kmFromMiles(5), effort: "High", notes: "Warm up, then 4–6 hard efforts (e.g. 4×3–4 min) with easy jog recovery. Cool down." },
  hill_repeats: { kind: "Hill Repeats", intensity: "hard", km: kmFromMiles(4), effort: "High", notes: "Warm up, then 6–8 uphill efforts of ~45–60s, jog down to recover. Strength + speed." },
  recovery_walk: { kind: "Recovery Walk", intensity: "recovery", km: kmFromMiles(2), effort: "Very Light", notes: "Optional easy movement to promote blood flow. Keep it genuinely easy." },
  incline_walk: { kind: "Incline Walk", intensity: "easy", km: kmFromMiles(2.5), effort: "Light", notes: "Treadmill at a brisk incline. Low-impact aerobic work, easy on the joints." },
  bike_zone2: { kind: "Bike Zone 2", intensity: "easy", minutes: 40, effort: "Zone 2", notes: "Low-impact aerobic cross-training, ~30–45 min steady. Great when legs are beat up." },
  row_intervals: { kind: "Row Erg Intervals", intensity: "hard", minutes: 25, effort: "High", notes: "Warm up, then intervals (e.g. 6×250m or 4×2 min) with rest. Full-body, low-impact." },
} as const satisfies Record<string, CardioSession>;

export type CardioKey = keyof typeof CARDIO_SESSIONS;

export function cardioIntensity(key: CardioKey): CardioIntensity {
  return CARDIO_SESSIONS[key].intensity;
}

/** A plan-shaped cardio block from a catalog session, with overrides. */
export function buildCardio(key: CardioKey, overrides: Partial<PlannedCardio> = {}): PlannedCardio {
  const base: CardioSession = CARDIO_SESSIONS[key];
  const cardio: PlannedCardio = { kind: base.kind, effort: base.effort, notes: base.notes };
  if (base.km !== undefined) cardio.km = base.km;
  if (base.minutes !== undefined) cardio.minutes = base.minutes;
  return { ...cardio, ...overrides };
}
