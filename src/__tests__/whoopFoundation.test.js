// V2.9 Whoop Foundation — static security assertions + pure normalization tests.
//
// These tests are deterministic and NOT network-dependent. They read the
// migration SQL, the Netlify function source, the client modules, and the
// Settings screen and assert the security-sensitive invariants of the sprint,
// plus behavioural checks on the pure normalization helpers with synthetic
// payloads. No live Whoop calls are made and no real credentials are used.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  normalizeRecovery,
  normalizeSleep,
  normalizeCycle,
  normalizeWorkout,
  buildWhoopSummary,
  latestWhoopDate,
} from "../whoop/normalization";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

const migrationSql = read("supabase/migration_add_whoop.sql");
const migrationLower = migrationSql.toLowerCase();
const fnSrc = read("netlify/functions/whoop-auth.js");
const authSrc = read("src/whoop/auth.js");
const dataSrc = read("src/whoop/dataLoading.js");
const settingsSrc = read("src/SettingsScreen.jsx");

// ─── Migration ───────────────────────────────────────────────────────────────
describe("V2.9 migration — tables + RLS + grants", () => {
  test("creates whoop_oauth_state with 8-char state PK, RLS, server-only grants", () => {
    expect(migrationLower).toMatch(/create table if not exists public\.whoop_oauth_state/);
    expect(migrationLower).toMatch(/state\s+char\(8\)\s+primary key/);
    expect(migrationLower).toMatch(/user_id\s+uuid\s+not null\s+references auth\.users\(id\)\s+on delete cascade/);
    expect(migrationLower).toMatch(/alter table public\.whoop_oauth_state enable row level security/);
    expect(migrationLower).toMatch(/revoke all on public\.whoop_oauth_state from anon, authenticated/);
    expect(migrationLower).toMatch(/grant all on public\.whoop_oauth_state to service_role/);
  });

  test("whoop_tokens is server-only (revoked from anon/authenticated, service_role only)", () => {
    expect(migrationLower).toMatch(/create table if not exists public\.whoop_tokens/);
    expect(migrationLower).toMatch(/access_token\s+text\s+not null/);
    expect(migrationLower).toMatch(/refresh_token\s+text\s+not null/);
    expect(migrationLower).toMatch(/unique\(user_id\)/);
    expect(migrationLower).toMatch(/alter table public\.whoop_tokens enable row level security/);
    expect(migrationLower).toMatch(/revoke all on public\.whoop_tokens from anon, authenticated/);
    expect(migrationLower).toMatch(/grant all on public\.whoop_tokens to service_role/);
    // No SELECT grant to authenticated for the token table.
    expect(migrationLower).not.toMatch(/grant select on public\.whoop_tokens to authenticated/);
    expect(migrationLower).not.toMatch(/grant all on public\.whoop_tokens to authenticated/);
  });

  test("whoop_data has owner SELECT policy and the 4-part unique conflict key", () => {
    expect(migrationLower).toMatch(/create table if not exists public\.whoop_data/);
    expect(migrationLower).toMatch(/data_type in \('recovery', 'sleep', 'cycle', 'workout', 'body_measurement'\)/);
    expect(migrationLower).toMatch(/unique\(user_id, date, data_type, external_id\)/);
    expect(migrationLower).toMatch(/alter table public\.whoop_data enable row level security/);
    expect(migrationLower).toMatch(/create policy "whoop_data_select_own"[\s\S]*?using \(auth\.uid\(\) = user_id\)/);
    expect(migrationLower).toMatch(/revoke all on public\.whoop_data from anon/);
    expect(migrationLower).toMatch(/grant select on public\.whoop_data to authenticated/);
    expect(migrationLower).toMatch(/grant all on public\.whoop_data to service_role/);
    // Owner may read but not write directly — no insert/update/delete policy.
    expect(migrationLower).not.toMatch(/whoop_data.*for insert/);
    expect(migrationLower).not.toMatch(/whoop_data.*for update/);
    expect(migrationLower).not.toMatch(/whoop_data.*for delete/);
  });

  test("declares the required indexes", () => {
    expect(migrationLower).toMatch(/idx_whoop_tokens_user_id[\s\S]*?whoop_tokens\(user_id\)/);
    expect(migrationLower).toMatch(/idx_whoop_oauth_state_expires_at[\s\S]*?whoop_oauth_state\(expires_at\)/);
    expect(migrationLower).toMatch(/idx_whoop_data_user_date_type[\s\S]*?whoop_data\(user_id, date desc, data_type\)/);
  });

  test("patches delete_my_account_data to also purge whoop tables", () => {
    expect(migrationLower).toMatch(/delete_my_account_data/);
    expect(migrationLower).toMatch(/delete from public\.whoop_data\s+where user_id = uid/);
    expect(migrationLower).toMatch(/delete from public\.whoop_tokens\s+where user_id = uid/);
    expect(migrationLower).toMatch(/delete from public\.whoop_oauth_state where user_id = uid/);
  });
});

// ─── Netlify function security ───────────────────────────────────────────────
describe("V2.9 whoop-auth.js — OAuth + sync security", () => {
  test("uses the documented Whoop URLs, v2 base, and requested scopes", () => {
    expect(fnSrc).toContain("https://api.prod.whoop.com/oauth/oauth2/auth");
    expect(fnSrc).toContain("https://api.prod.whoop.com/oauth/oauth2/token");
    expect(fnSrc).toContain("https://api.prod.whoop.com/developer/v2");
    expect(fnSrc).toContain("read:recovery read:sleep read:cycles read:workout offline");
  });

  test("mints an exactly-8-char state and stores it in whoop_oauth_state", () => {
    expect(fnSrc).toMatch(/STATE_LEN\s*=\s*8/);
    expect(fnSrc).toContain("whoop_oauth_state");
    // Callback validates state length and derives user from the state table.
    expect(fnSrc).toMatch(/state\.length !== STATE_LEN/);
    expect(fnSrc).toMatch(/consumeState\(/);
  });

  test("callback does NOT trust a query-string user_id and sync does NOT trust body user_id", () => {
    // The callback derives ownership only from consumeState (the state table).
    expect(fnSrc).not.toMatch(/searchParams\.get\(["']user_id["']\)/);
    // Sync resolves the user from the verified Bearer token, never req body.
    const syncFn = fnSrc.slice(fnSrc.indexOf("async function handleSync"));
    expect(syncFn).toMatch(/resolveUserIdFromBearer\(req\)/);
    expect(syncFn).not.toMatch(/body\?\.user_id/);
    expect(syncFn).not.toMatch(/body\.user_id/);
  });

  test("never exposes WHOOP_CLIENT_SECRET to the browser and uses form-encoded token calls", () => {
    // The secret is read only from process.env (server), never a VITE_ var.
    expect(fnSrc).toContain("process.env.WHOOP_CLIENT_SECRET");
    expect(fnSrc).not.toMatch(/VITE_WHOOP_CLIENT_SECRET/);
    expect(fnSrc).toMatch(/application\/x-www-form-urlencoded/);
  });

  test("has redaction helpers and does not log raw payloads or tokens", () => {
    expect(fnSrc).toMatch(/function redactSensitive/);
    expect(fnSrc).toMatch(/REDACTED_PAYLOAD/);
    // No console line logs a raw token/payload variable directly.
    expect(fnSrc).not.toMatch(/console\.\w+\([^)]*\baccess_token\b\s*[,)]/);
    expect(fnSrc).not.toMatch(/console\.\w+\([^)]*\brefresh_token\b\s*[,)]/);
    expect(fnSrc).not.toMatch(/JSON\.stringify\(\s*payload\s*\)/);
  });

  test("declares JSON security headers and the /api/whoop/* route", () => {
    expect(fnSrc).toMatch(/x-content-type-options/);
    expect(fnSrc).toMatch(/path:\s*["']\/api\/whoop\/\*["']/);
    for (const route of ["/api/whoop/auth", "/api/whoop/callback", "/api/whoop/status", "/api/whoop/sync", "/api/whoop/disconnect"]) {
      expect(fnSrc).toContain(route);
    }
  });

  test("callback redirect never includes tokens", () => {
    expect(fnSrc).toMatch(/whoop=connected/);
    // The success redirect string carries only a status flag.
    expect(fnSrc).not.toMatch(/redirect\([^)]*access_token/);
  });

  test("exposes the V2.9.2 /api/whoop/counts endpoint and routes it", () => {
    expect(fnSrc).toContain("/api/whoop/counts");
    expect(fnSrc).toMatch(/function handleCounts/);
    expect(fnSrc).toMatch(/pathname\.endsWith\(["']\/api\/whoop\/counts["']\)/);
  });

  test("sync endpoint accepts an optional ?days= backfill window", () => {
    expect(fnSrc).toMatch(/searchParams\.get\(["']days["']\)/);
    expect(fnSrc).toMatch(/MAX_SYNC_DAYS/);
  });
});

// ─── Client modules ──────────────────────────────────────────────────────────
describe("V2.9 client whoop modules", () => {
  test("call /api/whoop/* and never read the whoop_tokens table", () => {
    expect(authSrc).toContain("/api/whoop/auth");
    expect(authSrc).toContain("/api/whoop/status");
    expect(authSrc).toContain("/api/whoop/sync");
    expect(authSrc).toContain("/api/whoop/disconnect");
    // No PostgREST/Supabase read of the token table from the browser (comments
    // may mention the table name, but there must be no actual query against it).
    expect(authSrc).not.toMatch(/from\(["']whoop_tokens["']\)/);
    expect(authSrc).not.toMatch(/rest\/v1\/whoop_tokens/);
  });

  test("data loading reads only whoop_data (authenticated select), never tokens", () => {
    expect(dataSrc).toMatch(/from\(["']whoop_data["']\)/);
    expect(dataSrc).not.toMatch(/from\(["']whoop_tokens["']\)/);
    expect(dataSrc).not.toMatch(/rest\/v1\/whoop_tokens/);
  });

  test("client never references a client secret", () => {
    expect(authSrc).not.toMatch(/client_secret/i);
    expect(authSrc).not.toMatch(/VITE_WHOOP_CLIENT_SECRET/);
  });
});

// ─── Settings UI ─────────────────────────────────────────────────────────────
describe("V2.9 SettingsScreen Whoop UI", () => {
  test("renders Whoop connect/sync/disconnect and preserves Oura", () => {
    expect(settingsSrc).toContain("Connect Whoop");
    expect(settingsSrc).toContain("Sync now");
    expect(settingsSrc).toMatch(/Disconnect/);
    expect(settingsSrc).toContain("Connect Oura Ring"); // Oura preserved
    expect(settingsSrc).toMatch(/getWhoopAuthUrl|syncWhoopNow|disconnectWhoop/);
  });

  test("copy says the app still computes the recovery score, without promising a sprint", () => {
    expect(settingsSrc.toLowerCase()).toMatch(/the recovery score is still computed by the app/);
    expect(settingsSrc.toLowerCase()).toMatch(/opt-in/);
    expect(settingsSrc.toLowerCase()).not.toMatch(/next sprint/);
  });
});

// ─── Pure normalization (synthetic payloads) ─────────────────────────────────
describe("V2.9 normalization — synthetic Whoop v2 payloads", () => {
  const recovery = {
    cycle_id: 93845,
    created_at: "2026-07-01T12:00:00.000Z",
    score_state: "SCORED",
    score: { user_calibrating: false, recovery_score: 67, resting_heart_rate: 55, hrv_rmssd_milli: 42.3, spo2_percentage: 96.1, skin_temp_celsius: 33.4 },
  };
  const sleep = {
    id: "sleep-1",
    start: "2026-06-30T23:00:00.000Z",
    end: "2026-07-01T07:00:00.000Z",
    score_state: "SCORED",
    score: {
      stage_summary: {
        total_in_bed_time_milli: 28800000,
        total_awake_time_milli: 1800000,
        total_light_sleep_time_milli: 14400000,
        total_slow_wave_sleep_time_milli: 7200000,
        total_rem_sleep_time_milli: 5400000,
      },
      sleep_efficiency_percentage: 93.7,
      sleep_performance_percentage: 88,
      respiratory_rate: 15.4,
    },
  };
  const cycle = { id: 1, start: "2026-07-01T04:00:00.000Z", score: { strain: 12.4, average_heart_rate: 70, max_heart_rate: 165, kilojoule: 9000 } };
  const workout = { id: "w1", start: "2026-07-01T17:00:00.000Z", sport_id: 45, score: { strain: 9.1, average_heart_rate: 130, max_heart_rate: 172, distance_meter: 5000, kilojoule: 2500 } };

  test("normalizeRecovery extracts scored fields + date", () => {
    const n = normalizeRecovery(recovery);
    expect(n.date).toBe("2026-07-01");
    expect(n.recoveryScore).toBe(67);
    expect(n.hrvRmssd).toBeCloseTo(42.3);
    expect(n.rhr).toBe(55);
  });

  test("normalizeSleep converts milli → minutes and derives asleep", () => {
    const n = normalizeSleep(sleep);
    expect(n.date).toBe("2026-06-30");
    expect(n.inBedMin).toBe(480);
    expect(n.awakeMin).toBe(30);
    expect(n.asleepMin).toBe(450);
    expect(n.efficiencyPct).toBeCloseTo(93.7);
  });

  test("normalizeCycle + normalizeWorkout extract strain + HR", () => {
    expect(normalizeCycle(cycle).strain).toBeCloseTo(12.4);
    const w = normalizeWorkout(workout);
    expect(w.strain).toBeCloseTo(9.1);
    expect(w.avgHr).toBe(130);
    expect(w.id).toBe("w1");
  });

  test("tolerates missing / partial payloads without throwing", () => {
    expect(normalizeRecovery(null)).toBeNull();
    expect(normalizeSleep({})).toEqual(expect.objectContaining({ inBedMin: null, asleepMin: null }));
    expect(normalizeWorkout({ score: {} })).toEqual(expect.objectContaining({ strain: null }));
  });

  test("buildWhoopSummary picks the latest day and groups workouts", () => {
    const grouped = {
      "2026-06-30": { sleep },
      "2026-07-01": { recovery, cycle, workout: [workout] },
    };
    expect(latestWhoopDate(grouped)).toBe("2026-07-01");
    const summary = buildWhoopSummary(grouped);
    expect(summary.date).toBe("2026-07-01");
    expect(summary.recovery.recoveryScore).toBe(67);
    expect(summary.workouts).toHaveLength(1);
    expect(summary.workouts[0].strain).toBeCloseTo(9.1);
  });
});
