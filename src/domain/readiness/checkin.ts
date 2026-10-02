// The 5-second check-in: four tap rows on the 1–10 scales v1 already stored,
// plus an illness flag. Reading it yields "rough" flags only — a great
// morning never earns a harder day (caution-only doctrine).
//
// Ported from src/checkinMorning.js @ c955d5a. Changes: reads the v2
// CheckIn record (numbers, not strings); flag copy is for the tier reason
// line; the Morning Edition divergence copy is not ported.

import type { CheckIn } from "../day/schema";

export type CheckinField = "sleepQuality" | "soreness" | "stress" | "energy";

export interface CheckinOption {
  value: number;
  text: string;
}

export interface CheckinRow {
  field: CheckinField;
  label: string;
  options: readonly CheckinOption[];
}

export const CHECKIN_ROWS: readonly CheckinRow[] = [
  { field: "sleepQuality", label: "Slept", options: [{ value: 3, text: "poorly" }, { value: 6, text: "fine" }, { value: 9, text: "well" }] },
  { field: "soreness", label: "Sore", options: [{ value: 2, text: "no" }, { value: 5, text: "some" }, { value: 8, text: "very" }] },
  { field: "stress", label: "Stress", options: [{ value: 2, text: "low" }, { value: 5, text: "some" }, { value: 8, text: "high" }] },
  { field: "energy", label: "Energy", options: [{ value: 3, text: "low" }, { value: 6, text: "ok" }, { value: 9, text: "high" }] },
];

export type CheckinFlag = "slept_poorly" | "very_sore" | "high_stress" | "low_energy" | "illness";

export interface CheckinReading {
  answered: number;
  total: number;
  complete: boolean;
  flags: CheckinFlag[];
  values: Partial<Record<CheckinField, number>>;
}

/** The tap a stored value maps to (typed 1–10 values snap to the nearest tap). */
export function selectedOption(row: CheckinRow, value: number | undefined): CheckinOption | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  let best: CheckinOption | null = null;
  for (const option of row.options) {
    if (!best || Math.abs(option.value - value) < Math.abs(best.value - value)) best = option;
  }
  return best;
}

export function readCheckin(checkin: CheckIn | undefined): CheckinReading {
  const values: Partial<Record<CheckinField, number>> = {};
  const flags: CheckinFlag[] = [];
  let answered = 0;
  for (const row of CHECKIN_ROWS) {
    const v = checkin?.[row.field];
    if (v === undefined || !Number.isFinite(v)) continue;
    values[row.field] = v;
    answered += 1;
    // Same 1–10 thresholds v1 used, so old and new days read alike.
    if (row.field === "sleepQuality" && v <= 4) flags.push("slept_poorly");
    if (row.field === "soreness" && v >= 7) flags.push("very_sore");
    if (row.field === "stress" && v >= 7) flags.push("high_stress");
    if (row.field === "energy" && v <= 4) flags.push("low_energy");
  }
  if (checkin?.illness === true) flags.push("illness");
  return { answered, total: CHECKIN_ROWS.length, complete: answered === CHECKIN_ROWS.length, flags, values };
}

/** A check-in "counts" (for its XP and the VIT stat) once 3 of 4 rows are answered. */
export const CHECKIN_MIN_ANSWERS = 3;

export function isCheckinCounted(checkin: CheckIn | undefined): boolean {
  return readCheckin(checkin).answered >= CHECKIN_MIN_ANSWERS;
}

const FLAG_COPY: Record<CheckinFlag, string> = {
  slept_poorly: "Slept poorly",
  very_sore: "very sore",
  high_stress: "high stress",
  low_energy: "low energy",
  illness: "Ill or injured",
};

/** "Slept poorly + very sore" — the flags that drove a tier, in reading order. */
export function describeFlags(flags: readonly CheckinFlag[]): string {
  const text = flags.map((f) => FLAG_COPY[f]).join(" + ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}
