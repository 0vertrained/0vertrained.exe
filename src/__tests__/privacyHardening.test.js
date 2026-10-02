import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readSql(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("privacy hardening migrations", () => {
  test("Oura token table grants are server-only", () => {
    const sql = readSql("supabase/migration_patch_oura_tokens_server_only.sql");
    expect(sql).toContain("REVOKE ALL ON public.oura_tokens FROM anon, authenticated");
    expect(sql).toContain("GRANT ALL ON public.oura_tokens TO service_role");
  });

  test("social leaderboard and PR RPCs filter to explicit opt-in users", () => {
    const sql = readSql("supabase/migration_patch_social_opt_in.sql");
    const optInFilters = sql.match(/socialOptIn/g) || [];
    expect(optInFilters.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("where coalesce((p.settings->>'socialOptIn')::boolean, false) is true");
    expect(sql).toContain("and coalesce((p.settings->>'socialOptIn')::boolean, false) is true");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
  });

  test("get_social_summary migration has required security properties", () => {
    const sql = readSql("supabase/migration_add_social_signals.sql");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("grant execute on function public.get_social_summary");
    expect(sql).toContain("to authenticated");
  });

  test("get_social_summary only exposes opted-in users on shared boards", () => {
    const sql = readSql("supabase/migration_add_social_signals.sql");
    // socialOptIn guard must appear at least once (in opted_in CTE)
    expect(sql).toContain("socialOptIn");
    expect(sql).toContain("lower(p.settings->>'socialOptIn') in ('true', 't', '1')");
  });

  test("get_social_summary does not accept user_id argument", () => {
    const sql = readSql("supabase/migration_add_social_signals.sql");
    // Function signature must only have period_days, not user_id
    const signatureMatch = sql.match(/create or replace function public\.get_social_summary\(([^)]*)\)/i);
    expect(signatureMatch).toBeTruthy();
    expect(signatureMatch[1]).not.toMatch(/user_id/i);
    expect(signatureMatch[1]).toContain("period_days");
  });

  test("get_social_summary does not expose raw payload, biometrics, or tokens in return structure", () => {
    const sql = readSql("supabase/migration_add_social_signals.sql");
    // The jsonb_build_object calls in the SELECT must not reference payload columns directly
    // (only derived numeric aggregates are returned)
    expect(sql).not.toMatch(/['"]payload['"]/);
    expect(sql).not.toMatch(/['"]notes['"]/);
    expect(sql).not.toMatch(/['"]oura['"]/);
    expect(sql).not.toMatch(/['"]whoop['"]/);
    expect(sql).not.toMatch(/['"]tokens['"]/);
    expect(sql).not.toMatch(/['"]coach['"]/);
    // The return object keys must only be safe aggregate fields
    expect(sql).toContain("'leaderboard'");
    expect(sql).toContain("'board_averages'");
    expect(sql).toContain("'highlights'");
    expect(sql).toContain("'current_user'");
  });

  test("get_social_summary uses regex guards before casting numeric JSON fields", () => {
    const sql = readSql("supabase/migration_add_social_signals.sql");
    // Defensive casting pattern: strict decimal guard before numeric cast
    expect(sql).toContain("'^[0-9]+([.][0-9]+)?$'");
  });
});
