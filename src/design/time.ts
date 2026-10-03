// Seconds to "mm:ss" for the runners and the rest bar. Minutes never wrap at
// an hour (3600 → "60:00"): a long cardio session reads as one clock. Negative
// or non-finite input reads as zero, so a drifting countdown never shows "-1".
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? "0" : ""}${m}:${r < 10 ? "0" : ""}${r}`;
}
