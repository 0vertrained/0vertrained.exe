// V2.7 Multi-User Readiness + Beta Hardening — security static assertions.
//
// These tests are deterministic and NOT network-dependent. They read the
// migration SQL and the coach function source and assert the security-sensitive
// invariants of the sprint, plus a couple of live behavioural checks on
// coach.js that exercise the access gate with mocked fetch.

import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const migrationPath = resolve(repoRoot, "supabase", "migration_v27_beta_hardening.sql");
const coachPath = resolve(repoRoot, "netlify", "functions", "coach.js");
const coachRouterPath = resolve(repoRoot, "netlify", "functions", "_coach-model-router.js");

const migrationSql = readFileSync(migrationPath, "utf8");
const migrationLower = migrationSql.toLowerCase();
const coachSrc = readFileSync(coachPath, "utf8");
const coachRouterSrc = readFileSync(coachRouterPath, "utf8");
const appSrc = readFileSync(resolve(repoRoot, "src", "App.jsx"), "utf8");

describe("Beta UI journey hardening", () => {
  test("tab navigation closes the quick-log sheet so beta journeys are not obstructed", () => {
    expect(appSrc).toMatch(/const navigateTo = \(t\) => \{[\s\S]*?setSheetOpen\(false\);[\s\S]*?setTab\(t\);[\s\S]*?\};/);
  });
});

describe("V2.7 migration — coach_access + RLS", () => {
  test("creates coach_access table referencing auth.users with cascade", () => {
    expect(migrationLower).toMatch(/create table if not exists public\.coach_access/);
    expect(migrationLower).toMatch(
      /user_id\s+uuid\s+primary key\s+references auth\.users\(id\)\s+on delete cascade/
    );
  });

  test("enables RLS on coach_access", () => {
    expect(migrationLower).toMatch(
      /alter table public\.coach_access enable row level security/
    );
  });

  test("gives users a SELECT-own policy but no self write policy", () => {
    // Users can read their own row...
    expect(migrationLower).toMatch(/coach_access_select_own/);
    expect(migrationLower).toMatch(
      /create policy "coach_access_select_own"[\s\S]*?using \(auth\.uid\(\) = user_id\)/
    );
    // ...but there is no insert/update/delete policy that would let an
    // authenticated user grant themselves coach access.
    expect(migrationLower).not.toMatch(/coach_access.*for insert/);
    expect(migrationLower).not.toMatch(/coach_access_insert/);
    expect(migrationLower).not.toMatch(/coach_access_update/);
  });

  test("revokes write access from authenticated/anon and grants only service_role", () => {
    expect(migrationLower).toMatch(
      /revoke all on public\.coach_access from anon, authenticated/
    );
    // authenticated may SELECT only; full control is service_role.
    expect(migrationLower).toMatch(/grant select on public\.coach_access to authenticated/);
    expect(migrationLower).toMatch(/grant all on public\.coach_access to service_role/);
    // No blanket "grant all ... to authenticated" for coach_access.
    expect(migrationLower).not.toMatch(/grant all on public\.coach_access to authenticated/);
  });

  test("coach_access has sane bounded checks on limits/usage", () => {
    expect(migrationLower).toMatch(/monthly_limit\s+int not null default 50 check \(monthly_limit >= 0/);
    expect(migrationLower).toMatch(/used_this_month\s+int not null default 0 check \(used_this_month >= 0\)/);
  });
});

describe("V2.7 migration — max_users + indexes", () => {
  test("adds bounded max_users (>= 1 and finite)", () => {
    expect(migrationLower).toMatch(/add column if not exists max_users int not null default 5/);
    expect(migrationLower).toMatch(/check \(max_users >= 1 and max_users <= 10000\)/);
  });

  test("preserves signup_locked compatibility", () => {
    expect(migrationLower).toMatch(/add column if not exists signup_locked boolean/);
  });

  test("creates the expected hot-path indexes idempotently", () => {
    expect(migrationLower).toMatch(/create index if not exists [\s\S]*?on public\.entries \(user_id, entry_date\)/);
    expect(migrationLower).toMatch(/create index if not exists [\s\S]*?on public\.program \(user_id\)/);
    expect(migrationLower).toMatch(/create index if not exists [\s\S]*?on public\.profiles \(id\)/);
    expect(migrationLower).toMatch(/create index if not exists [\s\S]*?on public\.oura_data \(user_id, date, data_type\)/);
    expect(migrationLower).toMatch(/create index if not exists [\s\S]*?on public\.oura_tokens \(user_id\)/);
  });
});

describe("V2.7 migration — delete_my_account_data RPC", () => {
  test("is a SECURITY DEFINER function pinning search_path", () => {
    expect(migrationLower).toMatch(/create or replace function public\.delete_my_account_data\(\)/);
    expect(migrationLower).toMatch(/security definer/);
    expect(migrationLower).toMatch(/set search_path = public/);
  });

  test("derives the target from auth.uid() and takes NO user_id argument", () => {
    // The function signature has empty parens — no arbitrary user_id accepted.
    expect(migrationSql).toMatch(/function public\.delete_my_account_data\(\)/);
    // It must derive uid from auth.uid().
    expect(migrationLower).toMatch(/uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    // And it must NOT filter deletes by any argument-provided id.
    expect(migrationLower).toMatch(/delete from public\.entries\s+where user_id = uid/);
    expect(migrationLower).toMatch(/delete from public\.program\s+where user_id = uid/);
    expect(migrationLower).toMatch(/delete from public\.oura_data\s+where user_id = uid/);
    expect(migrationLower).toMatch(/delete from public\.oura_tokens\s+where user_id = uid/);
  });

  test("refuses to run when unauthenticated", () => {
    expect(migrationLower).toMatch(/if uid is null then[\s\S]*?raise exception 'not authenticated'/);
  });

  test("is executable only by authenticated, not anon/public", () => {
    expect(migrationLower).toMatch(
      /revoke all on function public\.delete_my_account_data\(\) from public, anon/
    );
    expect(migrationLower).toMatch(
      /grant execute on function public\.delete_my_account_data\(\) to authenticated/
    );
  });
  test("clears profile settings and recovery credentials but keeps username reserved", () => {
    expect(migrationLower).toMatch(/set settings = '\{\}'::jsonb/);
    expect(migrationLower).toMatch(/recovery_hash = null/);
    expect(migrationLower).toMatch(/recovery_salt = null/);
    expect(migrationLower).toMatch(/where id = uid/);
  });
});

describe("V2.7 coach.js — hardened access gate", () => {
  test("still verifies the Supabase bearer token", () => {
    expect(coachSrc).toMatch(/\/auth\/v1\/user/);
    expect(coachSrc).toMatch(/Missing authorization token/);
    expect(coachSrc).toMatch(/authHeader\.startsWith\("Bearer "\)/);
  });

  test("supports both coach_access lookup and COACH_ALLOWED_USER_ID fallback", () => {
    expect(coachSrc).toMatch(/COACH_ALLOWED_USER_ID/);
    expect(coachSrc).toMatch(/isLegacyAllowed/);
    expect(coachSrc).toMatch(/lookupCoachAccess/);
    expect(coachSrc).toMatch(/coach_access/);
    expect(coachSrc).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  test("does NOT use body.user_id for authorization", () => {
    // The entitlement subject must be the JWT userId only.
    expect(coachSrc).not.toMatch(/body\.user_id/);
    expect(coachSrc).not.toMatch(/body\?\.user_id/);
    expect(coachSrc).not.toMatch(/raw\.user_id/);
  });

  test("keeps request-size cap and never logs raw payloads/secrets", () => {
    expect(coachSrc).toMatch(/requestTooLarge/);
    expect(coachSrc).toMatch(/Request body too large/);
    // No console logging of bodies/keys in the function.
    expect(coachSrc).not.toMatch(/console\.log\(/);
    expect(coachSrc).not.toMatch(/console\.error\([^)]*OLLAMA/);
  });

  test("Ollama call authorizes with OLLAMA_API_KEY, coach_access uses the service role", () => {
    // The server passes OLLAMA_API_KEY into the routed caller, which uses it
    // as the upstream bearer token.
    expect(coachSrc).toMatch(/apiKey:\s*OLLAMA_API_KEY/);
    expect(coachRouterSrc).toMatch(/authorization["`:\s]+.*Bearer \${apiKey}/);
    // The service role remains confined to Supabase helpers, never the model router.
    expect(coachSrc).toMatch(/rest\/v1\/coach_access[\s\S]*?serviceRoleKey/);
    expect(coachSrc).toMatch(/ollamaUrl:\s*OLLAMA_URL/);
    expect(coachRouterSrc).not.toMatch(/serviceRoleKey|SERVICE_ROLE_KEY/);
  });
});

describe("V2.7 coach.js — live access gate behaviour (mocked fetch)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.OLLAMA_API_KEY = "ollama-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  function makeReq(body) {
    return new Request("https://example.test/api/coach", {
      method: "POST",
      headers: { authorization: "Bearer user-jwt", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("legacy COACH_ALLOWED_USER_ID user is allowed without a table lookup", async () => {
    process.env.COACH_ALLOWED_USER_ID = "legacy-user";
    let coachAccessQueried = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "legacy-user" }), { status: 200 });
      }
      if (href.includes("/rest/v1/coach_access")) {
        coachAccessQueried = true;
        return new Response("[]", { status: 200 });
      }
      if (href.includes("ollama.com")) {
        return new Response(JSON.stringify({ message: { content: "hi" } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const { default: coach } = await import("../../netlify/functions/coach.js");
    const res = await coach(makeReq({ question: "how am I doing?" }));
    expect(res.status).toBe(200);
    expect(coachAccessQueried).toBe(false);
  });

  test("non-legacy user with enabled coach_access row is allowed", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "beta-user" }), { status: 200 });
      }
      if (href.includes("/rest/v1/coach_access")) {
        return new Response(
          JSON.stringify([{ enabled: true, monthly_limit: 50, used_this_month: 3, tier: "beta" }]),
          { status: 200 }
        );
      }
      if (href.includes("ollama.com")) {
        return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const { default: coach } = await import("../../netlify/functions/coach.js");
    const res = await coach(makeReq({ question: "plan?" }));
    expect(res.status).toBe(200);
  });

  test("non-legacy user without an enabled row gets a generic 403", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "stranger" }), { status: 200 });
      }
      if (href.includes("/rest/v1/coach_access")) {
        return new Response("[]", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const { default: coach } = await import("../../netlify/functions/coach.js");
    const res = await coach(makeReq({ question: "let me in" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    // Generic message — does not reveal whether other users exist.
    expect(body.error).toBe("Coach is not enabled for this account.");
  });

  test("enabled user over their monthly limit is throttled (429)", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "heavy-user" }), { status: 200 });
      }
      if (href.includes("/rest/v1/coach_access")) {
        return new Response(
          JSON.stringify([{ enabled: true, monthly_limit: 50, used_this_month: 50, tier: "beta" }]),
          { status: 200 }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const { default: coach } = await import("../../netlify/functions/coach.js");
    const res = await coach(makeReq({ question: "one more" }));
    expect(res.status).toBe(429);
  });

  test("a body.user_id spoof cannot grant access", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const queriedIds = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "real-caller" }), { status: 200 });
      }
      if (href.includes("/rest/v1/coach_access")) {
        const m = href.match(/user_id=eq\.([^&]+)/);
        if (m) queriedIds.push(decodeURIComponent(m[1]));
        return new Response("[]", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const { default: coach } = await import("../../netlify/functions/coach.js");
    // Caller tries to impersonate an allowed user via the body.
    const res = await coach(makeReq({ question: "hi", user_id: "legacy-user" }));
    expect(res.status).toBe(403);
    // The table was queried with the JWT id, never the body-supplied one.
    expect(queriedIds).toContain("real-caller");
    expect(queriedIds).not.toContain("legacy-user");
  });

  test("500 when neither legacy env nor service role is configured", async () => {
    // No COACH_ALLOWED_USER_ID, no SERVICE_ROLE_KEY.
    const { default: coach } = await import("../../netlify/functions/coach.js");
    const res = await coach(makeReq({ question: "hi" }));
    expect(res.status).toBe(500);
  });
});
