// src/__tests__/foodSearchRetry.test.js
// Finding 5 — the USDA food lookup must retry transient failures (429/5xx) with
// backoff and must never surface a raw HTTP status or a slice of the upstream
// response body to the user. Raw detail is kept in `console` for debugging only.

import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchUsda, USDA_RETRY_DELAYS_MS } from "../FoodSearch";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Minimal fetch Response stand-in.
function mkRes(status, { text = "", json = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => json,
  };
}

const OK_FOODS = {
  foods: [
    {
      description: "Apple",
      foodNutrients: [
        { nutrientId: 1008, value: 52 },
        { nutrientId: 1003, value: 0.3 },
        { nutrientId: 1005, value: 14 },
        { nutrientId: 1004, value: 0.2 },
      ],
    },
  ],
};

describe("fetchUsda transient-failure handling", () => {
  it("retries a 429 with backoff, then returns parsed results", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mkRes(429, { text: "rate limited" }))
      .mockResolvedValueOnce(mkRes(200, { json: OK_FOODS }));
    vi.stubGlobal("fetch", fetchMock);

    const p = fetchUsda("retry-429-then-ok");
    await vi.runAllTimersAsync();
    const out = await p;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out[0].name).toContain("Apple");
  });

  it("retries a 5xx up to the backoff limit, then throws generic copy — no status/body leak", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(mkRes(500, { text: "Internal error: secret-stacktrace-xyz" }));
    vi.stubGlobal("fetch", fetchMock);

    const p = fetchUsda("always-500").catch(e => e);
    await vi.runAllTimersAsync();
    const err = await p;

    // initial attempt + one retry per configured delay
    expect(fetchMock).toHaveBeenCalledTimes(USDA_RETRY_DELAYS_MS.length + 1);
    expect(err.message).toBe("Couldn't reach the food database — showing local results");
    expect(err.message).not.toMatch(/500/);
    expect(err.message).not.toMatch(/secret-stacktrace/);
    // Raw detail is preserved for debugging in the console only.
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/500/);
    expect(logged).toMatch(/secret-stacktrace/);
  });

  it("does not retry a 403 and does not leak the response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mkRes(403, { text: "forbidden-internal-detail" }));
    vi.stubGlobal("fetch", fetchMock);

    const err = await fetchUsda("bad-key-403").catch(e => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.message).toBe("USDA API key invalid or missing");
    expect(err.message).not.toMatch(/forbidden-internal-detail/);
  });

  it("maps an unexpected status to generic copy, keeping the raw status/body in console only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(mkRes(418, { text: "teapot-raw-body" }));
    vi.stubGlobal("fetch", fetchMock);

    const err = await fetchUsda("teapot-418").catch(e => e);
    expect(fetchMock).toHaveBeenCalledTimes(1); // not transient → no retry
    expect(err.message).toBe("Couldn't reach the food database — showing local results");
    expect(err.message).not.toMatch(/418|teapot-raw-body/);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/418/);
    expect(logged).toMatch(/teapot-raw-body/);
  });

  it("returns successful results unchanged (existing happy path preserved)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mkRes(200, { json: OK_FOODS }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchUsda("happy-path-apple");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ calories: 52, source: "usda" });
  });
});
