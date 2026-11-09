// src/asyncMemo.js
// Deduplication primitives for the wearable status/data layer.
//
// The perf trace found a cold boot firing FOUR wearable-status function
// invocations (App effect + TodayTab's Oura/Whoop/Strava probes) and fetching
// the 14-day Oura dataset TWICE — identical requests racing each other. Every
// /api/<provider>/status invocation also runs server-side work (bearer verify,
// connection summary, possible token self-heal), so duplicates are 3–5 backend
// round trips each, not just an extra HTTP hop.
//
// Two primitives, deliberately tiny:
//
//  · singleFlight(fn)      — concurrent callers share one in-flight promise.
//    No caching after settle: the next call refetches. Zero staleness
//    semantics change; it only collapses races.
//
//  · memoizeAsync(fn, ttl) — singleFlight PLUS a short result memo. For pure
//    presence probes (isOuraConnected …) whose answer cannot meaningfully
//    change within a minute; a rejected promise is never memoized.
//
// Both are keyed per wrapped function (arguments are ignored by design — the
// wrapped wearable calls take none or defaults; do NOT wrap argument-sensitive
// functions with these without adding a keyer).

export function singleFlight(fn) {
  let inFlight = null;
  return function singleFlighted(...args) {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve(fn.apply(this, args)).finally(() => { inFlight = null; });
    return inFlight;
  };
}

export function memoizeAsync(fn, ttlMs = 60_000) {
  let inFlight = null;
  let cached = null; // { value, expiresAt }
  const wrapped = function memoized(...args) {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
    if (inFlight) return inFlight;
    inFlight = Promise.resolve(fn.apply(this, args))
      .then((value) => {
        cached = { value, expiresAt: Date.now() + ttlMs };
        return value;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  // Escape hatch for flows that just changed the truth (connect/disconnect).
  wrapped.invalidate = () => { cached = null; };
  return wrapped;
}
