// src/perf.js
// Load-path instrumentation. The performance plan's byte/latency
// figures were estimates; this module makes them measurements. It records
// named marks (ms since run start) for the hot paths — boot, today, recovery —
// alongside cumulative network activity, and keeps the last runs in
// localStorage for the Settings → About diagnostics table.
//
// Network accounting honesty: `reqs` counts fetch/XHR resource entries started
// after the run began — reliable everywhere. `kb` sums transferSize, which
// browsers zero out for cross-origin responses lacking Timing-Allow-Origin
// (Supabase REST may read 0; same-origin /api/* function calls report real
// sizes). Round-trip COUNT is therefore the primary metric for the waterfall
// fixes; bytes are best-effort and labeled as such in the UI.
//
// Zero-dependency, fail-silent: instrumentation must never be able to break a
// load path it measures.

const STORE_KEY = "ovt-perf-runs-v1";
const MAX_RUNS = 12;

const hasPerf = () =>
  typeof performance !== "undefined" && typeof performance.now === "function";

const activeRuns = new Map(); // kind → { kind, startedAt, startMark, marks: [{label,t,reqs,kb}] }

function resourceStatsSince(startMark) {
  try {
    const entries = performance.getEntriesByType?.("resource") || [];
    let reqs = 0;
    let bytes = 0;
    for (const e of entries) {
      if (e.startTime < startMark) continue;
      if (e.initiatorType !== "fetch" && e.initiatorType !== "xmlhttprequest") continue;
      reqs += 1;
      bytes += Number(e.transferSize) || 0;
    }
    return { reqs, kb: Math.round(bytes / 102.4) / 10 };
  } catch {
    return { reqs: 0, kb: 0 };
  }
}

function persistRun(run) {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    let runs = [];
    try { runs = JSON.parse(raw) || []; } catch { runs = []; }
    if (!Array.isArray(runs)) runs = [];
    const idx = runs.findIndex((r) => r && r.kind === run.kind && r.startedAt === run.startedAt);
    const record = { kind: run.kind, startedAt: run.startedAt, marks: run.marks };
    if (idx >= 0) runs[idx] = record;
    else runs.unshift(record);
    runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    localStorage.setItem(STORE_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
  } catch {
    // Storage unavailable/full — in-memory marks still work this session.
  }
}

/** Begin (or restart) a run for a path kind: "boot" | "today" | "recovery". */
export function perfStart(kind) {
  if (!hasPerf() || !kind) return;
  activeRuns.set(kind, {
    kind,
    startedAt: Date.now(),
    startMark: performance.now(),
    marks: [],
  });
}

/** Record a named mark on the active run for `kind`. Silent no-op without one. */
export function perfMark(kind, label) {
  if (!hasPerf() || !label) return;
  const run = activeRuns.get(kind);
  if (!run) return;
  const t = Math.round(performance.now() - run.startMark);
  const { reqs, kb } = resourceStatsSince(run.startMark);
  // Re-marking the same label (e.g. an effect double-fire) updates in place —
  // the LAST occurrence is the truthful one for "when was this ready".
  const existing = run.marks.find((m) => m.label === label);
  if (existing) { existing.t = t; existing.reqs = reqs; existing.kb = kb; }
  else run.marks.push({ label, t, reqs, kb });
  persistRun(run);
}

/** Last recorded runs, newest first: [{ kind, startedAt, marks: [{label,t,reqs,kb}] }] */
export function readPerfRuns() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.kind && Array.isArray(r.marks)) : [];
  } catch {
    return [];
  }
}

export function clearPerfRuns() {
  activeRuns.clear();
  try { localStorage.removeItem(STORE_KEY); } catch { /* fine */ }
}
