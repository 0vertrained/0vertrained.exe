// Local-only Form Check history.
//
// Privacy model (hosted engine): raw video may be sent to the hosted Form Check
// Engine for temporary analysis, but it is not persisted there and is never
// persisted here. Only a *derived* summary — counts, coarse labels, hedged cues,
// confidence, and a numeric rep timeline — may be saved, and only to local
// storage on this device. There is NO raw video, FormData, Supabase Storage,
// base64/object-URL/frame/landmark persistence here.
//
// buildSummaryEntry is an explicit allow-list constructor: it copies named,
// derived fields only, so raw media on the source object can never leak into the
// stored record even if the caller hands us the full analysis object.
//
// This module deliberately leaves a clean seam: swap the storage backend (or add
// a Supabase sync of these *already-derived* summaries) later without touching
// the analysis pipeline.

export const FORM_CHECK_HISTORY_KEY = "ovt-form-check-history-v1";
export const FORM_CHECK_HISTORY_VERSION = 1;
export const MAX_HISTORY_ENTRIES = 50;

function round1(n) {
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10;
}

// Allow-list of coarse, derived numeric metric fields that may be persisted,
// across all supported movements. Anything not on this list (and any raw media)
// is dropped. Each is rounded to one decimal if present.
const ALLOWED_METRIC_KEYS = [
  // squat
  "minKneeAngleDeg",
  "torsoForwardLeanDeg",
  "hipAngleDeg",
  "kneeOverToe",
  // deadlift
  "minHipAngleDeg",
  "maxHipAngleDeg",
  "hipRangeDeg",
  "torsoLeanAtBottomDeg",
  "kneeAngleDeg",
  // push-up
  "minElbowAngleDeg",
  "bodyLineDevDeg",
  "bodyLineDevAtBottomDeg",
  // bench press + overhead press (shared elbow-range keys)
  "maxElbowAngleDeg",
  "elbowRangeDeg",
  // bench press
  "wristPathDevDeg",
  "shoulderShiftDeg",
  "elbowFlareDeg",
  // overhead press
  "shoulderAngleDeg",
  "forwardLeanDeg",
  // bent-over row
  "torsoLeanDeg",
];

function sanitizeMetrics(metrics = {}) {
  const out = {};
  for (const key of ALLOWED_METRIC_KEYS) {
    out[key] = round1(metrics[key]);
  }
  return out;
}

// Allow-list of per-rep numeric angle fields (movement-specific bottom angles).
const ALLOWED_REP_ANGLE_KEYS = ["minAngleDeg", "minKneeAngleDeg", "minHipAngleDeg", "minElbowAngleDeg"];

function sanitizeRep(r) {
  const rep = {
    index: r.index,
    startMs: r.startMs,
    bottomMs: r.bottomMs,
    endMs: r.endMs,
    // Generic + legacy assessment label so the timeline chip always has one.
    assessment: r.assessment || r.depthAssessment || null,
    depthAssessment: r.depthAssessment || r.assessment || null,
    tempoSec: r.tempoSec,
    flags: Array.isArray(r.flags) ? r.flags.slice() : [],
  };
  for (const key of ALLOWED_REP_ANGLE_KEYS) {
    if (r[key] != null) rep[key] = round1(r[key]);
  }
  return rep;
}

// Resolve the storage backend. Accepts an injected store (tests / future
// backends); otherwise uses localStorage when available. Returns null when no
// usable storage exists so callers degrade silently.
function resolveStore(storage) {
  if (storage) return storage;
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    /* access can throw in locked-down environments */
  }
  return null;
}

// Construct the derived summary record. Pure: pass `date` (ISO string) explicitly
// so this is deterministic and testable. ONLY allow-listed, derived fields are
// copied — never file, object URL, frames, landmarks, images, or base64.
export function buildSummaryEntry(analysis = {}, date) {
  const result = analysis.result || {};
  const seg = analysis.segmentation || null;
  const metrics = analysis.metrics || {};

  const timeline = seg && Array.isArray(seg.reps)
    ? seg.reps.map(sanitizeRep)
    : [];

  // Preserve coaching-tier fields in allow-listed form. These are derived
  // values only — no video, frames, landmarks, images, or base64.
  const formScore = analysis.formScore && typeof analysis.formScore === "object"
    ? {
        score: Number.isFinite(analysis.formScore.score) ? analysis.formScore.score : null,
        label: analysis.formScore.label || null,
        reasons: Array.isArray(analysis.formScore.reasons) ? analysis.formScore.reasons.slice(0, 4) : [],
      }
    : typeof analysis.formScore === "number"
      ? { score: analysis.formScore, label: null, reasons: [] }
      : null;
  const captureQuality = analysis.captureQuality && typeof analysis.captureQuality === "object" ? {
    score: Number.isFinite(analysis.captureQuality.score) ? analysis.captureQuality.score : null,
    label: analysis.captureQuality.label || null,
    checks: Array.isArray(analysis.captureQuality.checks)
      ? analysis.captureQuality.checks.map(c => ({ item: c.item || null, status: c.status || null, note: c.note || null })).slice(0, 6)
      : [],
    lighting: analysis.captureQuality.lighting || null,
    framing: analysis.captureQuality.framing || null,
    motionBlur: analysis.captureQuality.motionBlur || null,
    bodyVisibility: analysis.captureQuality.bodyVisibility || null,
    overallQuality: analysis.captureQuality.overallQuality || null,
  } : null;
  const coaching = analysis.coaching ? {
    overall: analysis.coaching.overall || null,
    topPriority: analysis.coaching.topPriority || null,
    whatLookedGood: Array.isArray(analysis.coaching.whatLookedGood) ? analysis.coaching.whatLookedGood.slice(0, 5) : [],
    watchItems: Array.isArray(analysis.coaching.watchItems) ? analysis.coaching.watchItems.slice(0, 5) : [],
    nextSetCue: analysis.coaching.nextSetCue || null,
    retakeRecommended: Boolean(analysis.coaching.retakeRecommended),
    retakeRecommendation: analysis.coaching.retakeRecommendation || null,
  } : null;
  const metricConfidence = analysis.metricConfidence && typeof analysis.metricConfidence === "object"
    ? analysis.metricConfidence
    : typeof analysis.metricConfidence === "number"
      ? { overall: { confidence: analysis.metricConfidence } }
      : null;
  const evidence = analysis.evidence && typeof analysis.evidence === "object" ? {
    summary: analysis.evidence.summary || null,
    keyMoments: Array.isArray(analysis.evidence.keyMoments)
      ? analysis.evidence.keyMoments.map(m => ({
          label: m.label || null,
          phase: m.phase || null,
          tMs: Number.isFinite(m.tMs) ? m.tMs : Number.isFinite(m.timeMs) ? m.timeMs : Number.isFinite(m.timestampMs) ? m.timestampMs : null,
          confidence: Number.isFinite(m.confidence) ? m.confidence : null,
          reason: m.reason || null,
        })).slice(0, 8)
      : [],
    metricHighlights: Array.isArray(analysis.evidence.metricHighlights)
      ? analysis.evidence.metricHighlights.map(h => ({
          name: h.name || h.metric || null,
          label: h.label || null,
          value: Number.isFinite(h.value) ? h.value : null,
          unit: h.unit || null,
          observation: h.observation || null,
        })).slice(0, 6)
      : [],
    limitations: Array.isArray(analysis.evidence.limitations) ? analysis.evidence.limitations.slice(0, 5) : [],
  } : null;
  const progressSignals = analysis.progressSignals && typeof analysis.progressSignals === "object" ? {
    movement: analysis.progressSignals.movement || null,
    repCount: Number.isFinite(analysis.progressSignals.repCount) ? analysis.progressSignals.repCount : null,
    primaryFocus: analysis.progressSignals.primaryFocus || null,
    trendKey: Number.isFinite(analysis.progressSignals.trendKey) ? analysis.progressSignals.trendKey : null,
    comparableMetrics: Array.isArray(analysis.progressSignals.comparableMetrics)
      ? analysis.progressSignals.comparableMetrics.map(m => ({
          name: m.name || null,
          value: Number.isFinite(m.value) ? m.value : null,
          unit: m.unit || null,
        })).slice(0, 8)
      : [],
    scoreComponents: Array.isArray(analysis.progressSignals.scoreComponents)
      ? analysis.progressSignals.scoreComponents.map(c => ({
          name: c.name || c.component || null,
          score: Number.isFinite(c.score) ? c.score : null,
        })).slice(0, 6)
      : [],
  } : null;

  // Persist only the derived analyzability summary — no raw signals.
  const analyzability = analysis.analyzability && typeof analysis.analyzability === "object" ? {
    level: analysis.analyzability.level || null,
    score: Number.isFinite(analysis.analyzability.score) ? analysis.analyzability.score : null,
    blockingIssues: Array.isArray(analysis.analyzability.blockingIssues) ? analysis.analyzability.blockingIssues.slice(0, 6) : [],
    improvements: Array.isArray(analysis.analyzability.improvements) ? analysis.analyzability.improvements.slice(0, 6) : [],
    shouldShowFullCoaching: analysis.analyzability.shouldShowFullCoaching !== false,
  } : null;
  // Persist derived movement-accuracy proxies (scalar fields per metric).
  const movementMetrics = analysis.movementMetrics && typeof analysis.movementMetrics === "object" && !Array.isArray(analysis.movementMetrics)
    ? Object.fromEntries(
        Object.entries(analysis.movementMetrics)
          .filter(([, m]) => m && typeof m === "object")
          .slice(0, 8)
          .map(([name, m]) => [name, {
            score: Number.isFinite(m.score) ? m.score : null,
            label: typeof m.label === "string" ? m.label : null,
            spread: Number.isFinite(m.spread) ? round1(m.spread) : null,
          }]),
      )
    : null;

  return {
    v: FORM_CHECK_HISTORY_VERSION,
    date,
    movement: analysis.movement || result.movement || null,
    analyzability,
    movementMetrics,
    repCount: seg && Number.isFinite(seg.repCount) ? seg.repCount : null,
    depthAssessment: result.depthAssessment || result.hingeAssessment || result.bodyLineAssessment || null,
    confidence: {
      level: result.confidence?.level || null,
      reasons: Array.isArray(result.confidence?.reasons) ? result.confidence.reasons.slice() : [],
    },
    cues: Array.isArray(result.cues)
      ? result.cues.map((c) => ({ id: c.id, severity: c.severity, text: c.text }))
      : [],
    metrics: sanitizeMetrics(metrics),
    timeline,
    timelineSummary: seg ? seg.timelineSummary || null : null,
    // V1.2/V1.3: Add derived coaching and evidence fields
    formScore,
    captureQuality,
    coaching,
    metricConfidence,
    evidence,
    progressSignals,
  };
}

// Read the saved derived-summary history (newest first). Tolerates missing /
// corrupt / wrong-version payloads by returning an empty list.
export function loadHistory(storage) {
  const store = resolveStore(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(FORM_CHECK_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== FORM_CHECK_HISTORY_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries;
  } catch {
    return [];
  }
}

// Persist one derived summary, newest first, capped at MAX_HISTORY_ENTRIES.
// Returns the updated list. Fails silently (returns the prior list) if storage
// is unavailable or throws (quota, disabled, etc.).
export function saveSummary(entry, storage) {
  const store = resolveStore(storage);
  const prior = loadHistory(storage);
  if (!store || !entry) return prior;
  const entries = [entry, ...prior].slice(0, MAX_HISTORY_ENTRIES);
  try {
    store.setItem(FORM_CHECK_HISTORY_KEY, JSON.stringify({ v: FORM_CHECK_HISTORY_VERSION, entries }));
  } catch {
    return prior;
  }
  return entries;
}

export function clearHistory(storage) {
  const store = resolveStore(storage);
  if (!store) return;
  try {
    store.removeItem(FORM_CHECK_HISTORY_KEY);
  } catch {
    /* best effort */
  }
}

// Progress memory + same-movement comparison.
//
// All helpers below are PURE: they read already-derived history records and
// return derived comparison/summary objects. No storage, no I/O, no Date.now()
// (dates come from the stored records). They tolerate old V1.1/V1.2 entries and
// missing V1.3 fields, and never surface anything beyond the saved derived data.

// Short, human-readable family labels for known movement families. Kept local
// (rather than importing protocols) so this storage module stays dependency-free
// and safe to unit test in isolation.
const MOVEMENT_FAMILY_LABELS = {
  squat: "Squat",
  deadlift: "Deadlift",
  pushup: "Push-up",
  benchpress: "Bench Press",
  overheadpress: "Overhead Press",
  bentoverrow: "Bent-Over Row",
  frontsquat: "Front Squat",
  rdl: "Romanian Deadlift",
  romaniandeadlift: "Romanian Deadlift",
  inclinebench: "Incline Bench Press",
  inclinebenchpress: "Incline Bench Press",
  dbshoulderpress: "Dumbbell Shoulder Press",
  dumbbellshoulderpress: "Dumbbell Shoulder Press",
  pullup: "Pull-up / Chin-up",
  chinup: "Pull-up / Chin-up",
  lunge: "Lunge / Split Squat",
  splitsquat: "Lunge / Split Squat",
  hipthrust: "Hip Thrust / Glute Bridge",
  glutebridge: "Hip Thrust / Glute Bridge",
  gobletsquat: "Goblet Squat",
  dbbench: "Dumbbell Bench Press",
  dumbbellbenchpress: "Dumbbell Bench Press",
  cablerow: "Seated Cable Row",
  machinerow: "Machine Row",
  latpulldown: "Lat Pulldown",
  dip: "Dip",
  powerclean: "Power Clean",
  snatch: "Snatch",
  cleanjerk: "Clean & Jerk / Push Jerk",
  cleanandjerk: "Clean & Jerk / Push Jerk",
  pushjerk: "Clean & Jerk / Push Jerk",
  kettlebellswing: "Kettlebell Swing",
};

// Pull the best raw movement string off an entry (or accept a bare string).
function rawMovement(entryOrMovement) {
  if (entryOrMovement == null) return null;
  if (typeof entryOrMovement === "string") return entryOrMovement;
  if (typeof entryOrMovement === "object") {
    return entryOrMovement.movement
      || entryOrMovement.progressSignals?.movement
      || entryOrMovement.result?.movement
      || null;
  }
  return null;
}

// Collapse a movement string to a stable "family" key so a saved key like
// "squat-side-view" and a bare "squat" (from progressSignals) group together.
// Returns null when there is no usable movement string.
export function movementFamilyKey(entryOrMovement) {
  const raw = rawMovement(entryOrMovement);
  if (typeof raw !== "string" || !raw.trim()) return null;
  let k = raw.toLowerCase().trim();
  // Drop any "<view>-view" qualifier (side/front/rear/back/angle …) and a bare
  // trailing "-view", then everything is collapsed to alphanumerics.
  k = k.replace(/[-_\s]*(side|front|rear|back|angle|threequarter|three-quarter)[-_\s]*view.*$/, "");
  k = k.replace(/[-_\s]*view$/, "");
  k = k.replace(/[^a-z0-9]/g, "");
  if (k === "pushups") k = "pushup";
  if (k === "frontsquat" || k === "frontsquats") k = "frontsquat";
  if (k === "rdl" || k === "rdls" || k === "romaniandeadlift" || k === "romaniandeadlifts") k = "rdl";
  if (k === "inclinebench" || k === "inclinebenchpress") k = "inclinebench";
  if (k === "dumbbellshoulderpress" || k === "dbshoulderpress") k = "dbshoulderpress";
  if (k === "pullups" || k === "chinup" || k === "chinups") k = "pullup";
  if (k === "lunges" || k === "splitsquat" || k === "splitsquats") k = "lunge";
  if (k === "glutebridge" || k === "glutebridges") k = "hipthrust";
  if (k === "gobletsquats") k = "gobletsquat";
  if (k === "dumbbellbench" || k === "dumbbellbenchpress" || k === "dbbenchpress") k = "dbbench";
  if (k === "seatedcablerow" || k === "machinerow" || k === "machinerows") k = "cablerow";
  if (k === "latpulldowns") k = "latpulldown";
  if (k === "dips") k = "dip";
  if (k === "powercleans") k = "powerclean";
  if (k === "cleanandjerk" || k === "cleanjerks" || k === "pushjerk" || k === "pushjerks") k = "cleanjerk";
  if (k === "kettlebellswings") k = "kettlebellswing";
  return k || null;
}

// Human-readable movement label. Prefers a known short family label; otherwise
// echoes a cleaned-up version of the raw key so unknown movements are never
// mislabeled as a different movement. Falls back to "Form Check".
export function normalizeMovementLabel(entryOrMovement) {
  const fam = movementFamilyKey(entryOrMovement);
  if (fam && MOVEMENT_FAMILY_LABELS[fam]) return MOVEMENT_FAMILY_LABELS[fam];
  const raw = rawMovement(entryOrMovement);
  if (typeof raw === "string" && raw.trim()) {
    // Turn "some-custom-movement" / "some_movement" into "Some Custom Movement".
    return raw
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Form Check";
}

// Parse an ISO date string to epoch ms; NaN for missing/unparseable dates.
function toTime(d) {
  if (typeof d !== "string" || !d) return NaN;
  const t = Date.parse(d);
  return Number.isNaN(t) ? NaN : t;
}

// Stable newest-first sort. Entries with no/invalid date sink to the bottom but
// keep their original relative order (history is already stored newest-first).
function sortByDateDesc(entries) {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = toTime(a.e?.date);
      const tb = toTime(b.e?.date);
      const va = Number.isNaN(ta) ? -Infinity : ta;
      const vb = Number.isNaN(tb) ? -Infinity : tb;
      if (vb !== va) return vb - va;
      return a.i - b.i;
    })
    .map((x) => x.e);
}

// Newest-first entries for the same movement family as `movement` (which may be
// an entry or a bare movement string).
export function getEntriesForMovement(history, movement) {
  if (!Array.isArray(history)) return [];
  const target = movementFamilyKey(movement);
  if (!target) return [];
  const same = history.filter((e) => e && movementFamilyKey(e) === target);
  return sortByDateDesc(same);
}

// The previous saved entry for the same movement family as `currentEntry`,
// excluding the current object itself and any entry sharing its exact date.
// Returns the newest entry strictly older than the current one, or null.
export function getPreviousForMovement(history, currentEntry) {
  if (!currentEntry) return null;
  const list = getEntriesForMovement(history, currentEntry);
  if (list.length === 0) return null;
  const curTime = toTime(currentEntry.date);
  for (const e of list) {
    if (e === currentEntry) continue;
    if (currentEntry.date && e && e.date === currentEntry.date) continue;
    const t = toTime(e?.date);
    if (!Number.isNaN(curTime) && !Number.isNaN(t)) {
      if (t < curTime) return e;
      continue; // newer than or equal to current — not a "previous"
    }
    // One or both dates unknown: take the first other entry (list is newest-first).
    return e;
  }
  return null;
}

// ── Field extractors: tolerate V1.1/V1.2/V1.3 shapes and missing fields. ──
function entryScore(e) {
  const s = e?.formScore;
  if (s && typeof s === "object" && Number.isFinite(s.score)) return s.score;
  if (typeof s === "number" && Number.isFinite(s)) return s;
  return null;
}
function entryRepCount(e) {
  if (Number.isFinite(e?.repCount)) return e.repCount;
  if (Number.isFinite(e?.progressSignals?.repCount)) return e.progressSignals.repCount;
  return null;
}
function entryTrendKey(e) {
  const t = e?.progressSignals?.trendKey;
  return Number.isFinite(t) ? t : null;
}
function entryPrimaryFocus(e) {
  const f = e?.progressSignals?.primaryFocus;
  if (typeof f === "string" && f.trim()) return f;
  const tp = e?.coaching?.topPriority;
  if (typeof tp === "string" && tp.trim()) return tp;
  return null;
}
function entryConfidenceLevel(e) {
  const l = e?.confidence?.level;
  return typeof l === "string" && l.trim() ? l : null;
}

const CONFIDENCE_RANK = { low: 1, moderate: 2, medium: 2, fair: 2, high: 3, "very-high": 4, veryhigh: 4 };
function confidenceRank(level) {
  if (typeof level !== "string") return null;
  return CONFIDENCE_RANK[level.toLowerCase()] ?? null;
}

// camelCase / snake / kebab focus token → readable words ("kneeDepth" → "knee depth").
function humanizeFocus(focus) {
  if (typeof focus !== "string" || !focus.trim()) return null;
  return focus
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function fmtSignedInt(n) {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : `${r}`;
}
function fmtSigned1(n) {
  const r = round1(n);
  if (r == null) return "0";
  return r > 0 ? `+${r}` : `${r}`;
}

// Compare a current entry against its previous same-movement entry. `previous`
// may be null (no prior check). Returns a fully-derived, render-ready object.
export function compareFormCheckEntries(current, previous) {
  const movementLabel = normalizeMovementLabel(current);
  const primaryFocus = entryPrimaryFocus(current) || null;
  const recommendation =
    (typeof current?.coaching?.nextSetCue === "string" && current.coaching.nextSetCue.trim()
      ? current.coaching.nextSetCue
      : null) ||
    (Array.isArray(current?.coaching?.watchItems) && current.coaching.watchItems[0]
      ? current.coaching.watchItems[0]
      : null) ||
    (primaryFocus ? `Keep an eye on ${humanizeFocus(primaryFocus)} on your next check.` : null);

  if (!current || !previous) {
    return {
      hasPrevious: false,
      movementLabel,
      previousDate: null,
      scoreDelta: null,
      trendDelta: null,
      repDelta: null,
      confidenceChange: { from: null, to: entryConfidenceLevel(current), direction: null },
      primaryFocus,
      focusChanged: false,
      summary: current
        ? `First saved ${movementLabel} check — future checks will compare against this one.`
        : "No saved form check to compare yet.",
      chips: [],
      recommendation,
    };
  }

  const curScore = entryScore(current);
  const prevScore = entryScore(previous);
  const scoreDelta = curScore != null && prevScore != null ? Math.round(curScore - prevScore) : null;

  const curTrend = entryTrendKey(current);
  const prevTrend = entryTrendKey(previous);
  const trendDelta = curTrend != null && prevTrend != null ? round1(curTrend - prevTrend) : null;

  const curReps = entryRepCount(current);
  const prevReps = entryRepCount(previous);
  const repDelta = curReps != null && prevReps != null ? curReps - prevReps : null;

  const curConf = entryConfidenceLevel(current);
  const prevConf = entryConfidenceLevel(previous);
  const curRank = confidenceRank(curConf);
  const prevRank = confidenceRank(prevConf);
  let confDirection = null;
  if (curRank != null && prevRank != null) {
    confDirection = curRank > prevRank ? "up" : curRank < prevRank ? "down" : "same";
  }
  const confidenceChange = { from: prevConf, to: curConf, direction: confDirection };

  const prevFocus = entryPrimaryFocus(previous);
  const focusChanged = Boolean(primaryFocus && prevFocus && primaryFocus !== prevFocus);

  const chips = [];
  if (scoreDelta != null) {
    chips.push({ label: "Score", value: fmtSignedInt(scoreDelta), tone: scoreDelta > 0 ? "positive" : scoreDelta < 0 ? "negative" : "neutral" });
  }
  if (trendDelta != null) {
    chips.push({ label: "Trend", value: fmtSigned1(trendDelta), tone: "neutral" });
  }
  if (repDelta != null) {
    chips.push({ label: "Reps", value: fmtSignedInt(repDelta), tone: "neutral" });
  }
  if (confDirection && confDirection !== "same") {
    chips.push({ label: "Conf", value: `${prevConf || "—"}→${curConf || "—"}`, tone: confDirection === "up" ? "positive" : "negative" });
  }

  // Conservative, data-only summary sentence.
  const shortDate = typeof previous.date === "string" ? previous.date.slice(0, 10) : null;
  const parts = [];
  if (scoreDelta != null && scoreDelta !== 0) parts.push(`form score ${fmtSignedInt(scoreDelta)}`);
  if (repDelta != null && repDelta !== 0) parts.push(`${fmtSignedInt(repDelta)} rep${Math.abs(repDelta) === 1 ? "" : "s"}`);
  if (trendDelta != null && trendDelta !== 0) parts.push(`trend key ${fmtSigned1(trendDelta)}`);
  if (confDirection && confDirection !== "same") parts.push(`confidence ${confDirection === "up" ? "higher" : "lower"}`);
  const lead = `Vs. your previous ${movementLabel} check${shortDate ? ` (${shortDate})` : ""}`;
  const summary = parts.length
    ? `${lead}: ${parts.join(", ")}.`
    : `${lead}: no measurable change in saved metrics.`;

  return {
    hasPrevious: true,
    movementLabel,
    previousDate: previous.date || null,
    scoreDelta,
    trendDelta,
    repDelta,
    confidenceChange,
    primaryFocus,
    focusChanged,
    summary,
    chips,
    recommendation,
  };
}

// Aggregate, render-ready summary of the whole saved history.
export function buildFormCheckHistorySummary(history) {
  const list = Array.isArray(history) ? history.filter(Boolean) : [];
  const ordered = sortByDateDesc(list);
  const latest = ordered[0] || null;

  // Group by movement family, tracking the newest entry per family.
  const byFamily = new Map();
  for (const e of ordered) {
    const fam = movementFamilyKey(e) || "__unknown__";
    const bucket = byFamily.get(fam);
    if (bucket) {
      bucket.count += 1;
    } else {
      // `ordered` is newest-first, so the first seen per family IS its latest.
      byFamily.set(fam, { movement: fam, latestEntry: e, count: 1 });
    }
  }

  const movements = [...byFamily.values()]
    .map(({ movement, latestEntry, count }) => ({
      movement,
      label: normalizeMovementLabel(latestEntry),
      count,
      latestDate: latestEntry?.date || null,
      latestScore: entryScore(latestEntry),
      trendKey: entryTrendKey(latestEntry),
      primaryFocus: entryPrimaryFocus(latestEntry),
    }))
    .sort((a, b) => {
      const ta = toTime(a.latestDate);
      const tb = toTime(b.latestDate);
      const va = Number.isNaN(ta) ? -Infinity : ta;
      const vb = Number.isNaN(tb) ? -Infinity : tb;
      return vb - va;
    });

  const latestComparison = latest
    ? compareFormCheckEntries(latest, getPreviousForMovement(ordered, latest))
    : null;

  return {
    total: list.length,
    movementCount: movements.length,
    latest,
    latestComparison,
    movements,
  };
}

// Trend Coach / Progress Memory V2.
//
// PURE helpers that read already-derived history records and summarize a
// movement's trajectory across several checks. Conservative language: they never
// diagnose, only describe measured deltas. They tolerate V1.1–V1.5 entries and
// missing scores/focus, and fall back to "insufficient-data" rather than guessing.

// Most common primaryFocus across a set of entries. Returns a small object with a
// human-readable label, or null when nothing recurs.
export function findRecurringFocus(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const counts = new Map();
  for (const e of list) {
    const f = entryPrimaryFocus(e);
    if (typeof f === "string" && f.trim()) {
      const key = f.trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  let best = null;
  for (const [focus, count] of counts) {
    if (!best || count > best.count) best = { focus, count };
  }
  if (!best) return null;
  return { focus: best.focus, count: best.count, label: humanizeFocus(best.focus) || best.focus };
}

// The highest-scoring entry among the given (already limited) entries.
export function findBestRecentCheck(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  let best = null;
  for (const e of list) {
    const s = entryScore(e);
    if (s == null) continue;
    if (!best || s > best.score) best = { score: s, date: e.date || null, entry: e };
  }
  return best;
}

// Conservative, data-only next-check recommendation string. Prefers keeping the
// same camera angle when a focus recurs, otherwise nudges toward consistency.
export function buildNextCheckRecommendation(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (list.length === 0) return "Save a form check to start building a trend for this movement.";
  const recurring = findRecurringFocus(list);
  if (recurring && recurring.count >= 2) {
    return `“${recurring.label}” has come up more than once — keep the same camera angle next time so checks stay comparable.`;
  }
  if (list.length < 2) {
    return "One more check from the same angle will let the trend coach compare progress.";
  }
  return "Film your next check from the same side angle and distance to keep the comparison honest.";
}

// Ordered oldest→newest scores for a set of newest-first entries.
function chronologicalScores(newestFirst) {
  return newestFirst
    .slice()
    .reverse()
    .map(entryScore)
    .filter((s) => s != null);
}

// Build a trend summary for a single movement family. `movement` may be an entry
// or a bare movement string. Returns the V1.6 trend object shape.
export function buildMovementTrend(history, movement, { limit = 5 } = {}) {
  const all = getEntriesForMovement(history, movement); // newest-first
  const entries = all.slice(0, Math.max(1, limit));
  const count = entries.length;
  const label = normalizeMovementLabel(entries[0] || movement);
  const movementKey = movementFamilyKey(entries[0] || movement);
  const latestDate = entries[0]?.date || null;

  const scores = chronologicalScores(entries);
  let scoreTrend = "insufficient-data";
  let scoreDeltaFromOldest = null;
  if (scores.length >= 2) {
    scoreDeltaFromOldest = Math.round(scores[scores.length - 1] - scores[0]);
    if (scoreDeltaFromOldest >= 4) scoreTrend = "improving";
    else if (scoreDeltaFromOldest <= -4) scoreTrend = "declining";
    else scoreTrend = "stable";
  }

  const best = findBestRecentCheck(entries);
  const recurring = findRecurringFocus(entries);
  const nextCheckRecommendation = buildNextCheckRecommendation(entries);

  // Confidence note is deliberately hedged and scaled to the sample size.
  const scoredCount = scores.length;
  let confidenceNote;
  if (count < 2) {
    confidenceNote = "Only one saved check — not enough history to call a trend yet.";
  } else if (scoredCount < 2) {
    confidenceNote = `Based on ${count} recent checks, but too few had a form score to trend reliably.`;
  } else {
    confidenceNote = `Based on ${scoredCount} scored check${scoredCount === 1 ? "" : "s"} — a rough directional read, not a verdict. Camera angle differences can shift scores.`;
  }

  return {
    movement: movementKey,
    label,
    count,
    latestDate,
    scoreTrend,
    scoreDeltaFromOldest,
    bestRecentScore: best ? best.score : null,
    recurringFocus: recurring,
    nextCheckRecommendation,
    confidenceNote,
  };
}

// Build trend summaries for every movement family present in history, newest
// movement first (by latest check date).
export function buildAllMovementTrends(history) {
  const list = Array.isArray(history) ? history.filter(Boolean) : [];
  const families = new Set();
  for (const e of list) {
    const fam = movementFamilyKey(e);
    if (fam) families.add(fam);
  }
  return [...families]
    .map((fam) => buildMovementTrend(list, fam))
    .sort((a, b) => {
      const ta = toTime(a.latestDate);
      const tb = toTime(b.latestDate);
      const va = Number.isNaN(ta) ? -Infinity : ta;
      const vb = Number.isNaN(tb) ? -Infinity : tb;
      return vb - va;
    });
}
