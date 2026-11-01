import { supabase } from "./supabaseClient";
import { DEFAULT_COACH_PREFERENCES, normalizeCoachPreferences } from "./coachMemory";

// ─── User ID cache ─────────────────────────────────────────────────────────────
// getUser() is called on every save (every 700ms of typing). The user ID never
// changes mid-session, so we resolve it once and reuse it. On sign-out the cache
// is cleared by clearCachedUserId() so the next login gets a fresh ID.
let _cachedUserId = null;

export function setCachedUserId(id) { _cachedUserId = id; }
export function clearCachedUserId() { _cachedUserId = null; }

async function getUserId() {
  if (_cachedUserId) return _cachedUserId;
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id ?? null;
  if (id) _cachedUserId = id;
  return id;
}

// ─── Entries ───────────────────────────────────────────────────────────────────

// Load ALL of the current user's entries, returned as a map keyed by date.
// Paginates in batches of 1000 to avoid Supabase's default row limit.
// V14.3 · Kept for import/export paths; the boot path now uses
// loadRecentEntries + loadOlderEntries so the blocking transfer stops growing
// with account age (perf plan P1-1).
export async function loadAllEntries() {
  return (await loadAllEntriesChecked()).entries;
}

// V19.4 · Same pages, plus whether they all arrived, so an export can say
// when the server couldn't be reached instead of handing over a short file.
export async function loadAllEntriesChecked() {
  const PAGE = 1000;
  const map = {};
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("entries")
      .select("entry_date, payload")
      .order("entry_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("Load failed:", error); return { entries: map, complete: false }; }
    for (const row of data) map[row.entry_date] = row.payload;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { entries: map, complete: true };
}

// V19.4 · PostgREST's "no row" answer to .single(). A real answer, not a
// failed read: no program row is a new account; no profile row is a signup
// that never finished (see loadSettingsChecked).
const isNoRow = (error) => error?.code === "PGRST116";

// V14.3 · The boot window. YYYY-MM-DD cutoff for "recent", local-date based so
// the window matches what the user sees as "the last N days".
export function entriesWindowCutoff(days = 180) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// V14.3 · Blocking boot load: only the recent window. One indexed range query
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

// V14.3 · Deferred history hydrate: pages everything BEFORE the cutoff, newest
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
export async function importEntries(dataMap) {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated." };

  // Validate: must be a plain object with date-like keys
  if (typeof dataMap !== "object" || Array.isArray(dataMap)) {
    return { error: "Import failed: expected an object keyed by date." };
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const validEntries = Object.entries(dataMap).filter(([k, v]) =>
    DATE_RE.test(k) && typeof v === "object" && v !== null
  );
  if (validEntries.length === 0) return { error: "Import failed: no valid entries found." };
  if (validEntries.length > 3000) return { error: "Import too large (max 3000 days)." };

  const rows = validEntries.map(([entry_date, payload]) => ({
    user_id: userId, entry_date, payload,
  }));
  const { error } = await supabase.from("entries").upsert(rows, { onConflict: "user_id,entry_date" });
  if (error) return { error: error.message };
  return { ok: true, count: rows.length };
}

// ─── Program ───────────────────────────────────────────────────────────────────

export async function loadProgram() {
  return (await loadProgramChecked()).program;
}

// V19.4 · loadProgram() answers null both for "no program saved yet" and for
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

// ─── Social: Leaderboard + PRs ────────────────────────────────────────────────

export async function loadLeaderboard(periodDays = 7) {
  const { data, error } = await supabase.rpc("get_leaderboard", { period_days: periodDays });
  if (error) { console.error("Leaderboard load failed:", error); return []; }
  return data || [];
}

export async function loadLiftingPRs() {
  const { data, error } = await supabase.rpc("get_lifting_prs");
  if (error) { console.error("Lifting PR load failed:", error); return []; }
  return data || [];
}

export async function loadRunningPRs() {
  const { data, error } = await supabase.rpc("get_running_prs");
  if (error) { console.error("Running PR load failed:", error); return []; }
  return data || [];
}

export async function loadSocialSummary(periodDays = 7) {
  const { data, error } = await supabase.rpc("get_social_summary", { period_days: periodDays });
  if (error) { console.error("Social summary load failed:", error); return { ok: false, error }; }
  return { ok: true, data };
}

// ─── Social Circles (V4.5) ─────────────────────────────────────────────────────
// Private, invite-only aggregate circles. Each wrapper returns { ok, data } or
// { ok:false, error }. The RPC itself returns a jsonb envelope with its own `ok`
// flag for domain errors (invalid code, not a member, etc.); we surface that as
// data so the UI can show specific copy. A thrown/absent-RPC error (e.g. the
// migration hasn't been applied yet) comes back as { ok:false, error } so the UI
// can fail gracefully and point to the migration.
export async function listMyCircles() {
  const { data, error } = await supabase.rpc("list_my_circles");
  if (error) { console.error("List circles failed:", error); return { ok: false, error }; }
  return { ok: true, data };
}

export async function createCircle(name) {
  const { data, error } = await supabase.rpc("create_circle", { p_name: name });
  if (error) { console.error("Create circle failed:", error); return { ok: false, error }; }
  return { ok: true, data };
}

export async function joinCircle(code) {
  const { data, error } = await supabase.rpc("join_circle", { p_code: code });
  if (error) { console.error("Join circle failed:", error); return { ok: false, error }; }
  return { ok: true, data };
}

export async function loadCircleSummary(circleId, periodDays = 7) {
  const { data, error } = await supabase.rpc("get_circle_summary", { p_circle: circleId, period_days: periodDays });
  if (error) { console.error("Circle summary failed:", error); return { ok: false, error }; }
  return { ok: true, data };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

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
  socialOptIn: false,
  theme: "whitepaperLight",
  trainingCues: { haptics: true, restAudio: false },
  onboarded: false,
  // V2.2 first-run setup summary. Null fields until onboarding completes; the
  // app treats a missing/empty setup as "manual, not yet configured" — never
  // as an error, so pre-V2.2 profiles keep working untouched.
  setup: {
    goal: null,
    dataMode: null,
    macroPreset: null,
    completedAt: null,
  },
  // V2.3 Program Builder preferences. Null/empty until the athlete generates a
  // plan; a missing key is treated as "never used the builder" — never an error,
  // so pre-V2.3 profiles keep working untouched.
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
  // V4.5 Coach Memory preferences. Disabled by default — the coach behaves
  // exactly as before until the athlete opts in. Suggest-only; never edits
  // programs or scores. See src/coachMemory.js for the normalization contract.
  coachPreferences: { ...DEFAULT_COACH_PREFERENCES },
};

export async function loadSettings() {
  return (await loadSettingsChecked()).settings;
}

// V19.4 · loadSettings() answers DEFAULT_SETTINGS when the read fails, which
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
    socialOptIn: s.socialOptIn === true || s.socialOptIn === "true",
    theme: (function(th) {
      if (th === "minimal" || th === "instrumentLight") return "whitepaperLight";
      if (th === "instrument") return "whitepaperDark";
      if (th === "whitepaperLight" || th === "whitepaperDark" || th === "terminal") return th;
      return "whitepaperLight";
    })(s.theme),
    onboarded: s.onboarded === true || s.onboarded === "true",
    trainingCues: { ...DEFAULT_SETTINGS.trainingCues, ...(s.trainingCues || {}) },
    // Merge setup over defaults so pre-V2.2 profiles (no setup key) still load.
    setup: { ...DEFAULT_SETTINGS.setup, ...(s.setup || {}) },
    // Merge programBuilder over defaults so pre-V2.3 profiles (no key) still load.
    programBuilder: { ...DEFAULT_SETTINGS.programBuilder, ...(s.programBuilder || {}) },
    // Normalize coachPreferences so unknown enum values snap to defaults and a
    // pre-V4.5 profile (no key) loads as disabled. Never trusts raw stored blob.
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

// V19.4 · Merge a few keys into the stored settings, server-side, and report
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
