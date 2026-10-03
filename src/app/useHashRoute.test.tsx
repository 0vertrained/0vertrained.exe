import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { parseHash, useHashRoute } from "./useHashRoute";

describe("parseHash", () => {
  it("reads the path and its parts", () => {
    expect(parseHash("")).toEqual({ path: "/", parts: [] });
    expect(parseHash("#/")).toEqual({ path: "/", parts: [] });
    expect(parseHash("#/quest")).toEqual({ path: "/quest", parts: ["quest"] });
    expect(parseHash("#/stats/log/2026-10-02/")).toEqual({ path: "/stats/log/2026-10-02", parts: ["stats", "log", "2026-10-02"] });
  });
});

describe("useHashRoute", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/");
  });

  it("navigates by writing the hash and follows external hash changes", () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route.path).toBe("/");
    act(() => result.current.navigate("/quest"));
    expect(window.location.hash).toBe("#/quest");
    expect(result.current.route.path).toBe("/quest");
    act(() => {
      window.location.hash = "#/stats";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.route.path).toBe("/stats");
  });

  it("stacks sheets in history state and closes the topmost on popstate", () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => result.current.openSheet("checkin"));
    act(() => result.current.openSheet("confirm"));
    expect(result.current.sheets).toEqual(["checkin", "confirm"]);
    expect(result.current.sheet).toBe("confirm");
    expect(window.location.hash).toBe("#/");
    act(() => {
      window.history.replaceState({ sheets: ["checkin"] }, "", "#/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.sheet).toBe("checkin");
    act(() => result.current.navigate("/profile"));
    expect(result.current.sheets).toEqual([]);
  });
});
