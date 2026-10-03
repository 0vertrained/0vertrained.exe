// What the runner's and the sheet's fields share: typed text in the
// athlete's units to canonical numbers, and the id a new cardio log gets.
import { fromDisplayDistance, parseDurationMinutes, type UnitSystem } from "../../domain/units";

/** "3.1" in the display unit → km; null when empty or not a positive number. */
export function parseDistanceKm(text: string, units: UnitSystem): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? fromDisplayDistance(value, units) : null;
}

/** "45" or "45:30" → minutes; null unless positive. */
export function parseMinutes(text: string): number | null {
  const minutes = parseDurationMinutes(text);
  return minutes !== null && minutes > 0 ? minutes : null;
}

export const cardioLogId = (nowMs: number): string => `c${nowMs.toString(36)}`;
