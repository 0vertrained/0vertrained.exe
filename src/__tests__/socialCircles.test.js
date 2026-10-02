import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sql = readFileSync(resolve(root, "supabase/migration_add_social_circles.sql"), "utf8");

describe("social circles migration — structure", () => {
  test("creates the circle + membership tables", () => {
    expect(sql).toMatch(/create table if not exists public\.social_circles/i);
    expect(sql).toMatch(/create table if not exists public\.social_circle_members/i);
  });

  test("enables row level security on both tables", () => {
    expect(sql).toContain("alter table public.social_circles enable row level security");
    expect(sql).toContain("alter table public.social_circle_members enable row level security");
  });

  test("exposes create / join / list / summary RPCs", () => {
    for (const fn of ["create_circle", "join_circle", "list_my_circles", "get_circle_summary"]) {
      expect(sql).toContain(`function public.${fn}`);
      expect(sql).toContain(`grant execute on function public.${fn}`);
    }
  });
});

describe("social circles migration — security", () => {
  test("every function is security definer with a pinned search_path", () => {
    const definers = sql.match(/security definer/g) || [];
    // is_circle_member + 4 RPCs = 5 security-definer functions
    expect(definers.length).toBeGreaterThanOrEqual(5);
    const paths = sql.match(/set search_path = public/g) || [];
    expect(paths.length).toBeGreaterThanOrEqual(5);
  });

  test("resolves the caller from auth.uid()", () => {
    expect(sql).toContain("auth.uid()");
  });

  test("no RPC accepts a user_id argument", () => {
    const sigs = sql.match(/create or replace function public\.\w+\(([^)]*)\)/gi) || [];
    expect(sigs.length).toBeGreaterThan(0);
    for (const sig of sigs) {
      expect(sig).not.toMatch(/user_id/i);
    }
  });

  test("circle summary gates on membership and social sharing opt-in", () => {
    expect(sql).toContain("is_circle_member(p_circle)");
    expect(sql).toMatch(/not_a_member/);
    expect(sql).toContain("lower(pr.settings->>'socialOptIn') in ('true', 't', '1')");
  });
});

describe("social circles migration — privacy", () => {
  test("summary never returns raw payload / notes / biometrics / tokens keys", () => {
    // The jsonb_build_object return shapes must not surface raw payload structures.
    expect(sql).not.toMatch(/'payload'/);
    expect(sql).not.toMatch(/'notes'/);
    expect(sql).not.toMatch(/'oura'/);
    expect(sql).not.toMatch(/'whoop'/);
    expect(sql).not.toMatch(/'tokens'/);
    expect(sql).not.toMatch(/'coach'/);
  });

  test("only derived aggregate keys appear in the members summary", () => {
    for (const key of ["'username'", "'total_miles'", "'workouts_done'", "'protein_days'", "'total_volume'"]) {
      expect(sql).toContain(key);
    }
  });

  test("numeric JSON fields are regex-guarded before casting", () => {
    expect(sql).toContain("'^[0-9]+([.][0-9]+)?$'");
  });

  test("has no feed / comment / message table or column surface", () => {
    // Guard against a feed/comment/DM surface being added later. Strip SQL comment
    // lines first so header prose documenting their intentional absence doesn't
    // trip the check — we only inspect executable SQL.
    const body = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();
    for (const term of ["comments", "messages", "circle_posts", "circle_feed", "message_body"]) {
      expect(body).not.toContain(term);
    }
  });
});
