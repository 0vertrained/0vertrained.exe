// @vitest-environment node
// v20 · The shared env reader behind /api/next/*: the project URL is taken as
// an origin however it was pasted, and a half-set configuration reads as none.
import { describe, expect, it } from "vitest";
import { normalizeSupabaseUrl, readNextEnv } from "../functions/_next-env.js";

const ORIGIN = "https://next-project.supabase.co";

describe("normalizeSupabaseUrl", () => {
  it("keeps a plain origin and trims whitespace and slashes", () => {
    expect(normalizeSupabaseUrl(ORIGIN)).toBe(ORIGIN);
    expect(normalizeSupabaseUrl(`  ${ORIGIN}/  `)).toBe(ORIGIN);
    expect(normalizeSupabaseUrl("http://127.0.0.1:54321/")).toBe("http://127.0.0.1:54321");
  });
  it("drops a per-service path pasted from the dashboard", () => {
    expect(normalizeSupabaseUrl(`${ORIGIN}/rest/v1/`)).toBe(ORIGIN);
    expect(normalizeSupabaseUrl(`${ORIGIN}/rest/v1`)).toBe(ORIGIN);
    expect(normalizeSupabaseUrl(`${ORIGIN}/auth/v1`)).toBe(ORIGIN);
    expect(normalizeSupabaseUrl(`${ORIGIN}/REST/V1/`)).toBe(ORIGIN);
  });
  it("is empty for nothing", () => {
    expect(normalizeSupabaseUrl(undefined)).toBe("");
    expect(normalizeSupabaseUrl("   ")).toBe("");
  });
});

describe("readNextEnv", () => {
  const full = { NEXT_SUPABASE_URL: `${ORIGIN}/rest/v1/`, NEXT_SUPABASE_ANON_KEY: " anon ", NEXT_SUPABASE_SERVICE_ROLE_KEY: "service" };
  it("returns the normalised trio", () => {
    expect(readNextEnv(full)).toEqual({ url: ORIGIN, anonKey: "anon", serviceRoleKey: "service" });
  });
  it("is null when any value is missing or blank", () => {
    for (const key of Object.keys(full)) {
      expect(readNextEnv({ ...full, [key]: "" })).toBeNull();
      const without = { ...full };
      delete without[key];
      expect(readNextEnv(without)).toBeNull();
    }
  });
});
