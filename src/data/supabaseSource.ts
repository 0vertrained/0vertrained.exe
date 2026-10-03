// The signed-in data source: the athlete's rows in Supabase, behind the same
// DataSource contract the guest source implements. Own-row RLS scopes every
// query to the signed-in user; the user id is still sent as a filter so the
// intent is explicit and the (user_id, entry_date) index is used. The
// client is the structural DbClient in supabaseTypes.ts, so this file never
// imports supabase-js and the guest build stays free of it.
//
// Days save through the `save_day` RPC with the row's last known updated_at
// as the base (the epoch for a day never seen, since the server treats a
// null base as a deliberate overwrite and an unseen row must merge, not
// vanish). When another device wrote since, the server answers "conflict"
// with its copy instead of writing, and the day is merged three ways (the
// loaded copy as base) and retried once; a second conflict adopts the
// server copy as the new base and rejects with "conflict" so the save queue
// keeps the job. Settings save through `patch_settings`, a recursive
// merge where JSON null deletes: every optional key v20 knows is sent, null
// when absent, so a save is a faithful replace of the document (keys v20
// does not know survive and are ignored on read). Errors from the client
// reject as Error(message) with the DbError as cause; a thrown network
// error passes through untouched. Reads go through the domain normalisers.

import { isDateKey, type DateKey } from "../domain/dates";
import { normalizeDay } from "../domain/day/normalize";
import type { DayMap, DayV2 } from "../domain/day/schema";
import { normalizeProgramPayload } from "../domain/program/normalize";
import type { ProgramPayloadV2 } from "../domain/program/types";
import type { DataSource, Snapshot, SnapshotData } from "./DataSource";
import { mergeDay } from "./mergeDay";
import { normalizeSettings, type SettingsV2 } from "./settings";
import type { DbClient, DbError, DbResult, Row } from "./supabaseTypes";

export const DEFAULT_PAGE_SIZE = 1000;
/** Rows per upsert call in replaceAll. */
export const UPSERT_CHUNK = 50;
/** The message of the rejection when a day could not be saved even after merging. */
export const CONFLICT_MESSAGE = "conflict";
/** The base sent for a day this source has never seen: any existing row is newer, so the server reports a conflict instead of overwriting. */
export const UNKNOWN_BASE = "1970-01-01T00:00:00.000Z";

export interface DayMerge {
  dateKey: DateKey;
  /** Ours merged with the server's copy; the provider should adopt it as the day's state. */
  merged: DayV2;
}

export interface LoadStats {
  days: number;
  pages: number;
  /** Rows whose entry_date was not a date key (never expected; counted, not loaded). */
  skipped: number;
}

export interface SupabaseSourceOptions {
  /** Entries per page on load; default DEFAULT_PAGE_SIZE. */
  pageSize?: number;
  /**
   * Called whenever a save found a newer server copy and merged ours with
   * it, whether or not the merged day then landed (after a second conflict
   * the save rejects with CONFLICT_MESSAGE and the queue retries with the
   * provider's state, so the provider should replace that state with
   * `merged` to keep what the other device logged).
   */
  onMerge?: (merge: DayMerge) => void;
}

export interface SupabaseSource extends DataSource {
  readonly kind: "supabase";
  /** The most recent merge (see SupabaseSourceOptions.onMerge). */
  readonly lastMerge: DayMerge | undefined;
  /** What the last successful load saw. */
  readonly lastLoad: LoadStats | undefined;
}

/** What a day's next save is compared against: the server stamp and the copy both sides share. */
interface Base {
  updatedAt: string | null;
  day: DayV2;
}

interface SaveDayResult {
  status: "ok" | "conflict";
  payload: unknown;
  updatedAt: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The rejection for a failed query: the server's message, the DbError as cause. */
export function toError(error: DbError): Error {
  return new Error(error.message, { cause: error });
}

function unwrap<T>(result: DbResult<T>): T | null {
  if (result.error) throw toError(result.error);
  return result.data;
}

/** Deletes every top-level key, so the document reads as the defaults. */
const RESET_PATCH: Obj = { v: null, units: null, bodyweightKg: null, onboarded: null, profile: null, session: null, game: null };

/**
 * The patch_settings argument that replaces the whole document: every
 * optional key is present, null (= delete) when it is absent. An explicit
 * null (game.title, game.bodyweightKg) is deleted too and reads back as
 * absent, which the app treats the same.
 */
export function settingsPatch(settings: SettingsV2): Obj {
  const { profile, session, game } = settings;
  const high = game.high;
  return {
    v: 2,
    units: settings.units,
    bodyweightKg: settings.bodyweightKg ?? null,
    onboarded: settings.onboarded,
    profile: { name: profile.name ?? null, featuredTitle: profile.featuredTitle ?? null },
    session: { ...session },
    game: {
      title: game.title ?? null,
      bodyweightKg: game.bodyweightKg ?? null,
      startedOn: game.startedOn ?? null,
      importedThrough: game.importedThrough ?? null,
      pauses: game.pauses ?? null,
      high: high ? { rank: high.rank ?? null, trialsPassed: high.trialsPassed ?? null, achievements: high.achievements ?? null } : null,
    },
  };
}

function parseSaveDay(data: unknown): SaveDayResult {
  // A function returning jsonb gives one object; one returning a row set gives a list.
  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (!isObj(row) || (row.status !== "ok" && row.status !== "conflict")) throw new Error("save_day returned an unexpected response");
  return { status: row.status, payload: row.payload, updatedAt: typeof row.updated_at === "string" ? row.updated_at : null };
}

export function createSupabaseSource(client: DbClient, userId: string, options: SupabaseSourceOptions = {}): SupabaseSource {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE));
  let bases = new Map<DateKey, Base>();
  let lastMerge: DayMerge | undefined;
  let lastLoad: LoadStats | undefined;

  /** Every own entry, `columns` wide, page by page until a short page. */
  async function pageEntries(columns: string, onRow: (row: Row) => void): Promise<number> {
    let pages = 0;
    for (let from = 0; ; from += pageSize) {
      const query = client.from("entries").select(columns).match({ user_id: userId }).order("entry_date", { ascending: false }).range(from, from + pageSize - 1);
      const rows = unwrap(await query) ?? [];
      pages += 1;
      for (const row of rows) onRow(row);
      if (rows.length < pageSize) return pages;
    }
  }

  async function callSaveDay(dateKey: DateKey, day: DayV2, base: string): Promise<SaveDayResult> {
    return parseSaveDay(unwrap(await client.rpc("save_day", { p_date: dateKey, p_payload: day, p_base: base })));
  }

  function noteMerge(dateKey: DateKey, merged: DayV2): void {
    lastMerge = { dateKey, merged };
    options.onMerge?.(lastMerge);
  }

  async function deleteEntries(dateKey?: DateKey): Promise<void> {
    unwrap(await client.from("entries").delete().match(dateKey === undefined ? { user_id: userId } : { user_id: userId, entry_date: dateKey }));
  }

  async function patchSettings(patch: Obj): Promise<void> {
    unwrap(await client.rpc("patch_settings", { patch }));
  }

  async function load(): Promise<Snapshot> {
    const days: DayMap = {};
    const next = new Map<DateKey, Base>();
    let skipped = 0;
    const [pages, programRow, profileRow] = await Promise.all([
      pageEntries("entry_date, payload, updated_at", (row) => {
        const key = row.entry_date;
        if (!isDateKey(key)) {
          skipped += 1;
          return;
        }
        const day = normalizeDay(row.payload);
        days[key] = day;
        next.set(key, { updatedAt: typeof row.updated_at === "string" ? row.updated_at : null, day });
      }),
      client.from("program").select("payload").match({ user_id: userId }).maybeSingle().then(unwrap),
      client.from("profiles").select("settings").match({ id: userId }).maybeSingle().then(unwrap),
    ]);
    bases = next;
    lastLoad = { days: next.size, pages, skipped };
    // No profile row yet is not an error: the account simply has default settings.
    return { days, program: normalizeProgramPayload(programRow?.payload ?? null), settings: normalizeSettings(profileRow?.settings), historyComplete: true };
  }

  async function saveDay(dateKey: DateKey, day: DayV2): Promise<void> {
    const known = bases.get(dateKey);
    const first = await callSaveDay(dateKey, day, known?.updatedAt ?? UNKNOWN_BASE);
    if (first.status === "ok") {
      bases.set(dateKey, { updatedAt: first.updatedAt, day });
      return;
    }
    const theirs = normalizeDay(first.payload);
    const merged = mergeDay(known?.day, day, theirs);
    const second = await callSaveDay(dateKey, merged, first.updatedAt ?? UNKNOWN_BASE);
    if (second.status === "ok") {
      bases.set(dateKey, { updatedAt: second.updatedAt, day: merged });
      noteMerge(dateKey, merged);
      return;
    }
    // Written again meanwhile: the server copy becomes the base, and the
    // provider gets everything merged so the queued retry carries it all.
    const latest = normalizeDay(second.payload);
    bases.set(dateKey, { updatedAt: second.updatedAt, day: latest });
    noteMerge(dateKey, mergeDay(theirs, merged, latest));
    throw new Error(CONFLICT_MESSAGE, { cause: { dateKey, updatedAt: second.updatedAt } });
  }

  async function deleteDay(dateKey: DateKey): Promise<void> {
    await deleteEntries(dateKey);
    bases.delete(dateKey);
  }

  async function saveProgram(program: ProgramPayloadV2 | null): Promise<void> {
    if (program === null) unwrap(await client.from("program").delete().match({ user_id: userId }));
    else unwrap(await client.from("program").upsert({ user_id: userId, payload: program }, { onConflict: "user_id" }));
  }

  async function saveSettings(settings: SettingsV2): Promise<void> {
    await patchSettings(settingsPatch(normalizeSettings(settings)));
  }

  /**
   * Not atomic: a failure midway leaves the account partly replaced, and
   * the import is simply run again. Keys in the stored settings that v20
   * does not know survive the patch (and are ignored on read).
   */
  async function replaceAll(snapshot: SnapshotData): Promise<void> {
    await deleteEntries();
    bases = new Map();
    const entries = Object.entries(snapshot.days).filter(([key]) => isDateKey(key));
    for (let i = 0; i < entries.length; i += UPSERT_CHUNK) {
      const rows = entries.slice(i, i + UPSERT_CHUNK).map(([entry_date, payload]) => ({ user_id: userId, entry_date, payload }));
      unwrap(await client.from("entries").upsert(rows, { onConflict: "user_id,entry_date" }));
    }
    await saveProgram(snapshot.program);
    await saveSettings(snapshot.settings);
    // Learn the stamps the upserts got, so the first edit of an imported day saves without a conflict round trip.
    const uploaded = new Map(entries);
    const next = new Map<DateKey, Base>();
    await pageEntries("entry_date, updated_at", (row) => {
      const key = row.entry_date;
      if (!isDateKey(key)) return;
      const day = uploaded.get(key);
      if (day) next.set(key, { updatedAt: typeof row.updated_at === "string" ? row.updated_at : null, day });
    });
    bases = next;
  }

  /** Wipes days, program and settings (the profile row itself, username included, stays). */
  async function clear(): Promise<void> {
    await deleteEntries();
    bases = new Map();
    await saveProgram(null);
    await patchSettings(RESET_PATCH);
  }

  return {
    kind: "supabase",
    get lastMerge() {
      return lastMerge;
    },
    get lastLoad() {
      return lastLoad;
    },
    load,
    saveDay,
    deleteDay,
    saveProgram,
    saveSettings,
    replaceAll,
    clear,
  };
}
