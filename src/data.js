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
  const PAGE = 1000;
  const map = {};
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("entries")
      .select("entry_date, payload")
      .order("entry_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("Load failed:", error); return map; }
    for (const row of data) map[row.entry_date] = row.payload;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// v19.2.1 · Full backup. Every entry straight from the server (not the boot
// window held in memory), plus program and settings, in one versioned
// envelope that both this app and the v20 importer read. Unlike
// loadAllEntries it fails instead of returning a partial map, so an
// incomplete backup is never mistaken for a complete one.
export const BACKUP_FORMAT = "0vertrained-backup";

export async function loadBackupSnapshot() {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated." };
  const PAGE = 1000;
  const entries = {};
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("entries")
      .select("entry_date, payload")
      .order("entry_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message || "Couldn't read your entries." };
    for (const row of data) entries[row.entry_date] = row.payload;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const [programRes, profileRes] = await Promise.all([
    supabase.from("program").select("payload").eq("user_id", userId).single(),
    supabase.from("profiles").select("settings, username").eq("id", userId).single(),
  ]);
  if (programRes.error && programRes.error.code !== "PGRST116") {
    return { error: programRes.error.message || "Couldn't read your program." };
  }
  if (profileRes.error) return { error: profileRes.error.message || "Couldn't read your settings." };
  return {
    ok: true,
    entries,
    program: programRes.data?.payload ?? null,
    settings: profileRes.data?.settings ?? {},
    username: profileRes.data?.username ?? null,
  };
}

export function buildBackupEnvelope({ entries, program, settings, username, appVersion, exportedAt }) {
  return {
    format: BACKUP_FORMAT,
    v: 1,
    exportedAt,
    appVersion,
    username: username ?? null,
    counts: { days: Object.keys(entries || {}).length },
    entries: entries || {},
    program: program ?? null,
    settings: settings ?? {},
  };
}

// Import accepts the full-backup envelope or the older raw {date: payload} map.
export function entriesFromImport(parsed) {
  if (parsed && parsed.format === BACKUP_FORMAT && parsed.entries && typeof parsed.entries === "object") {
    return parsed.entries;
  }
  return parsed;
}

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

// v19.2.1 · Same whole-payload hazard as settings: a failed read used to look
// like "no program", the app fell back to DEFAULT_PROGRAM, and the next edit
// saved defaults over the athlete's real program. "No row yet" (PGRST116) is
// a normal new-user state; any other error blocks program writes until a read
// succeeds.
let programLoadedForUser = null;
let programLoadFailedForUser = null;

export async function loadProgram() {
  const userId = await getUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("program")
    .select("payload")
    .eq("user_id", userId)
    .single();
  if (error && error.code !== "PGRST116") {
    if (programLoadedForUser === userId) programLoadedForUser = null;
    programLoadFailedForUser = userId;
    console.error("loadProgram failed:", error);
    return null;
  }
  programLoadedForUser = userId;
  programLoadFailedForUser = null;
  if (!data) return null;
  return data.payload;
}

// True when the most recent loadProgram() for this user hit a real error (as
// opposed to "no program saved yet"), so callers keep their cached copy.
export function programLoadFailed(userId) {
  return Boolean(userId) && programLoadFailedForUser === userId;
}

export async function saveProgram(programPayload) {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated." };
  if (programLoadedForUser !== userId) {
    return { error: "Your program hasn't loaded yet — reconnect and try again." };
  }
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

// v19.2.1 · Settings are one JSONB blob written whole, so a write is only safe
// once this session has read the server copy. Before this guard, a failed read
// returned DEFAULT_SETTINGS, the app cached it, and the next save overwrote the
// athlete's real settings with defaults.
let settingsLoadedForUser = null;

// Returns the normalized settings, or null when the server read fails (the
// caller keeps whatever it already has). Signed-out callers get defaults.
export async function loadSettings() {
  const userId = await getUserId();
  if (!userId) return { ...DEFAULT_SETTINGS, username: null };
  const { data, error } = await supabase
    .from("profiles")
    .select("settings, username")
    .eq("id", userId)
    .single();
  if (error) {
    if (settingsLoadedForUser === userId) settingsLoadedForUser = null;
    console.error("loadSettings failed:", error);
    return null;
  }
  settingsLoadedForUser = userId;
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
    username: data.username || null,
  };
}

export async function saveSettings(settings) {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated." };
  if (settingsLoadedForUser !== userId) {
    return { error: "Settings haven't loaded yet — reconnect and try again." };
  }
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
