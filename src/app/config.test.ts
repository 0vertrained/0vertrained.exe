import { describe, expect, it } from "vitest";
import { hasBackend, normalizeSupabaseUrl, projectRef } from "./config";

describe("config", () => {
  it("is guest-only without the backend vars (the test env clears them)", () => {
    expect(hasBackend()).toBe(false);
  });
  it("accepts the project URL as pasted from the dashboard, service path and all", () => {
    expect(normalizeSupabaseUrl("https://abcdefghijkl.supabase.co")).toBe("https://abcdefghijkl.supabase.co");
    expect(normalizeSupabaseUrl(" https://abcdefghijkl.supabase.co/ ")).toBe("https://abcdefghijkl.supabase.co");
    expect(normalizeSupabaseUrl("https://abcdefghijkl.supabase.co/rest/v1/")).toBe("https://abcdefghijkl.supabase.co");
    expect(normalizeSupabaseUrl("https://abcdefghijkl.supabase.co/auth/v1")).toBe("https://abcdefghijkl.supabase.co");
    expect(normalizeSupabaseUrl("http://127.0.0.1:54321/")).toBe("http://127.0.0.1:54321");
    expect(normalizeSupabaseUrl(undefined)).toBe("");
  });
  it("reads the project ref from a Supabase URL", () => {
    expect(projectRef("https://abcdefghijkl.supabase.co")).toBe("abcdefghijkl");
    expect(projectRef("http://127.0.0.1:54321")).toBe("local");
  });
});
