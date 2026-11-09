// src/recoverySummary.js
// Recovery presentation helpers
//
// Pure, side-effect-free display summarizers. These do NOT recompute recovery,
// re-derive Oura payload shapes, or change any scoring. They only reshape the
// metrics RecoveryDashboard has *already* calculated into a coaching-first
// hierarchy: a "what changed today" flag list, a plain-language coach
// interpretation, and hero metadata. Everything is defensive against null so a
// partial/loading state never throws.
//
// Coaching-safe language only. No medical diagnosis. Component ledger raw
// values/baselines/sources are rendered elsewhere and are intentionally NOT
// hidden by these summaries.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isStressTone = (tone) => tone === "warning" || tone === "caution";

/**
 * Reduce the already-calculated recovery metrics into a short "What changed
 * today?" flag list. Display summarization only — surfaces the important
 * deviations first, capped to 5 rows. Returns { rows, hasFlags }.
 *
 * Each row: { key, label, value, tone } where tone ∈ good|caution|warning.
 * Alerts (already computed upstream) are summarized before generic notes.
 */
export function buildRecoveryChangeSummary(input = {}) {
  const { hrv, rhr, sleep, temp, sleepDebt, trainingLoad, alerts } = input || {};
  const rows = [];

  // ── Alerts summarize first (severity-ranked) ──────────────────────────────
  const alertList = Array.isArray(alerts) ? alerts : [];
  if (alertList.length) {
    const rank = { warning: 3, caution: 2, positive: 1 };
    const top = [...alertList].sort(
      (a, b) => (rank[b?.severity] || 0) - (rank[a?.severity] || 0)
    )[0];
    const type = String(top?.type || top?.severity || "signal").replace(/_/g, " ");
    const markerCount = Array.isArray(top?.markers) ? top.markers.length : 0;
    rows.push({
      key: "alerts",
      label: "Signals",
      value: markerCount
        ? `${type} · ${markerCount} marker${markerCount === 1 ? "" : "s"}`
        : type,
      tone: top?.severity === "warning" ? "warning" : top?.severity === "positive" ? "good" : "caution",
    });
  }

  // ── HRV suppressed (z-score below baseline) ───────────────────────────────
  const hrvZ = num(hrv?.zScore);
  if (hrv && hrvZ !== null && hrvZ <= -0.5) {
    const lowConf = hrv.confidence === "low" || hrv.confidence === "insufficient";
    rows.push({
      key: "hrv",
      label: "HRV balance",
      value: `${hrv.score}/35 · z ${hrvZ.toFixed(2)}${lowConf ? " · low confidence" : ""}`,
      tone: hrvZ <= -1 ? "warning" : "caution",
    });
  }

  // ── Resting heart rate elevated vs baseline ───────────────────────────────
  const rhrDelta = num(rhr?.delta);
  if (rhr && rhrDelta !== null && rhrDelta > 3) {
    rows.push({
      key: "rhr",
      label: "Resting HR",
      value: `${rhr.score}/25 · +${rhrDelta.toFixed(1)} bpm vs baseline`,
      tone: rhrDelta > 6 ? "warning" : "caution",
    });
  }

  // ── Sleep contribution limiting the score ─────────────────────────────────
  const sleepNightly = num(sleep?.nightly);
  if (sleep && sleepNightly !== null && sleepNightly < 17) {
    rows.push({
      key: "sleep",
      label: "Sleep",
      value: `${sleepNightly}/25 nightly · limiting`,
      tone: sleepNightly < 12 ? "warning" : "caution",
    });
  }

  // ── Accumulated sleep debt ────────────────────────────────────────────────
  const debt = num(sleepDebt?.debtHours);
  if (sleepDebt && debt !== null && debt > 2) {
    const band = String(sleepDebt.band || "").toLowerCase();
    rows.push({
      key: "sleepDebt",
      label: "Sleep debt · 7d",
      value: `${debt.toFixed(1)}h${band ? ` · ${band}` : ""}`,
      tone: debt >= 5 ? "warning" : "caution",
    });
  }

  // ── Body temperature deviation / elevated nights ──────────────────────────
  const tempDev = num(temp?.deviation);
  const tempNights = num(temp?.consecutiveNights) || 0;
  if (temp && ((tempDev !== null && tempDev > 0.3) || tempNights >= 2)) {
    const devPart = tempDev !== null ? `+${tempDev.toFixed(2)}°C` : null;
    const value = tempNights > 0
      ? `${devPart ? `${devPart} · ` : ""}${tempNights}+ elevated night${tempNights === 1 ? "" : "s"}`
      : `${devPart} deviation`;
    rows.push({
      key: "temp",
      label: "Temperature",
      value,
      tone: tempNights >= 3 ? "warning" : "caution",
    });
  }

  // ── Training load running ahead of chronic baseline ───────────────────────
  const zone = trainingLoad?.rolling?.zone;
  const ratio = num(trainingLoad?.rolling?.ratio);
  if (trainingLoad && (zone === "overreaching" || zone === "high_risk")) {
    const zoneLabel = trainingLoad.zoneInfo?.label || String(zone).replace(/_/g, " ");
    rows.push({
      key: "load",
      label: "Training load",
      value: `ACWR ${ratio !== null ? ratio.toFixed(2) : "n/a"} · ${zoneLabel}`,
      tone: zone === "high_risk" ? "warning" : "caution",
    });
  }

  // ── Positive signals (only surfaced when there is room) ───────────────────
  if (hrv && hrvZ !== null && hrvZ >= 0.5) {
    rows.push({
      key: "hrv-strong",
      label: "HRV balance",
      value: `${hrv.score}/35 · z +${hrvZ.toFixed(2)} · strong`,
      tone: "good",
    });
  }
  if (rhr && rhrDelta !== null && rhrDelta <= -2) {
    rows.push({
      key: "rhr-low",
      label: "Resting HR",
      value: `${rhr.score}/25 · ${rhrDelta.toFixed(1)} bpm vs baseline`,
      tone: "good",
    });
  }

  const hasFlags = rows.some((r) => isStressTone(r.tone));
  const limited = rows.slice(0, 5);

  if (!limited.length) {
    return {
      rows: [{
        key: "none",
        label: "Status",
        value: "No major stress flags surfaced; component ledger below has raw values.",
        tone: "good",
      }],
      hasFlags: false,
    };
  }
  return { rows: limited, hasFlags };
}

/**
 * Plain-language "what this means" coach interpretation. Reuses the already
 * computed recommendation/insights/flags — it does not re-score anything.
 * Returns { cluster, body, guidance, confidenceNote, tone, connected }.
 *
 * Coaching-safe, never diagnostic. When !connected, treats manual check-in as
 * the first-class primary signal and reports input depth/confidence.
 */
export function buildRecoveryCoachInterpretation(input = {}) {
  const {
    recommendation,
    insights,
    sleepDebt,
    trainingLoad,
    alerts,
    confidence,
    quality,
    connected = true,
    subjectiveRecovery,
    manualCompleteness,
  } = input || {};

  const alertList = Array.isArray(alerts) ? alerts : [];
  const hasType = (t) => alertList.some((a) => a?.type === t);
  const hasWarning = alertList.some((a) => a?.severity === "warning");

  // ── Manual-only interpretation ────────────────────────────────────────────
  if (!connected) {
    const filled = num(manualCompleteness?.filled) ?? 0;
    const total = num(manualCompleteness?.total) ?? 0;
    const confWord = filled >= 6 ? "high" : filled >= 3 ? "moderate" : "limited";
    const scoreNote = subjectiveRecovery
      ? `Your manual check-in reads ${subjectiveRecovery.score}/100 (${subjectiveRecovery.read}).`
      : "No manual check-in logged yet.";
    const cluster = "Manual check-in is your primary readiness signal today.";
    const body = `${scoreNote} This is a first-class recovery read — Oura only layers biometric detail on top when it is connected.`;
    const guidance = subjectiveRecovery
      ? `Train in line with a ${subjectiveRecovery.read} day, and log more fields to raise data confidence.`
      : "Log sleep, sleep quality, soreness, stress, and motivation to build today's read.";
    const confidenceNote = total
      ? `Input depth: ${filled}/${total} recovery fields · ${confWord} data confidence. This is completeness, not an Oura failure.`
      : null;
    return { cluster, body, guidance, confidenceNote, tone: "neutral", connected: false };
  }

  // ── Connected: detect the dominant "stress cluster" ───────────────────────
  const debt = num(sleepDebt?.debtHours) || 0;
  const zone = trainingLoad?.rolling?.zone;
  let cluster;
  let tone;
  if (hasWarning && hasType("illness_warning")) {
    cluster = "This looks like a multi-system stress cluster — several recovery markers are deviating together.";
    tone = "warning";
  } else if (hasType("stress_alert")) {
    cluster = "Stress markers are clustering; recovery capacity is likely reduced today.";
    tone = "caution";
  } else if (hasType("sleep_limited")) {
    cluster = "This looks like a sleep-limited day rather than systemic stress.";
    tone = "caution";
  } else if (hasType("minor_deviation")) {
    cluster = "One or two markers are drifting from baseline — worth watching, not alarming.";
    tone = "caution";
  } else if (debt >= 5) {
    cluster = "Recovery is sleep-limited: you're carrying meaningful sleep debt.";
    tone = "caution";
  } else if (zone === "high_risk" || zone === "overreaching") {
    cluster = "Training load is running ahead of your chronic baseline.";
    tone = "caution";
  } else {
    cluster = "Biometrics look stable; normal training is reasonable if symptoms are absent.";
    tone = "good";
  }

  // Guidance is the already-computed, conservative recommendation prescription.
  let guidance = recommendation?.prescription
    || "Keep normal training constraints in place, and stop if subjective readiness disagrees.";
  if (hasWarning) {
    guidance += " If you notice illness or injury symptoms, treat today as recovery regardless of the score.";
  }

  // Body = plain-language context from the existing insight rows (minus the
  // recommendation echo, which is already the guidance line).
  const noteRows = (Array.isArray(insights) ? insights : [])
    .filter((r) => r && !/^Training recommendation:/i.test(r));
  const body = noteRows.slice(0, 2).join(" ") || null;

  // Confidence framing.
  let confidenceNote = confidence?.level
    ? `${confidence.level} data confidence${confidence.reason ? ` — ${confidence.reason}` : ""}.`
    : null;
  if (quality?.fallbackMode) {
    const fallbackCopy = "Some values use Oura readiness-contributor fallback because detailed sleep/readiness fields are missing, which lowers confidence.";
    confidenceNote = confidenceNote ? `${confidenceNote} ${fallbackCopy}` : fallbackCopy;
  }

  return { cluster, body, guidance, confidenceNote, tone, connected: true };
}

/**
 * Compact hero metadata: source label, confidence label, latest usable recovery
 * day, and whether the sync is stale. Pure formatting over already-computed
 * quality/confidence/token status.
 */
export function buildRecoveryHeroMeta(input = {}) {
  const { connected = true, confidence, quality, tokenStatus } = input || {};
  const source = connected ? "Oura biometrics" : "Manual check-in";
  const confidenceLabel = confidence?.level ? `${confidence.level} confidence` : "confidence pending";
  // Prefer the latest usable *recovery* day (has sleep/readiness); fall back to
  // the newest synced calendar date.
  const latestDay = quality?.latestRecoveryDate || quality?.latestDate || null;
  const stale = Boolean(
    tokenStatus?.syncStatus === "stale" ||
    tokenStatus?.syncStatus === "failed" ||
    quality?.recoveryDayIsStale
  );
  return {
    source,
    confidenceLabel,
    confidenceReason: confidence?.reason || null,
    latestDay,
    stale,
  };
}

// Wearable source disclosure

// Friendly per-metric labels for the compact source note. Sleep duration and
// sleep quality collapse to a single "sleep" mention to keep the string short.
const SOURCE_NOTE_LABELS = {
  sleep: "sleep",
  sleepQuality: "sleep",
  hrv: "HRV",
  rhr: "RHR",
  temp: "temp",
  recovery: "recovery",
  strain: "strain",
  workouts: "workouts",
  respiratoryRate: "resp rate",
  spo2: "SpO₂",
  subjective: "feel",
};

const SOURCE_DISPLAY = {
  oura: "Oura",
  whoop: "Whoop",
  manual: "Manual",
  app_log: "App log",
};

// Order sources are listed in the disclosure string.
const SOURCE_ORDER = ["oura", "whoop", "manual", "app_log"];

/**
 * Build a compact wearable source disclosure from a resolved recovery context
 * (see recovery/wearableSourceResolver.js). Groups metrics by the source that
 * won them, e.g. "Oura (sleep, HRV, RHR) · Whoop (strain, SpO₂) · Manual (feel)".
 * Returns null when no wearable (Oura/Whoop) source is present.
 */
export function buildWearableSourceNote(resolvedContext) {
  if (!resolvedContext || typeof resolvedContext !== "object") return null;

  const grouped = {};
  for (const [metric, label] of Object.entries(SOURCE_NOTE_LABELS)) {
    const resolved = resolvedContext[metric];
    const source = resolved && resolved.source ? resolved.source : null;
    if (!source) continue;
    if (!grouped[source]) grouped[source] = [];
    // De-duplicate labels (sleep + sleepQuality) within a source group.
    if (!grouped[source].includes(label)) grouped[source].push(label);
  }

  // No wearables connected → nothing to disclose.
  if (!grouped.oura && !grouped.whoop) return null;

  const parts = [];
  for (const source of SOURCE_ORDER) {
    const labels = grouped[source];
    if (!labels || !labels.length) continue;
    parts.push(`${SOURCE_DISPLAY[source] || source} (${labels.join(", ")})`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export default {
  buildRecoveryChangeSummary,
  buildRecoveryCoachInterpretation,
  buildRecoveryHeroMeta,
  buildWearableSourceNote,
};
