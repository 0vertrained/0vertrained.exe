// Backups in and out: the v20 export envelope, and reading the two shapes
// the v19 app produced (its backup envelope and the older raw {date: day}
// map). Parsing never throws: junk comes back as kind "unknown" with a
// warning the import sheet can show. Everything imported passes through the
// same read boundaries as stored data (normalizeDay, normalizeProgramPayload,
// normalizeSettings), so an import can never put something in the store
// that a load would not accept.
//
// v19 days are paid by the engine's legacy rule (a flat XP per day with
// work): a v1-shaped import sets settings.game.importedThrough to its latest
// day so that rule applies to exactly the days it brought in.

import { compareKeys, isDateKey, type DateKey } from "../domain/dates";
import { normalizeDay } from "../domain/day/normalize";
import type { DayMap } from "../domain/day/schema";
import { RANK_ORDER } from "../domain/game/config";
import type { GameHigh } from "../domain/game/types";
import { resolveExercise } from "../domain/program/library";
import { normalizeProgramPayload } from "../domain/program/normalize";
import type { ProgramPayloadV2 } from "../domain/program/types";
import { lbToKg, round1, type UnitSystem } from "../domain/units";
import type { SnapshotData } from "./DataSource";
import { normalizeSettings, patchSettings, type DeepPartial, type SettingsV2 } from "./settings";

export const BACKUP_FORMAT = "0vertrained-backup";
export const BACKUP_VERSION = 2;

export type ImportKind = "backup-v1" | "raw-map" | "backup-v2" | "unknown";

export interface ImportParse {
  kind: ImportKind;
  days: DayMap;
  program: ProgramPayloadV2 | null;
  settings: DeepPartial<SettingsV2>;
  counts: { days: number; skipped: number };
  range: { from: DateKey; to: DateKey } | null;
  /** Plain-words notes for the preview: what was skipped or could not be read. */
  warnings: string[];
}

/** The app's own backup file. */
export interface BackupV2 {
  format: typeof BACKUP_FORMAT;
  v: typeof BACKUP_VERSION;
  exportedAt: string;
  days: DayMap;
  program: ProgramPayloadV2 | null;
  settings: SettingsV2;
}

export type ImportMode = "missing-only" | "replace";

export const NOT_A_BACKUP = "This file is not a 0VERTRAINED backup. Choose a backup JSON file.";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const resolveLibraryId = (name: string): string | undefined => resolveExercise(name)?.id;

function unknown(warning: string): ImportParse {
  return { kind: "unknown", days: {}, program: null, settings: {}, counts: { days: 0, skipped: 0 }, range: null, warnings: [warning] };
}

function readDays(raw: unknown): { days: DayMap; skipped: number } {
  const days: DayMap = {};
  let skipped = 0;
  if (!isObj(raw)) return { days, skipped };
  for (const [key, value] of Object.entries(raw)) {
    if (!isDateKey(key) || !isObj(value)) {
      skipped += 1;
      continue;
    }
    days[key] = normalizeDay(value, { resolveLibraryId });
  }
  return { days, skipped };
}

function rangeOf(days: DayMap): ImportParse["range"] {
  const keys = Object.keys(days).sort(compareKeys);
  const from = keys[0];
  const to = keys[keys.length - 1];
  return from && to ? { from, to } : null;
}

const skippedWarning = (n: number): string => `Skipped ${n} ${n === 1 ? "entry" : "entries"} that ${n === 1 ? "is" : "are"} not a dated day.`;

function readUnits(raw: Obj): UnitSystem | undefined {
  const v = raw.units ?? raw.unitSystem;
  if (v === "metric" || v === "kg") return "metric";
  if (v === "imperial" || v === "lb" || v === "lbs") return "imperial";
  return undefined;
}

function readBodyweightKg(raw: Obj): number | undefined {
  const kg = raw.bodyweightKg;
  if (typeof kg === "number" && Number.isFinite(kg) && kg > 0) return round1(kg);
  const lb = Number(raw.bodyweightLb ?? raw.bodyweight ?? raw.bodyWeight);
  return Number.isFinite(lb) && lb > 0 ? round1(lbToKg(lb)) : undefined;
}

/** The v19 settings fields v20 models (units, bodyweight); everything else stays behind. */
function settingsFromV19(raw: unknown): DeepPartial<SettingsV2> {
  const out: DeepPartial<SettingsV2> = {};
  if (!isObj(raw)) return out;
  const units = readUnits(raw);
  if (units) out.units = units;
  const kg = readBodyweightKg(raw);
  if (kg !== undefined) {
    out.bodyweightKg = kg;
    out.game = { bodyweightKg: kg };
  }
  return out;
}

function withImportedThrough(settings: DeepPartial<SettingsV2>, range: ImportParse["range"]): DeepPartial<SettingsV2> {
  if (!range) return settings;
  return { ...settings, game: { ...(settings.game ?? {}), importedThrough: range.to } };
}

function parseRawMap(raw: Obj): ImportParse {
  const { days, skipped } = readDays(raw);
  const count = Object.keys(days).length;
  if (count === 0) return unknown(NOT_A_BACKUP);
  const range = rangeOf(days);
  return {
    kind: "raw-map", days, program: null,
    settings: withImportedThrough({}, range),
    counts: { days: count, skipped }, range,
    warnings: skipped > 0 ? [skippedWarning(skipped)] : [],
  };
}

function parseBackupV1(raw: Obj): ImportParse {
  const { days, skipped } = readDays(raw.entries);
  const range = rangeOf(days);
  const warnings = skipped > 0 ? [skippedWarning(skipped)] : [];
  const program = raw.program == null ? null : normalizeProgramPayload(raw.program);
  if (raw.program != null && !program) warnings.push("The program in this backup could not be read. Your current program stays.");
  return {
    kind: "backup-v1", days, program,
    settings: withImportedThrough(settingsFromV19(raw.settings), range),
    counts: { days: Object.keys(days).length, skipped }, range, warnings,
  };
}

function parseBackupV2(raw: Obj): ImportParse {
  const { days, skipped } = readDays(raw.days);
  const warnings = skipped > 0 ? [skippedWarning(skipped)] : [];
  const program = raw.program == null ? null : normalizeProgramPayload(raw.program);
  if (raw.program != null && !program) warnings.push("The program in this backup could not be read. Your current program stays.");
  return {
    kind: "backup-v2", days, program,
    settings: normalizeSettings(raw.settings),
    counts: { days: Object.keys(days).length, skipped }, range: rangeOf(days), warnings,
  };
}

/** Read a backup file's text. Never throws; junk is kind "unknown" with one warning. */
export function parseImport(text: string): ImportParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return unknown("This file is not valid JSON. Choose a 0VERTRAINED backup file.");
  }
  if (!isObj(raw)) return unknown(NOT_A_BACKUP);
  if (raw.format === BACKUP_FORMAT) {
    if (raw.v === BACKUP_VERSION) return parseBackupV2(raw);
    if (raw.v === 1) return parseBackupV1(raw);
    return unknown(`Backup version ${String(raw.v)} is not supported by this app.`);
  }
  return parseRawMap(raw);
}

// ─── Merge ───────────────────────────────────────────────────────────────────

/** The high-water marks of both documents: a rank is never lowered, a passed trial or a title never lost. */
function mergeHigh(current: Partial<GameHigh> | undefined, incoming: Partial<GameHigh> | undefined): Partial<GameHigh> | undefined {
  if (!current) return incoming;
  if (!incoming) return current;
  const high: Partial<GameHigh> = { ...current, ...incoming };
  if (current.rank && incoming.rank) high.rank = RANK_ORDER.indexOf(current.rank) >= RANK_ORDER.indexOf(incoming.rank) ? current.rank : incoming.rank;
  else if (current.rank) high.rank = current.rank;
  if (current.trialsPassed || incoming.trialsPassed) {
    const seen = new Map<string, { rank: GameHigh["rank"]; date: DateKey }>();
    for (const t of [...(current.trialsPassed ?? []), ...(incoming.trialsPassed ?? [])]) seen.set(`${t.rank}:${t.date}`, t);
    high.trialsPassed = [...seen.values()];
  }
  if (current.achievements || incoming.achievements) high.achievements = [...new Set([...(current.achievements ?? []), ...(incoming.achievements ?? [])])];
  return high;
}

function mergeSettings(current: SettingsV2, incoming: DeepPartial<SettingsV2>): SettingsV2 {
  const merged = patchSettings(current, incoming);
  const game = { ...merged.game };
  const high = mergeHigh(current.game.high, incoming.game?.high);
  if (high) game.high = high;
  const a = current.game.importedThrough;
  const b = incoming.game?.importedThrough;
  if (a && b) game.importedThrough = compareKeys(a, b) >= 0 ? a : b;
  return { ...merged, game };
}

/** Which day keys `parsed` would add to `current` in missing-only mode. */
export function newDayKeys(current: Pick<SnapshotData, "days">, parsed: ImportParse): DateKey[] {
  return Object.keys(parsed.days).filter((key) => !(key in current.days)).sort(compareKeys);
}

/**
 * The snapshot to write. "missing-only" keeps every existing day and adds
 * only dates that are not stored yet; "replace" takes the imported days as
 * the whole log. The current program stays unless there is none (or, on
 * replace, the import brings one); settings are the current ones with the
 * imported fields patched in, never lowering a high-water mark.
 */
export function mergeImport(current: SnapshotData, parsed: ImportParse, options: { mode: ImportMode }): SnapshotData {
  const replace = options.mode === "replace";
  const days: DayMap = replace ? { ...parsed.days } : { ...parsed.days, ...current.days };
  const program = replace ? (parsed.program ?? current.program) : (current.program ?? parsed.program);
  return { days, program, settings: mergeSettings(current.settings, parsed.settings) };
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function buildExport(snapshot: Pick<SnapshotData, "days" | "program" | "settings">, exportedAt: string): BackupV2 {
  return { format: BACKUP_FORMAT, v: BACKUP_VERSION, exportedAt, days: snapshot.days, program: snapshot.program, settings: snapshot.settings };
}

/** "0vertrained-backup-2026-10-03.json" */
export function exportFileName(todayKey: DateKey): string {
  return `${BACKUP_FORMAT}-${todayKey}.json`;
}
