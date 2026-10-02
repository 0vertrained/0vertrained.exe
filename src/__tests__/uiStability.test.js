import { describe, it, expect } from "vitest";
import {
  TAB_SKELETON_PLANS,
  getSkeletonPlan,
  resolveLoadState,
  buildTomorrowOutlook,
} from "../uiStability";

describe("getSkeletonPlan", () => {
  it("returns the tab-specific plan when defined", () => {
    expect(getSkeletonPlan("Today")).toBe(TAB_SKELETON_PLANS.Today);
    expect(getSkeletonPlan("Fuel")).toBe(TAB_SKELETON_PLANS.Fuel);
    expect(getSkeletonPlan("Progress")).toBe(TAB_SKELETON_PLANS.Progress);
    expect(getSkeletonPlan("Recovery")).toBe(TAB_SKELETON_PLANS.Recovery);
  });

  it("every plan is a non-empty array of rows with key+title", () => {
    for (const plan of Object.values(TAB_SKELETON_PLANS)) {
      expect(Array.isArray(plan)).toBe(true);
      expect(plan.length).toBeGreaterThan(0);
      for (const row of plan) {
        expect(typeof row.key).toBe("string");
        expect(row.key.length).toBeGreaterThan(0);
        expect(typeof row.title).toBe("string");
        expect(row.title.length).toBeGreaterThan(0);
      }
    }
  });

  it("row keys are unique within a plan", () => {
    for (const plan of Object.values(TAB_SKELETON_PLANS)) {
      const keys = plan.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("falls back to a generic non-empty plan for unknown tabs", () => {
    const plan = getSkeletonPlan("Nope");
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });

  it("handles missing/undefined tab argument", () => {
    expect(getSkeletonPlan(undefined).length).toBeGreaterThan(0);
    expect(getSkeletonPlan(null).length).toBeGreaterThan(0);
  });
});

describe("resolveLoadState", () => {
  it("shows skeleton when not loaded", () => {
    expect(resolveLoadState({ loaded: false, refreshing: false })).toEqual({
      showSkeleton: true,
      showRefreshing: false,
      ready: false,
    });
  });

  it("does not show refreshing while skeleton is up (not loaded)", () => {
    // Even if refreshing is somehow true before first paint, the skeleton wins.
    expect(resolveLoadState({ loaded: false, refreshing: true })).toEqual({
      showSkeleton: true,
      showRefreshing: false,
      ready: false,
    });
  });

  it("shows content only when loaded and not refreshing", () => {
    expect(resolveLoadState({ loaded: true, refreshing: false })).toEqual({
      showSkeleton: false,
      showRefreshing: false,
      ready: true,
    });
  });

  it("shows quiet refreshing indicator over cached content", () => {
    expect(resolveLoadState({ loaded: true, refreshing: true })).toEqual({
      showSkeleton: false,
      showRefreshing: true,
      ready: true,
    });
  });

  it("defaults to skeleton when called with no args", () => {
    expect(resolveLoadState()).toEqual({
      showSkeleton: true,
      showRefreshing: false,
      ready: false,
    });
  });
});

describe("buildTomorrowOutlook", () => {
  it("returns null for missing/invalid decision", () => {
    expect(buildTomorrowOutlook(null)).toBeNull();
    expect(buildTomorrowOutlook(undefined)).toBeNull();
    expect(buildTomorrowOutlook("push")).toBeNull();
  });

  it("gives a call-appropriate outlook for each known call", () => {
    for (const call of ["recover", "rest", "modify", "maintain", "push"]) {
      const out = buildTomorrowOutlook({ call, confidence: "high" });
      expect(out).not.toBeNull();
      expect(out.eyebrow).toBe("If today holds");
      expect(typeof out.text).toBe("string");
      expect(out.text.length).toBeGreaterThan(0);
    }
  });

  it("returns null for an unknown call with adequate confidence", () => {
    expect(buildTomorrowOutlook({ call: "mystery", confidence: "high" })).toBeNull();
  });

  it("prioritizes a log-nudge when confidence is low", () => {
    const out = buildTomorrowOutlook({ call: "push", confidence: "low" });
    expect(out).not.toBeNull();
    expect(out.text.toLowerCase()).toContain("check-in");
  });

  it("prioritizes a log-nudge when data is limited, regardless of call", () => {
    const out = buildTomorrowOutlook({
      call: "maintain",
      confidence: "medium",
      sourceBadges: ["Load", "Limited data"],
    });
    expect(out.text.toLowerCase()).toContain("check-in");
  });

  it("does not require sourceBadges to be present", () => {
    const out = buildTomorrowOutlook({ call: "recover", confidence: "medium" });
    expect(out.text).toBe(
      "Take the recovery day and tomorrow's call should ease back toward normal.",
    );
  });
});
