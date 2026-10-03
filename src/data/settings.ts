// The v20 settings document: everything about the athlete that is not a day
// or a program. Stored as one JSON object (guest: in the local envelope;
// signed in: the `settings` row). Reads go through normalizeSettings, which
// never throws and keeps only values it understands, so a partial or damaged
// document always opens as usable settings.

import { isDateKey } from "../domain/dates";
import { RANK_ORDER } from "../domain/game/config";
import type { GameHigh, GameSettings, Pause, Rank } from "../domain/game/types";
import type { UnitSystem } from "../domain/units";

export const SETTINGS_VERSION = 2;

export interface SettingsV2 {
  v: 2;
  units: UnitSystem;
  bodyweightKg?: number;
  /** The first-run flow was completed (or the demo was seeded). */
  onboarded: boolean;
  profile: { name?: string; featuredTitle?: string };
  session: { restSeconds: number; sound: boolean; haptics: boolean; cues: boolean };
  game: GameSettings;
}

/**
 * A partial document for patching: nested objects merge, arrays replace,
 * and an explicit `undefined` clears an optional field.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const DEFAULT_SETTINGS: Readonly<SettingsV2> = Object.freeze({
  v: 2,
  units: "metric",
  onboarded: false,
  profile: Object.freeze({}),
  session: Object.freeze({ restSeconds: 90, sound: true, haptics: true, cues: true }),
  game: Object.freeze({}),
}) as SettingsV2;

/** Upper bounds that separate a typo from a value (a 1,000 kg athlete, a 2-hour rest). */
const MAX_BODYWEIGHT_KG = 1000;
const MAX_REST_SECONDS = 3600;
const MAX_NAME_LENGTH = 80;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const UNIT_SYSTEMS: readonly UnitSystem[] = ["metric", "imperial"];
const PAUSE_REASONS: readonly Pause["reason"][] = ["sick", "travel", "life"];

function text(v: unknown, max = MAX_NAME_LENGTH): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function positiveKg(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < MAX_BODYWEIGHT_KG ? v : undefined;
}

const isRank = (v: unknown): v is Rank => typeof v === "string" && (RANK_ORDER as readonly string[]).includes(v);

function coercePauses(raw: unknown): Pause[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pauses: Pause[] = [];
  for (const item of raw) {
    if (!isObj(item) || !isDateKey(item.from) || !isDateKey(item.to)) continue;
    const reason = item.reason;
    if (typeof reason !== "string" || !PAUSE_REASONS.includes(reason as Pause["reason"])) continue;
    pauses.push({ from: item.from, to: item.to, reason: reason as Pause["reason"] });
  }
  return pauses;
}

function coerceHigh(raw: unknown): Partial<GameHigh> | undefined {
  if (!isObj(raw)) return undefined;
  const high: Partial<GameHigh> = {};
  if (isRank(raw.rank)) high.rank = raw.rank;
  if (Array.isArray(raw.trialsPassed)) {
    high.trialsPassed = raw.trialsPassed.flatMap((t: unknown) =>
      isObj(t) && isRank(t.rank) && isDateKey(t.date) ? [{ rank: t.rank, date: t.date }] : []);
  }
  if (Array.isArray(raw.achievements)) {
    high.achievements = [...new Set(raw.achievements.filter((a: unknown): a is string => typeof a === "string" && a !== ""))];
  }
  return Object.keys(high).length ? high : undefined;
}

function coerceGame(raw: unknown): GameSettings {
  const g = isObj(raw) ? raw : {};
  const game: GameSettings = {};
  if (g.title === null) game.title = null;
  else {
    const title = text(g.title);
    if (title !== undefined) game.title = title;
  }
  if (g.bodyweightKg === null) game.bodyweightKg = null;
  else {
    const kg = positiveKg(g.bodyweightKg);
    if (kg !== undefined) game.bodyweightKg = kg;
  }
  if (isDateKey(g.startedOn)) game.startedOn = g.startedOn;
  if (isDateKey(g.importedThrough)) game.importedThrough = g.importedThrough;
  const pauses = coercePauses(g.pauses);
  if (pauses) game.pauses = pauses;
  const high = coerceHigh(g.high);
  if (high) game.high = high;
  return game;
}

function coerceSession(raw: unknown): SettingsV2["session"] {
  const s = isObj(raw) ? raw : {};
  const d = DEFAULT_SETTINGS.session;
  const rest = s.restSeconds;
  return {
    restSeconds: typeof rest === "number" && Number.isFinite(rest) && rest >= 0 && rest <= MAX_REST_SECONDS ? Math.round(rest) : d.restSeconds,
    sound: typeof s.sound === "boolean" ? s.sound : d.sound,
    haptics: typeof s.haptics === "boolean" ? s.haptics : d.haptics,
    cues: typeof s.cues === "boolean" ? s.cues : d.cues,
  };
}

function coerceProfile(raw: unknown): SettingsV2["profile"] {
  const p = isObj(raw) ? raw : {};
  const profile: SettingsV2["profile"] = {};
  const name = text(p.name);
  if (name !== undefined) profile.name = name;
  const featuredTitle = text(p.featuredTitle);
  if (featuredTitle !== undefined) profile.featuredTitle = featuredTitle;
  return profile;
}

/**
 * Read any stored settings (v2, partial or junk) as a full document. Each
 * field falls back to its default on its own, so one bad value never resets
 * the rest. Never throws.
 */
export function normalizeSettings(raw: unknown): SettingsV2 {
  const r = isObj(raw) ? raw : {};
  const settings: SettingsV2 = {
    v: 2,
    units: UNIT_SYSTEMS.includes(r.units as UnitSystem) ? (r.units as UnitSystem) : DEFAULT_SETTINGS.units,
    onboarded: r.onboarded === true,
    profile: coerceProfile(r.profile),
    session: coerceSession(r.session),
    game: coerceGame(r.game),
  };
  const kg = positiveKg(r.bodyweightKg);
  if (kg !== undefined) settings.bodyweightKg = kg;
  return settings;
}

function mergeInto(target: Obj, patch: Obj): Obj {
  const out: Obj = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete out[key];
    else if (isObj(value) && isObj(out[key])) out[key] = mergeInto(out[key], value);
    else if (isObj(value)) out[key] = mergeInto({}, value);
    else out[key] = value;
  }
  return out;
}

/**
 * A new document with `patch` applied: nested objects (profile, session,
 * game, game.high) merge key by key, arrays such as game.pauses are replaced
 * whole, and a key set to `undefined` is removed. `current` is not changed.
 */
export function patchSettings(current: SettingsV2, patch: DeepPartial<SettingsV2>): SettingsV2 {
  return mergeInto(current as unknown as Obj, patch as Obj) as unknown as SettingsV2;
}
