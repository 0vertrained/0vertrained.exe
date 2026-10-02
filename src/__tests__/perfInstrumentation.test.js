// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { singleFlight, memoizeAsync } from "../asyncMemo";
import { perfStart, perfMark, readPerfRuns, clearPerfRuns } from "../perf";

describe("singleFlight", () => {
  it("collapses concurrent callers into one invocation", async () => {
    let calls = 0;
    let release;
    const gate = new Promise((res) => { release = res; });
    const fn = singleFlight(async () => { calls += 1; await gate; return "value"; });

    const [a, b, c] = [fn(), fn(), fn()];
    release();
    expect(await Promise.all([a, b, c])).toEqual(["value", "value", "value"]);
    expect(calls).toBe(1);
  });

  it("refetches after settle — no result caching", async () => {
    let calls = 0;
    const fn = singleFlight(async () => { calls += 1; return calls; });
    expect(await fn()).toBe(1);
    expect(await fn()).toBe(2);
  });

  it("clears in-flight state after rejection so retries work", async () => {
    let calls = 0;
    const fn = singleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return "recovered";
    });
    await expect(fn()).rejects.toThrow("boom");
    expect(await fn()).toBe("recovered");
  });
});

describe("memoizeAsync", () => {
  it("caches within the TTL and refetches after it", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = memoizeAsync(async () => { calls += 1; return calls; }, 1000);
    expect(await fn()).toBe(1);
    expect(await fn()).toBe(1);
    vi.advanceTimersByTime(1500);
    expect(await fn()).toBe(2);
    vi.useRealTimers();
  });

  it("never memoizes a rejection", async () => {
    let calls = 0;
    const fn = memoizeAsync(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return "ok";
    }, 60000);
    await expect(fn()).rejects.toThrow("transient");
    expect(await fn()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("invalidate() forces the next call to refetch", async () => {
    let calls = 0;
    const fn = memoizeAsync(async () => { calls += 1; return calls; }, 60000);
    expect(await fn()).toBe(1);
    fn.invalidate();
    expect(await fn()).toBe(2);
  });
});

describe("perf instrumentation", () => {
  beforeEach(() => {
    localStorage.clear();
    clearPerfRuns();
  });

  it("records marks with elapsed times and persists them", () => {
    perfStart("boot");
    perfMark("boot", "cache-paint");
    perfMark("boot", "revalidate-done");
    const runs = readPerfRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe("boot");
    expect(runs[0].marks.map((m) => m.label)).toEqual(["cache-paint", "revalidate-done"]);
    for (const m of runs[0].marks) {
      expect(m.t).toBeGreaterThanOrEqual(0);
      expect(m.reqs).toBeGreaterThanOrEqual(0);
    }
  });

  it("marking without a started run is a silent no-op", () => {
    perfMark("recovery", "verdict-ready");
    expect(readPerfRuns()).toHaveLength(0);
  });

  it("re-marking a label updates in place instead of duplicating", () => {
    perfStart("today");
    perfMark("today", "wearables-ready");
    perfMark("today", "wearables-ready");
    const runs = readPerfRuns();
    expect(runs[0].marks.filter((m) => m.label === "wearables-ready")).toHaveLength(1);
  });

  it("keeps only the newest MAX runs", () => {
    for (let i = 0; i < 20; i++) {
      perfStart("boot");
      perfMark("boot", "cache-paint");
    }
    expect(readPerfRuns().length).toBeLessThanOrEqual(12);
  });

  it("degrades corrupt storage to an empty list", () => {
    localStorage.setItem("ovt-perf-runs-v1", "{nope");
    expect(readPerfRuns()).toEqual([]);
  });
});
