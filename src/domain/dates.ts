// Calendar helpers for local date keys ("YYYY-MM-DD").
//
// The domain never reads the clock: callers pass todayKey (the athlete's local
// calendar day) or explicit ISO timestamps. Arithmetic runs on UTC midnights
// built from the key's parts, so it is immune to DST and the host time zone.

export type DateKey = string;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/**
 * Parsed keys are memoised: buildProgress touches the same few hundred keys
 * thousands of times per fold, and validating each one (regex + Date) was
 * its single largest cost. The cache only ever holds valid keys.
 */
const MS_BY_KEY = new Map<DateKey, number>();
const MS_CACHE_LIMIT = 8192;

function parseKey(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const hit = MS_BY_KEY.get(value);
  if (hit !== undefined) return hit;
  const m = KEY_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const t = new Date(ms);
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  if (MS_BY_KEY.size >= MS_CACHE_LIMIT) MS_BY_KEY.clear();
  MS_BY_KEY.set(value, ms);
  return ms;
}

export function isDateKey(value: unknown): value is DateKey {
  return parseKey(value) !== null;
}

function toUtcMs(key: DateKey): number {
  const ms = parseKey(key);
  if (ms === null) throw new RangeError(`Invalid date key: ${key}`);
  return ms;
}

function fromUtcMs(ms: number): DateKey {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(key: DateKey, days: number): DateKey {
  return fromUtcMs(toUtcMs(key) + Math.round(days) * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: DateKey, to: DateKey): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: DateKey): number {
  return (new Date(toUtcMs(key)).getUTCDay() + 6) % 7;
}

export function weekdayName(key: DateKey): Weekday {
  return WEEKDAYS[weekdayIndex(key)] as Weekday;
}

/** Monday of the week containing `key`. */
export function weekStart(key: DateKey): DateKey {
  return addDays(key, -weekdayIndex(key));
}

/** Inclusive list of keys from `from` to `to`; empty when `to` is before `from`. */
export function dateRange(from: DateKey, to: DateKey): DateKey[] {
  const n = diffDays(from, to);
  const base = toUtcMs(from);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => fromUtcMs(base + i * DAY_MS));
}

export function compareKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The local calendar day of an instant, for a fixed UTC offset in minutes
 * (e.g. -300 for UTC-5). Used to judge "logged within N hours of the day".
 */
export function dateKeyOfInstant(iso: string, utcOffsetMinutes = 0): DateKey | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return fromUtcMs(ms + utcOffsetMinutes * 60_000);
}

/** Milliseconds since the epoch for the end (24:00) of `key` at a fixed offset. */
export function endOfDayMs(key: DateKey, utcOffsetMinutes = 0): number {
  return toUtcMs(key) + DAY_MS - utcOffsetMinutes * 60_000;
}
