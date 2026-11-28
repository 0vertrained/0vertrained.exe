import { entryBackupError, restoreEntryBackup } from "./entryBackup";
import { supabase } from "./supabaseClient";
import { DEFAULT_COACH_PREFERENCES, normalizeCoachPreferences } from "./coachMemory";

// User ID cache
// getUser() is called on every save (every 700ms of typing). The user ID never
// changes mid-session, so we resolve it once and reuse it. On sign-out the cache
// is cleared by clearCachedUserId() so the next login gets a fresh ID.
let _cachedUserId = null;

let authRevision = 0;
export function setCachedUserId(id) {
  if (id !== _cachedUserId) authRevision++;
  _cachedUserId = id;
}
export function clearCachedUserId() { authRevision++; _cachedUserId = null; }

export function backupSession(owner) {
  const revision = authRevision;
  return () => Boolean(owner) && _cachedUserId === owner && revision === authRevision;
}

async function getUserId() {
  if (_cachedUserId) return _cachedUserId;
  const revision = authRevision;
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id ?? null;
  if (authRevision !== revision) return _cachedUserId === id ? id : null;
  if (id) setCachedUserId(id);
  return id;
}

// Entries

// Load ALL of the current user's entries, returned as a map keyed by date.
// Paginates in batches of 1000 to avoid Supabase's default row limit.
// Kept for import/export paths; the boot path now uses
// loadRecentEntries + loadOlderEntries so the blocking transfer stops growing
// with account age.
export async function loadAllEntries() {
  return (await loadAllEntriesChecked()).entries;
}

// Same pages, plus whether they all arrived, so an export can say
// when the server couldn't be reached instead of handing over a short file.
export async function loadAllEntriesChecked(owner) {
  const PAGE = 1000;
  const map = {};
  let from = 0;
  while (true) {
    let query = supabase.from("entries").select("entry_date, payload");
    if (owner) query = query.eq("user_id", owner);
    const { data, error } = await query.order("entry_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("Load failed:", error); return { entries: map, complete: false }; }
    for (const row of data) map[row.entry_date] = row.payload;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { entries: map, complete: true };
}

// PostgREST's "no row" answer to .single(). A real answer, not a
// failed read: no program row is a new account; no profile row is a signup
// that never finished (see loadSettingsChecked).
const isNoRow = (error) => error?.code === "PGRST116";

// The boot window. YYYY-MM-DD cutoff for "recent", local-date based so
// the window matches what the user sees as "the last N days".
export function entriesWindowCutoff(days = 180) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Blocking boot load: only the recent window. One indexed range query
// for any realistic account (window row count ≪ page size). Same map shape as
// loadAllEntries, so every consumer is untouched.
export async function loadRecentEntries(days = 180) {
  const PAGE = 1000;
  const cutoff = entriesWindowCutoff(days);
  const map = {};
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("entries")
      .select("entry_date, payload")
      .gte("entry_date", cutoff)
      .order("entry_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("Recent entries load failed:", error); return map; }
    for (const row of data) map[row.entry_date] = row.payload;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// Deferred history hydrate: pages everything BEFORE the cutoff, newest
// first, invoking onBatch(chunkMap) per page so the caller can merge
// progressively. Background-safe: errors log and stop (the recent window is
// already on screen; history arriving late is acceptable, history breaking
// boot is not). Returns the number of rows hydrated.
export async function loadOlderEntries(beforeDate, onBatch) {
  const PAGE = 500;
  let from = 0;
  let total = 0;
  while (true) {
    const { data, error } = await supabase
      .from("entries")
      .select("entry_date, payload")
      .lt("entry_date", beforeDate)
      .order("entry_date", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) { console.error("History hydrate failed:", error); return total; }
    if (data.length) {
      const chunk = {};
      for (const row of data) chunk[row.entry_date] = row.payload;
      total += data.length;
      try { await onBatch(chunk); } catch { return total; }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return total;
}

// Upsert a single day's entry. Uses cached user ID — no auth round-trip per save.
// Payload is size-checked before transmitting to prevent accidental oversized writes.
export async function saveEntry(entryDate, payload) {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated." };

  // Guard: reject entries over 100KB — a legitimate day's log is well under 10KB.
  // This prevents a runaway state mutation from bloating the database.
  const payloadSize = JSON.stringify(payload).length;
  if (payloadSize > 100_000) {
    console.error(`saveEntry: payload too large (${payloadSize} bytes) for ${entryDate}`);
    return { error: "Entry too large to save. Check for unexpected data." };
  }

  const { error } = await supabase.from("entries").upsert(
    { user_id: userId, entry_date: entryDate, payload },
    { onConflict: "user_id,entry_date" }
  );
  if (error) { console.error("Save failed:", error); return { error: error.message }; }
  return { ok: true };
}

// Bulk replace — used by JSON import. Validates shape before writing.
export async function importEntries(dataMap, expectedOwner) {
  const invalid = entryBackupError(dataMap);
  if (invalid) return { error: invalid };
  const userId = await getUserId();
  if (!userId || (expectedOwner && userId !== expectedOwner)) return { error: "Sign in again before importing." };

  const rows = Object.entries(restoreEntryBackup(dataMap)).map(([entry_date, payload]) => ({
    user_id: userId, entry_date, payload,
  }));
  const { error } = await supabase.from("entries").upsert(rows, { onConflict: "user_id,entry_date" });
  if (error) return { error: error.message };
  return { ok: true, count: rows.length };
}

// Program

export async function loadProgram() {
  return (await loadProgramChecked()).program;
}

// LoadProgram() answers null both for "no program saved yet" and for
// "couldn't reach the server", and the app shows DEFAULT_PROGRAM for null. At
// boot that swapped an athlete's program for the default one whenever the app
// opened offline. This keeps the two apart: error is set only for a failed read.
export async function loadProgramChecked() {
  const userId = await getUserId();
  if (!userId) return { program: null, error: "Not authenticated." };
  const { data, error } = await supabase
    .from("program")
    .select("payload")
    .eq("user_id", userId)
    .single();
  if (error) return isNoRow(error) ? { program: null, error: null } : { program: null, error: error.message || "Program read failed" };
  return { program: data?.payload ?? null, error: null };
}

export async function saveProgram(programPayload) {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated." };
  const { error } = await supabase.from("program").upsert(
    { user_id: userId, payload: programPayload },
    { onConflict: "user_id" }
  );
  if (error) return { error: error.message };
  return { ok: true };
}

// Settings

export const DEFAULT_SETTINGS = {
  goals: {
    calories: 3600,
    protein: 200,
    carbs: 400,
    fats: 100,
    water: 128,
  },
  supplements: [
    "Creatine", "Whey", "Pre-WO", "Multivitamin",
    "Fish Oil", "Vitamin D", "Magnesium", "BCAAs", "Caffeine", "Electrolytes"
  ],
  dietaryRestrictions: [],
  theme: "whitepaperLight",
  trainingCues: { haptics: true, restAudio: false },
  onboarded: false,
  // First-run setup summary. Null fields until onboarding completes; the
  // app treats a missing/empty setup as "manual, not yet configured" — never
  // as an error, so older profiles keep working untouched.
  setup: {
    goal: null,
    dataMode: null,
    macroPreset: null,
    completedAt: null,
  },
  // Program Builder preferences. Null/empty until the athlete generates a
  // plan; a missing key is treated as "never used the builder" — never an error,
  // so older profiles keep working untouched.
  programBuilder: {
    goal: null,
    trainingDaysPerWeek: null,
    restDays: [],
    longRunDay: null,
    equipment: null,
    experience: null,
    sessionLength: null,
    cardioPreference: null,
    includeIntervals: null,
    varietyMode: "balanced",
    lastGeneratedAt: null,
  },
  // Coach Memory preferences. Disabled by default — the coach behaves
  // exactly as before until the athlete opts in. Suggest-only; never edits
  // programs or scores. See src/coachMemory.js for the normalization contract.
  coachPreferences: { ...DEFAULT_COACH_PREFERENCES },
};

export async function loadSettings() {
  return (await loadSettingsChecked()).settings;
}

// LoadSettings() answers DEFAULT_SETTINGS when the read fails, which
// looks exactly like a brand-new account (onboarded: false). At boot that put
// the setup wizard in front of an existing athlete who opened the app offline,
// and the next settings save could write the defaults over their profile.
// Same answer here, plus `error` when the read failed and `missing` when the
// account has no profile row at all (a signup whose profile insert failed
// and couldn't be healed — nothing can be saved for it until it exists).
export async function loadSettingsChecked() {
  const userId = await getUserId();
  if (!userId) return { settings: { ...DEFAULT_SETTINGS, username: null }, error: "Not authenticated.", missing: false };
  const { data, error } = await supabase
    .from("profiles")
    .select("settings, username")
    .eq("id", userId)
    .single();
  if (error) {
    const missing = isNoRow(error);
    return { settings: { ...DEFAULT_SETTINGS, username: null }, error: missing ? null : (error.message || "Settings read failed"), missing };
  }
  return { settings: normalizeStoredSettings(data), error: null, missing: false };
}

function normalizeStoredSettings(data) {
  const s = data?.settings || {};
  return {
    // Spread first so any stored field the app relies on (ouraConnected,
    // hrvSource, future keys) survives; normalized fields below then win.
    ...s,
    goals: { ...DEFAULT_SETTINGS.goals, ...(s.goals || {}) },
    supplements: s.supplements || DEFAULT_SETTINGS.supplements,
    dietaryRestrictions: s.dietaryRestrictions || DEFAULT_SETTINGS.dietaryRestrictions,
    theme: (function(th) {
      if (th === "minimal" || th === "instrumentLight") return "whitepaperLight";
      if (th === "instrument") return "whitepaperDark";
      if (th === "whitepaperLight" || th === "whitepaperDark" || th === "terminal") return th;
      return "whitepaperLight";
    })(s.theme),
    onboarded: s.onboarded === true || s.onboarded === "true",
    trainingCues: { ...DEFAULT_SETTINGS.trainingCues, ...(s.trainingCues || {}) },
    // Merge setup over defaults so older profiles (no setup key) still load.
    setup: { ...DEFAULT_SETTINGS.setup, ...(s.setup || {}) },
    // Merge programBuilder over defaults so older profiles (no key) still load.
    programBuilder: { ...DEFAULT_SETTINGS.programBuilder, ...(s.programBuilder || {}) },
    // Normalize coachPreferences so unknown enum values snap to defaults and a
    // older profile (no key) loads as disabled. Never trusts raw stored blob.
    coachPreferences: normalizeCoachPreferences(s.coachPreferences),
    username: data?.username || null,
  };
}

export async function saveSettings(settings) {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated." };
  const { error } = await supabase.from("profiles").update({ settings }).eq("id", userId);
  if (error) { console.error("saveSettings failed:", error); return { error: error.message }; }
  return { ok: true };
}

// Patch a single key in the settings JSONB column without overwriting the rest.
export async function patchSetting(key, value) {
  const userId = await getUserId();
  if (!userId) return;
  const { data: current } = await supabase
    .from("profiles").select("settings").eq("id", userId).single();
  const merged = { ...(current?.settings || {}), [key]: value };
  await supabase.from("profiles").update({ settings: merged }).eq("id", userId);
}

// Merge a few keys into the stored settings, server-side, and report
// the result. Integrations uses it to save a confirmed connection flag. Unlike
// patchSetting() above, a failed read aborts: writing the patch over an empty
// object would wipe the profile. Merging into the server's copy (rather than
// saving this device's whole settings object) also means a device holding
// stale or default settings can't overwrite the real ones.
export async function patchSettings(patch) {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated." };
  const { data, error } = await supabase.from("profiles").select("settings").eq("id", userId).single();
  if (error || !data) return { error: error?.message || "Settings read failed" };
  const merged = { ...(data.settings || {}), ...patch };
  const { error: writeError } = await supabase.from("profiles").update({ settings: merged }).eq("id", userId);
  if (writeError) return { error: writeError.message };
  return { ok: true };
}
