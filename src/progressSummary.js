// src/progressSummary.js
// Progress presentation helpers
//
// Pure, side-effect-free display summarizers for the redesigned Progress tab.
// They reshape objects that other modules have ALREADY computed (weekly coach
// review, weekly metrics, decision feedback, periodization action, saved Form
// Check summaries/trends) into a single reflection-first hierarchy:
//
//   1. "Is the plan working?" hero verdict
//   2. Limiting-factor cards
//   3. Trend evidence
//   4. Block guidance preview (suggest-only)
//   5. Form Check trend preview (derived summaries only)
//
// Hard rules for this module:
//   - No writes, no localStorage, no network, no Date.now-derived scoring.
//   - No recomputation of recovery/nutrition/program/Form Check/periodization
//     algorithms — only formatting of their outputs.
//   - Conservative coaching language only ("likely limiter", "worth watching",
//     "trend suggests"). No medical or diagnostic claims. No causal "X caused Y".
//   - Null-safe: a partial/loading/empty state must never throw or emit NaN.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round1 = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n * 10) / 10;
};

const round0 = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

const riskTone = (risk) =>
  risk === "high" ? "warning" : risk === "medium" ? "caution" : "good";

/**
 * "Is the plan working?" hero. Maps the already-computed weekly coach review
 * (score/summary/next actions/confidence) into a verdict + tone + drivers.
 *
 * Returns: { verdict, tone, score, summary, nextFocus, confidence, sourceLabel,
 *            primaryDrivers: [{ label, value, tone }] }
 *
 * verdict ∈ Improving | Holding | Limited | Needs adjustment | Not enough data yet
 * tone    ∈ good | neutral | caution | warning
 */
export function buildProgressHero({
  data = {},
  goals = {},
  settings = {},
  program = null,
  coachReview = null,
  decisionFeedback = null,
  timelineSummary = null,
  formCheckSummary = null,
  periodizationAction = null,
} = {}) {
  const cr = coachReview || {};
  const metrics = cr.metrics || {};
  const daysLogged = num(cr.daysLogged) ?? 0;
  const score = num(cr.score);

  const goalProtein = num(goals.protein) || 200;
  const goalWorkouts = num(goals.workouts) || 5;
  const goalMiles = num(goals.miles) || 15;

  // Primary drivers reuse the weekly metrics coachReview already aggregated.
  const workoutDays = num(metrics.workoutDays) ?? 0;
  const miles = round1(metrics.totalMiles) ?? 0;
  const protein = round0(metrics.avgProtein) ?? 0;
  const sleep = round1(metrics.avgSleep) ?? 0;
  const primaryDrivers = [
    {
      label: "Workouts",
      value: `${workoutDays}/${goalWorkouts}`,
      tone: workoutDays >= goalWorkouts ? "good" : workoutDays >= goalWorkouts * 0.6 ? "neutral" : "caution",
    },
    {
      label: "Miles",
      value: `${miles}`,
      tone: miles >= goalMiles ? "good" : miles >= goalMiles * 0.6 ? "neutral" : "caution",
    },
    {
      label: "Protein",
      value: `${protein}g`,
      tone: protein >= goalProtein ? "good" : protein >= goalProtein * 0.8 ? "neutral" : "caution",
    },
    {
      label: "Sleep",
      value: `${sleep}h`,
      tone: sleep >= 7 ? "good" : sleep >= 6 ? "neutral" : "caution",
    },
  ];

  // Empty / no-data guard — neutral, low confidence, never a warning verdict.
  if (daysLogged === 0) {
    return {
      verdict: "Not enough data yet",
      tone: "neutral",
      score: null,
      summary:
        "No days are logged for this week yet. Log training, fuel, and sleep for a few days and the weekly read fills in.",
      nextFocus: "Log a few days this week to unlock a weekly read.",
      confidence: "low",
      sourceLabel: "Weekly coach review · no days logged yet",
      primaryDrivers,
    };
  }

  let verdict;
  let tone;
  if (score !== null && score >= 75) {
    verdict = "Improving";
    tone = "good";
  } else if (score !== null && score >= 60) {
    verdict = "Holding";
    tone = "neutral";
  } else if (score !== null && score >= 45) {
    verdict = "Limited";
    tone = "caution";
  } else {
    verdict = "Needs adjustment";
    tone = "warning";
  }

  const summary =
    typeof cr.summary === "string" && cr.summary
      ? cr.summary
      : "Keep logging to sharpen the weekly read.";
  const nextFocus =
    (Array.isArray(cr.nextWeekActions) && cr.nextWeekActions[0]) ||
    (Array.isArray(cr.watchouts) && cr.watchouts[0]) ||
    "Maintain the current rhythm and log consistently.";
  const confidence =
    cr.confidence === "high" || cr.confidence === "medium" || cr.confidence === "low"
      ? cr.confidence
      : daysLogged >= 5
        ? "medium"
        : "low";
  const sourceLabel = `Weekly coach review · ${daysLogged} day${daysLogged === 1 ? "" : "s"} logged · ${confidence} confidence`;

  return { verdict, tone, score, summary, nextFocus, confidence, sourceLabel, primaryDrivers };
}

/**
 * Ordered limiting-factor cards. Reads the already-computed weekly review
 * metrics and names the most likely limiter(s) first, in conservative language.
 *
 * Returns: [{ id, title, status, tone, body, metric, action }]
 */
export function buildProgressLimiters({
  data = {},
  goals = {},
  review = null,
  decisionFeedback = null,
  formCheckSummary = null,
} = {}) {
  const rv = review || {};
  const goalProtein = num(goals.protein) || 200;
  const goalWorkouts = num(goals.workouts) || 5;
  const goalMiles = num(goals.miles) || 15;

  const daysLogged = num(rv.daysLogged) ?? 0;
  const workoutsDone = num(rv.workoutsDone) ?? 0;
  const totalMiles = round1(rv.totalMiles) ?? 0;
  const avgProtein = round0(rv.avgProtein) ?? 0;
  const avgSleep = round1(rv.avgSleep) ?? 0;
  const waterDays = num(rv.waterDays) ?? 0;

  // No data → a single neutral, honest card. Never invent a limiter.
  if (daysLogged === 0) {
    return [
      {
        id: "nodata",
        title: "Not enough data",
        status: "pending",
        tone: "neutral",
        body: "Log a few days this week and the likely limiter will surface here.",
        metric: "0 days logged",
        action: null,
      },
    ];
  }

  const cards = [];

  // Training consistency — usually the highest-leverage limiter.
  if (workoutsDone < goalWorkouts) {
    const severe = workoutsDone < Math.ceil(goalWorkouts * 0.5);
    cards.push({
      id: "training",
      title: "Training consistency",
      status: severe ? "well below target" : "below target",
      tone: severe ? "warning" : "caution",
      severity: severe ? 3 : 2,
      body: severe
        ? "Session count is the likely limiter this week."
        : "Session count is worth watching — a couple more sessions would lift the week.",
      metric: `${workoutsDone}/${goalWorkouts} sessions`,
      action: "Review the week in Block guidance.",
    });
  }

  // Recovery / sleep.
  if (avgSleep > 0 && avgSleep < 7) {
    const severe = avgSleep < 6;
    cards.push({
      id: "recovery",
      title: "Recovery / sleep",
      status: severe ? "short" : "below 7h",
      tone: severe ? "warning" : "caution",
      severity: severe ? 3 : 2,
      body: severe
        ? "Short sleep is a likely limiter — it caps recovery before training load can rise."
        : "Sleep is trending under 7h — worth watching before adding load.",
      metric: `${avgSleep}h avg sleep`,
      action: "Protect sleep before progressing.",
    });
  }

  // Fuel / protein.
  if (avgProtein < goalProtein) {
    const severe = avgProtein < goalProtein * 0.75;
    cards.push({
      id: "fuel",
      title: "Protein / fueling",
      status: severe ? "well under goal" : "under goal",
      tone: severe ? "warning" : "caution",
      severity: severe ? 2 : 1,
      body: severe
        ? "Protein is a likely limiter — the trend suggests under-fueling for the training done."
        : "Protein is running under goal — worth watching around training days.",
      metric: `${avgProtein}g avg · goal ${goalProtein}g`,
      action: "Prioritize protein earlier in the day.",
    });
  }

  // Run volume — secondary training signal.
  if (totalMiles < goalMiles && workoutsDone >= goalWorkouts) {
    cards.push({
      id: "miles",
      title: "Run volume",
      status: "below target",
      tone: "caution",
      severity: 1,
      body: "Mileage is under target while sessions are on track — worth watching if running is a goal.",
      metric: `${totalMiles}/${goalMiles} mi`,
      action: "Build mileage gradually only if readiness holds.",
    });
  }

  // Hydration — lightest signal.
  if (waterDays < 3) {
    cards.push({
      id: "hydration",
      title: "Hydration",
      status: "inconsistent",
      tone: "caution",
      severity: 1,
      body: "Hydration was hit on few days — worth watching alongside energy.",
      metric: `${waterDays}/7 days at goal`,
      action: "Front-load water earlier in the day.",
    });
  }

  if (cards.length === 0) {
    return [
      {
        id: "none",
        title: "No single limiter",
        status: "on track",
        tone: "good",
        body: "No single factor stands out as limiting this week — hold the pattern and progress one variable.",
        metric: `${workoutsDone}/${goalWorkouts} sessions · ${avgSleep}h sleep · ${avgProtein}g protein`,
        action: null,
      },
    ];
  }

  return cards
    .sort((a, b) => (b.severity || 0) - (a.severity || 0))
    .slice(0, 4)
    .map(({ severity, ...card }) => card);
}

/**
 * Trend evidence over the recent window. Computes light 30-day roll-ups from the
 * daily data map (no algorithm reuse needed — these are simple presentational
 * aggregates that mirror what the existing charts already show).
 *
 * Returns: { workouts30d, miles30d, proteinAvg, sleepAvg, weightTrend,
 *            streakLabel, cards: [{ label, value, subtext, tone }] }
 */
export function buildProgressEvidence({ data = {}, goals = {}, settings = {} } = {}) {
  const entries = Object.entries(data && typeof data === "object" ? data : {}).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const last30 = entries.slice(-30);

  const workouts30d = last30.filter(([, d]) => {
    const exCount = Object.keys(d?.workout?.exercises || {}).length;
    return exCount > 0 || (num(d?.workout?.cardio?.miles) || 0) > 0;
  }).length;

  const miles30d = round1(
    last30.reduce((acc, [, d]) => acc + (num(d?.workout?.cardio?.miles) || 0), 0)
  ) ?? 0;

  const proteinVals = last30.map(([, d]) => num(d?.nutrition?.protein)).filter((v) => v !== null && v > 0);
  const sleepVals = last30.map(([, d]) => num(d?.body?.sleep)).filter((v) => v !== null && v > 0);
  const weightVals = last30.map(([, d]) => num(d?.body?.weight)).filter((v) => v !== null && v > 0);

  const proteinAvg = proteinVals.length
    ? round0(proteinVals.reduce((a, b) => a + b, 0) / proteinVals.length)
    : null;
  const sleepAvg = sleepVals.length
    ? round1(sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length)
    : null;

  // Weight trend — first vs last observed weight in the window. Descriptive only.
  let weightTrend = null;
  if (weightVals.length >= 2) {
    const delta = round1(weightVals[weightVals.length - 1] - weightVals[0]);
    if (delta === null || Math.abs(delta) < 0.5) weightTrend = "holding steady";
    else weightTrend = `${delta > 0 ? "up" : "down"} ${Math.abs(delta)} lb`;
  } else if (weightVals.length === 1) {
    weightTrend = "single reading";
  }

  const goalProtein = num(goals.protein) || 200;
  const goalMiles = num(goals.miles) || 15;

  const cards = [
    {
      label: "Workouts · 30d",
      value: `${workouts30d}`,
      subtext: "sessions logged",
      tone: "neutral",
    },
    {
      label: "Miles · 30d",
      value: `${miles30d}`,
      subtext: `~${goalMiles}/wk target`,
      tone: "neutral",
    },
    {
      label: "Protein avg",
      value: proteinAvg === null ? "—" : `${proteinAvg}g`,
      subtext: `goal ${goalProtein}g`,
      tone: proteinAvg === null ? "neutral" : proteinAvg >= goalProtein ? "good" : "caution",
    },
    {
      label: "Sleep avg",
      value: sleepAvg === null ? "—" : `${sleepAvg}h`,
      subtext: "7h+ supports recovery",
      tone: sleepAvg === null ? "neutral" : sleepAvg >= 7 ? "good" : "caution",
    },
  ];

  if (weightTrend) {
    cards.push({
      label: "Weight trend",
      value: weightTrend,
      subtext: "last 30d",
      tone: "neutral",
    });
  }

  return {
    workouts30d,
    miles30d,
    proteinAvg,
    sleepAvg,
    weightTrend,
    streakLabel: `${entries.length} day${entries.length === 1 ? "" : "s"} on record`,
    cards,
  };
}

/**
 * Form Check trend preview for the Progress default view. Reads only the derived
 * history summary + movement trends — never raw video/frames/landmarks. Does not
 * fabricate a trend from a single check.
 *
 * Returns: { available, title, latestLabel, scoreLabel, trendLabel, nextAction,
 *            privacyNote }
 */
export function buildFormCheckProgressPreview({
  formCheckHistory = null,
  formCheckSummary = null,
  movementTrends = null,
} = {}) {
  const privacyNote =
    "Derived summaries only — no raw video, frames, or landmarks are stored.";
  const summary = formCheckSummary || {};
  const total = num(summary.total) ?? (Array.isArray(formCheckHistory) ? formCheckHistory.length : 0);

  if (!total) {
    return {
      available: false,
      title: "Form Check trends",
      latestLabel: null,
      scoreLabel: null,
      trendLabel: null,
      nextAction:
        "Save two checks for the same movement to unlock trend comparison.",
      privacyNote,
    };
  }

  const latest = summary.latest || null;
  const latestLabel =
    (summary.movements && summary.movements[0] && summary.movements[0].label) ||
    (latest && (latest.movementLabel || latest.movement)) ||
    "Latest movement";

  // Score/confidence label (tolerate object or numeric formScore shapes).
  const rawScore =
    latest && latest.formScore && typeof latest.formScore === "object"
      ? latest.formScore.score
      : typeof latest?.formScore === "number"
        ? latest.formScore
        : num(summary.movements?.[0]?.latestScore);
  const score = num(rawScore);
  const confLevel = latest?.confidence?.level || null;
  const scoreLabel =
    score !== null
      ? `Score ${score}${confLevel ? ` · ${confLevel} confidence` : ""}`
      : confLevel
        ? `${confLevel} confidence`
        : null;

  // Trend label — only from a movement that has ≥2 scored checks. Never fabricate.
  const trends = Array.isArray(movementTrends) ? movementTrends : [];
  const topTrend = trends[0] || null;
  let trendLabel = null;
  if (topTrend) {
    const map = {
      improving: "Trend suggests improving",
      declining: "Trend suggests declining",
      stable: "Holding steady",
    };
    trendLabel = map[topTrend.scoreTrend] || "Not enough history to trend yet";
  }

  const nextAction =
    (topTrend && topTrend.nextCheckRecommendation) ||
    "Save another check for the same movement to extend the trend.";

  return {
    available: true,
    title: "Form Check trends",
    latestLabel,
    scoreLabel,
    trendLabel,
    nextAction,
    privacyNote,
  };
}

/**
 * Block / periodization guidance preview for the Progress default view.
 * Formats the already-computed plan + suggested action. Suggest-only: this
 * NEVER writes a program or workout.
 *
 * Returns: { available, weekLabel, blockLabel, actionLabel, riskTone, rationale,
 *            suggestOnlyNote }
 */
export function buildBlockProgressPreview({ plan = null, action = null } = {}) {
  const suggestOnlyNote =
    "Suggest-only — no training program or workout is changed automatically.";

  if (!plan) {
    return {
      available: false,
      weekLabel: null,
      blockLabel: null,
      actionLabel: null,
      riskTone: "neutral",
      rationale:
        "Set up a block in the Periodization view to see week-by-week guidance here.",
      suggestOnlyNote,
    };
  }

  const currentWeek = num(plan.currentWeekNumber) ?? 1;
  const blockLength = num(plan.blockLengthWeeks) ?? 1;
  const act = action || {};
  const actionLabel =
    act.title || (typeof act.action === "string" ? act.action.replace(/_/g, " ") : "Hold the block");
  const rationale =
    (typeof act.rationale === "string" && act.rationale) ||
    "Keep executing the current week and watch the recovery signal.";

  return {
    available: true,
    weekLabel: `Week ${currentWeek}/${blockLength}`,
    blockLabel: plan.name || "Current Block",
    actionLabel,
    riskTone: riskTone(act.risk),
    rationale,
    suggestOnlyNote,
  };
}

export default {
  buildProgressHero,
  buildProgressLimiters,
  buildProgressEvidence,
  buildFormCheckProgressPreview,
  buildBlockProgressPreview,
};
