import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRecentErrors, getRecentErrors, installErrorReporting, reportError } from "./errorReporting";

describe("errorReporting", () => {
  afterEach(() => {
    clearRecentErrors();
    vi.restoreAllMocks();
  });

  it("keeps the last twenty reports with message, source and context", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 25; i += 1) reportError(new Error(`e${i}`), "manual", `ctx${i}`);
    const recent = getRecentErrors();
    expect(recent).toHaveLength(20);
    expect(recent[0]?.message).toBe("e5");
    expect(recent[19]).toMatchObject({ message: "e24", source: "manual", context: "ctx24" });
    expect(recent[19]?.stack).toContain("e24");
  });

  it("captures window errors and unhandled rejections once installed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    installErrorReporting();
    installErrorReporting();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom"), message: "boom", filename: "x.js", lineno: 3 }));
    const reasons = getRecentErrors().map((r) => r.message);
    expect(reasons).toEqual(["boom"]);
    expect(getRecentErrors()[0]?.context).toBe("x.js:3");
  });
});
