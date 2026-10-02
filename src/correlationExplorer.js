// src/correlationExplorer.js
// V7 · N=1 correlation explorer — pairs two logged metrics across days and
// computes a Pearson r, optionally with a 1-day lag (X today vs Y tomorrow,
// e.g. sleep → next-day energy). Pure display math over the entries the app
// already persists. Deliberately conservative in presentation: r is reported
// with n, and the UI labels everything association-not-causation.

export const CORRELATION_METRICS = [
  { key: "sleep",    label: "Sleep (hrs)",     get: d => num(d?.body?.sleep) },
  { key: "energy",   label: "Energy (1-10)",   get: d => num(d?.body?.energy) },
  { key: "soreness", label: "Soreness (1-10)", get: d => num(d?.body?.soreness) },
  { key: "protein",  label: "Protein (g)",     get: d => num(d?.nutrition?.protein) },
  { key: "calories", label: "Calories",        get: d => num(d?.nutrition?.calories) },
  { key: "water",    label: "Water (oz)",      get: d => num(d?.nutrition?.water) },
  { key: "miles",    label: "Run miles",       get: d => num(d?.workout?.cardio?.miles) },
  { key: "volume",   label: "Lift volume",     get: d => liftVolume(d) },
];

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function liftVolume(d) {
  const exercises = d?.workout?.exercises;
  if (!exercises) return null;
  let total = 0;
  let any = false;
  for (const ex of Object.values(exercises)) {
    for (const s of ex?.sets || []) {
      if (!s.done) continue;
      const w = parseFloat(s.weight) || 0;
      const r = parseInt(s.reps, 10) || 0;
      if (w > 0 && r > 0) { total += w * r; any = true; }
    }
  }
  return any ? total : null;
}

function nextDayKey(dateKey) {
  const d = new Date(dateKey + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Build [x, y] pairs. lag=0 pairs same-day values; lag=1 pairs X on day d with
// Y on day d+1. Days missing either metric are skipped.
export function buildCorrelationPairs(data, xKey, yKey, { lag = 0, windowDays = 90 } = {}) {
  if (!data) return [];
  const xm = CORRELATION_METRICS.find(m => m.key === xKey);
  const ym = CORRELATION_METRICS.find(m => m.key === yKey);
  if (!xm || !ym) return [];
  const keys = Object.keys(data).sort().slice(-windowDays);
  const pairs = [];
  for (const k of keys) {
    const x = xm.get(data[k]);
    const yDayKey = lag === 1 ? nextDayKey(k) : k;
    const y = ym.get(data[yDayKey]);
    if (x !== null && y !== null) pairs.push({ date: k, x, y });
  }
  return pairs;
}

// Pearson correlation coefficient. Returns null for degenerate inputs
// (n < 3 or zero variance on either axis) rather than pretending.
export function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const xs = pairs.map(p => p.x);
  const ys = pairs.map(p => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return Math.round((cov / Math.sqrt(vx * vy)) * 100) / 100;
}

// Plain-language strength read for the annotation line. Thresholds follow the
// common Cohen-ish convention, prefixed with the direction.
export function describeCorrelation(r, n) {
  if (r === null || n < 3) return "not enough overlapping days yet";
  const abs = Math.abs(r);
  const dir = r > 0 ? "positive" : "negative";
  const strength = abs < 0.1 ? "no meaningful" : abs < 0.3 ? "weak" : abs < 0.5 ? "moderate" : "strong";
  if (strength === "no meaningful") return `no meaningful association across ${n} days`;
  return `${strength} ${dir} association across ${n} days`;
}
