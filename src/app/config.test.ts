import { describe, expect, it } from "vitest";
import { hasBackend, projectRef } from "./config";

describe("config", () => {
  it("is guest-only without the backend vars (the test env clears them)", () => {
    expect(hasBackend()).toBe(false);
  });
  it("reads the project ref from a Supabase URL", () => {
    expect(projectRef("https://abcdefghijkl.supabase.co")).toBe("abcdefghijkl");
    expect(projectRef("http://127.0.0.1:54321")).toBe("local");
  });
});
