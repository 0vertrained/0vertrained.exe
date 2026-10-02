/**
 * uiStability.js
 *
 * Pure, side-effect-free presentation helpers for V4.1 "UX Stability + Polish".
 * These reshape already-known state into stable loading/refresh descriptors and
 * a forward-looking coach line. No writes, no localStorage, no algorithm/scoring
 * changes — the outlook helper only reformats fields the decision engine already
 * produced. Consumed by ui/primitives.jsx (LoadingShell/RefreshingBar) and the
 * Today coach card.
 *
 * Design goals:
 * - A tab should never look empty while data loads: getSkeletonPlan() gives each
 *   tab a stable multi-row shell that mirrors its loaded section rhythm.
 * - Cached content stays on screen during background revalidation, with a quiet
 *   refreshing indicator instead of a blank snap-in: resolveLoadState().
 */

// Section labels per tab, ordered to mirror each tab's loaded hierarchy so the
// skeleton reads like the real content it is standing in for (not a generic
// spinner). Kept short — these render as ledger card headers.
export const TAB_SKELETON_PLANS = {
  Today: [
    { key: "coach", title: "Today's call", message: "Bringing your coaching call, plan, and logs into sync." },
    { key: "plan", title: "Today's plan" },
    { key: "status", title: "Quick status" },
  ],
  Fuel: [
    { key: "target", title: "Fuel target", message: "Pulling today's macros and what's still needed." },
    { key: "quickadd", title: "Quick add" },
    { key: "meal", title: "Next meal" },
  ],
  Progress: [
    { key: "review", title: "Weekly review", message: "Checking whether the plan is working." },
    { key: "limiters", title: "Limiting factors" },
    { key: "evidence", title: "Trend evidence" },
    { key: "block", title: "Block guidance" },
  ],
  Recovery: [
    { key: "readiness", title: "Readiness", message: "Reading your recovery signals." },
    { key: "changed", title: "What changed today" },
    { key: "coach", title: "Coach interpretation" },
    { key: "ledger", title: "Component ledger" },
  ],
};

// Generic fallback shell for any surface without an explicit plan.
const GENERIC_PLAN = [
  { key: "a", title: "Loading", message: "Bringing your data into sync." },
  { key: "b", title: "Loading" },
];

/**
 * Return the stable skeleton plan (array of {key,title,message?}) for a tab.
 * Always returns a non-empty array so callers never render a blank shell.
 * @param {string} tab
 * @returns {Array<{key:string,title:string,message?:string}>}
 */
export function getSkeletonPlan(tab) {
  const plan = TAB_SKELETON_PLANS[tab];
  return Array.isArray(plan) && plan.length ? plan : GENERIC_PLAN;
}

/**
 * Resolve the visual load state for a tab from the two app-level flags.
 *
 * - Not loaded yet, no cached content → show the skeleton shell.
 * - Loaded (cache hit or fresh) → show real content; if a background
 *   revalidation is in flight, also surface a quiet refreshing indicator so the
 *   content never blanks between cache and network.
 *
 * @param {{loaded?:boolean, refreshing?:boolean}} state
 * @returns {{showSkeleton:boolean, showRefreshing:boolean, ready:boolean}}
 */
export function resolveLoadState({ loaded = false, refreshing = false } = {}) {
  const ready = Boolean(loaded);
  return {
    showSkeleton: !ready,
    // Only show "refreshing" once real content is on screen — while the skeleton
    // is up, the skeleton itself already communicates loading.
    showRefreshing: ready && Boolean(refreshing),
    ready,
  };
}

// Forward-looking one-liner per call. Answers "what would change tomorrow?"
// using only the decision the engine already made — no new scoring.
const OUTLOOK_BY_CALL = {
  recover: "Take the recovery day and tomorrow's call should ease back toward normal.",
  rest: "Rest fully today — a good night should lift tomorrow's readiness.",
  modify: "Keep it controlled today; if soreness and load settle, expect more green tomorrow.",
  maintain: "Stay consistent — a solid check-in tonight sharpens tomorrow's call.",
  push: "Bank the quality work; tomorrow's call depends on how well you recover tonight.",
};

/**
 * Build a short, forward-looking coach outlook line for Today from the already
 * computed decision. Presentation only — reads existing fields, never rescoring.
 *
 * Priority: when confidence is low or data is limited, nudge toward logging so
 * tomorrow's call is grounded; otherwise give the call-appropriate outlook.
 *
 * @param {object|null} decision - decision object from buildTodayDecision
 * @returns {{eyebrow:string, text:string}|null}
 */
export function buildTomorrowOutlook(decision) {
  if (!decision || typeof decision !== "object") return null;

  const badges = Array.isArray(decision.sourceBadges) ? decision.sourceBadges : [];
  const limited = badges.includes("Limited data");
  const lowConf = String(decision.confidence).toLowerCase() === "low";

  if (limited || lowConf) {
    return {
      eyebrow: "If today holds",
      text: "Log tonight's check-in — sleep, soreness, energy — to raise tomorrow's confidence.",
    };
  }

  const text = OUTLOOK_BY_CALL[decision.call];
  if (!text) return null;
  return { eyebrow: "If today holds", text };
}
