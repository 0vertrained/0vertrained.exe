// Units. Storage is canonical metric (kg, km, m, seconds); the UI converts
// to the athlete's display system. Conversions keep full precision so a
// value round-trips exactly to its display rounding.

export type UnitSystem = "imperial" | "metric";

export const LB_PER_KG = 2.20462262185;
export const KM_PER_MI = 1.609344;
export const M_PER_YD = 0.9144;

export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const miToKm = (mi: number): number => mi * KM_PER_MI;
export const kmToMi = (km: number): number => km / KM_PER_MI;
export const ydToM = (yd: number): number => yd * M_PER_YD;
export const mToYd = (m: number): number => m / M_PER_YD;

export const weightUnit = (units: UnitSystem): "lb" | "kg" => (units === "imperial" ? "lb" : "kg");
export const distanceUnit = (units: UnitSystem): "mi" | "km" => (units === "imperial" ? "mi" : "km");

/** Smallest practical load jump in the display system (plates / dumbbells). */
export const loadIncrement = (units: UnitSystem): number => (units === "imperial" ? 5 : 2.5);

export function roundTo(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}

export function floorTo(value: number, step: number): number {
  if (!(step > 0)) return value;
  // Nudge for float noise so 184.99999999 floors to 185 when step is 5.
  return Math.floor(value / step + 1e-9) * step;
}

/** One decimal, with float noise removed (18.700000000000003 → 18.7). */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** kg → number shown to the athlete. */
export function toDisplayWeight(kg: number, units: UnitSystem): number {
  return round1(units === "imperial" ? kgToLb(kg) : kg);
}

/** Number the athlete typed → kg. */
export function fromDisplayWeight(value: number, units: UnitSystem): number {
  return units === "imperial" ? lbToKg(value) : value;
}

export function toDisplayDistance(km: number, units: UnitSystem): number {
  return round1(units === "imperial" ? kmToMi(km) : km);
}

export function fromDisplayDistance(value: number, units: UnitSystem): number {
  return units === "imperial" ? miToKm(value) : value;
}

/** A prescribed load rounded to what can actually be loaded in the display system. */
export function roundLoadKg(kg: number, units: UnitSystem): number {
  const display = units === "imperial" ? kgToLb(kg) : kg;
  return fromDisplayWeight(roundTo(display, loadIncrement(units)), units);
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatWeight(kg: number | null | undefined, units: UnitSystem): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  return `${trim(toDisplayWeight(kg, units))} ${weightUnit(units)}`;
}

export function formatDistance(km: number | null | undefined, units: UnitSystem): string {
  if (km == null || !Number.isFinite(km)) return "—";
  return `${trim(toDisplayDistance(km, units))} ${distanceUnit(units)}`;
}

/** 95 → "1:35"; 3725 → "1:02:05". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Parse a typed duration: "45" (minutes), "45:30" (m:ss) or "1:05:00" (h:mm:ss).
 * Returns minutes, or null when the text is not a duration.
 */
export function parseDurationMinutes(text: unknown): number | null {
  if (typeof text === "number") return Number.isFinite(text) && text >= 0 ? text : null;
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
  if ((s ?? 0) >= 60 || (nums.length === 3 && (m ?? 0) >= 60)) return null;
  return (h ?? 0) * 60 + (m ?? 0) + (s ?? 0) / 60;
}
