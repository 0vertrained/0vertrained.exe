// @vitest-environment jsdom
// Windowed entries contract. Pins:
//   1. loadRecentEntries applies the cutoff filter (gte) — the blocking boot
//      transfer is capped, never full-history.
//   2. loadOlderEntries pages descending until a short page, invoking onBatch
//      per chunk — history streams in without ever blocking.
//   3. Merge precedence: an onBatch chunk merged UNDER current state can never
//      overwrite a fresher key (offline queue / recent window wins).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { rows: [], calls: [] };

vi.mock("../supabaseClient", () => {
  function makeQuery() {
    const q = { _filters: {}, _range: [0, 999] };
    q.select = () => q;
    q.gte = (col, v) => { q._filters.gte = v; return q; };
    q.lt = (col, v) => { q._filters.lt = v; return q; };
    q.order = (col, { ascending }) => { q._filters.asc = ascending; return q; };
    q.range = (a, b) => {
      q._range = [a, b];
      state.calls.push({ ...q._filters, from: a, to: b });
      let rows = state.rows;
      if (q._filters.gte) rows = rows.filter((r) => r.entry_date >= q._filters.gte);
      if (q._filters.lt) rows = rows.filter((r) => r.entry_date < q._filters.lt);
      rows = [...rows].sort((x, y) =>
        q._filters.asc ? x.entry_date.localeCompare(y.entry_date) : y.entry_date.localeCompare(x.entry_date)
      );
      return Promise.resolve({ data: rows.slice(a, b + 1), error: null });
    };
    return q;
  }
  return { supabase: { from: () => makeQuery(), auth: { getSession: async () => ({ data: { session: null } }) } } };
});

import { loadRecentEntries, loadOlderEntries, entriesWindowCutoff } from "../data";

function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("windowed entries", () => {
  beforeEach(() => { state.rows = []; state.calls = []; });

  it("loadRecentEntries fetches only rows on/after the cutoff", async () => {
    state.rows = [
      { entry_date: day(0), payload: { note: "today" } },
      { entry_date: day(-30), payload: { note: "recent" } },
      { entry_date: day(-200), payload: { note: "ancient" } },
    ];
    const map = await loadRecentEntries(180);
    expect(Object.keys(map)).toHaveLength(2);
    expect(map[day(0)].note).toBe("today");
    expect(map[day(-200)]).toBeUndefined();
    expect(state.calls[0].gte).toBe(entriesWindowCutoff(180));
  });

  it("loadOlderEntries pages descending and streams chunks via onBatch", async () => {
    // 750 old rows → one full 500 page + one 250 page.
    state.rows = Array.from({ length: 750 }, (_, i) => ({
      entry_date: day(-181 - i),
      payload: { i },
    }));
    const batches = [];
    const total = await loadOlderEntries(entriesWindowCutoff(180), (chunk) => {
      batches.push(Object.keys(chunk).length);
    });
    expect(total).toBe(750);
    expect(batches).toEqual([500, 250]);
    expect(state.calls.every((c) => c.lt === entriesWindowCutoff(180) && c.asc === false)).toBe(true);
  });

  it("merging a hydrate chunk under current state never overwrites fresher keys", () => {
    const current = { [day(-1)]: { note: "edited-offline" }, [day(0)]: { note: "fresh" } };
    const chunk = { [day(-1)]: { note: "stale-server" }, [day(-300)]: { note: "history" } };
    const merged = { ...chunk, ...current };
    expect(merged[day(-1)].note).toBe("edited-offline");
    expect(merged[day(-300)].note).toBe("history");
  });

  it("loadOlderEntries stops cleanly when onBatch throws (cancellation path)", async () => {
    state.rows = Array.from({ length: 600 }, (_, i) => ({ entry_date: day(-181 - i), payload: { i } }));
    let calls = 0;
    const total = await loadOlderEntries(entriesWindowCutoff(180), () => {
      calls += 1;
      throw new Error("cancelled");
    });
    expect(calls).toBe(1);
    expect(total).toBe(500); // counted the first page, then stopped
  });
});
