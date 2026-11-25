// src/firstWeekJourney.js
// Onboarding + First-Week Journey — pure helpers
//
// Deterministic, side-effect-free helpers that shape a stronger first-week
// experience for new beta users: a setup checklist, new-account empty states,
// conservative baseline-building coach copy, and a privacy-safe beta feedback
// note. The App.jsx UI reads these; nothing here writes, fetches, or reaches for
// a clock (callers inject `now`), so every branch is unit-testable.
//
// Hard rules for this module:
//   - No writes, no network, no localStorage, no scoring-algorithm changes.
//   - Only reshape values the app already has. Manual recovery is FIRST-CLASS —
//     never treated as "incomplete" or as an error.
//   - The beta feedback note NEVER includes entries, biometric/video payloads,
//     tokens, usernames, or other account identifiers — only whitelisted,
//     non-identifying setup metadata plus what the user typed themselves.

import { ONBOARDING_GOALS, ONBOARDING_DATA_MODES } from "./onboardingSetup";
import { summarizeProgramForHub } from "./moreHub";

// Public version label surfaced in UI copy and the beta feedback note.
export const APP_VERSION_LABEL = "V2.8";

// A "first week" is seven logged days; Progress becomes reviewable at three.
export const FIRST_WEEK_DAYS = 7;
export const PROGRESS_UNLOCK_DAYS = 3;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

// Per-day signal detection
// Mirrors the timeline/quick-log notion of a "meaningful" day: a day counts once
// it carries a real training, nutrition, recovery/check-in, or note signal. An
// object of empty scaffolding (all zeros / blanks) does NOT count.
function dayHasTraining(entry) {
  const w = entry?.workout || {};
  const exercises = w.exercises && typeof w.exercises === "object" ? w.exercises : {};
  if (Object.keys(exercises).length > 0) return true;
  if (num(w.cardio?.miles) > 0) return true;
  if (num(w.cardio?.minutes) > 0) return true;
  return false;
}

function dayHasNote(entry) {
  return nonEmptyString(entry?.workout?.notes);
}

function dayHasNutrition(entry) {
  const nut = entry?.nutrition || {};
  return (
    num(nut.calories) > 0 ||
    num(nut.protein) > 0 ||
    num(nut.carbs) > 0 ||
    num(nut.fats) > 0 ||
    num(nut.water) > 0
  );
}

function dayHasRecovery(entry) {
  const b = entry?.body || {};
  return (
    num(b.sleep) > 0 ||
    num(b.energy) > 0 ||
    num(b.soreness) > 0 ||
    num(b.stress) > 0 ||
    num(b.weight) > 0
  );
}

// A single day carries a meaningful signal when ANY channel is present.
export function dayHasSignal(entry) {
  if (!entry || typeof entry !== "object") return false;
  return (
    dayHasTraining(entry) ||
    dayHasNote(entry) ||
    dayHasNutrition(entry) ||
    dayHasRecovery(entry)
  );
}

// Logged-day counting
// Accepts the app's entries map (keyed by date) or an array of day payloads.
// Returns the number of DISTINCT days that carry a meaningful signal.
export function countLoggedDays(entries) {
  if (!entries || typeof entries !== "object") return 0;
  const days = Array.isArray(entries) ? entries : Object.values(entries);
  let count = 0;
  for (const day of days) {
    if (dayHasSignal(day)) count += 1;
  }
  return count;
}

// Break the count down by channel — used by checklist status + coach copy so a
// user who has logged only nutrition still sees "log training" as the next step.
export function countLoggedChannels(entries) {
  if (!entries || typeof entries !== "object") {
    return { total: 0, training: 0, nutrition: 0, recovery: 0 };
  }
  const days = Array.isArray(entries) ? entries : Object.values(entries);
  let total = 0;
  let training = 0;
  let nutrition = 0;
  let recovery = 0;
  for (const day of days) {
    if (!dayHasSignal(day)) continue;
    total += 1;
    if (dayHasTraining(day) || dayHasNote(day)) training += 1;
    if (dayHasNutrition(day)) nutrition += 1;
    if (dayHasRecovery(day)) recovery += 1;
  }
  return { total, training, nutrition, recovery };
}

// Setup age
// Days since setup.completedAt, or null when it is missing/invalid. `now` is
// injected so callers stay deterministic under test.
export function setupAgeDays(settings, now) {
  const raw = settings?.setup?.completedAt;
  if (!nonEmptyString(raw)) return null;
  const completed = new Date(raw).getTime();
  if (!Number.isFinite(completed)) return null;
  const ref = now instanceof Date ? now.getTime() : new Date(now ?? Date.now()).getTime();
  if (!Number.isFinite(ref)) return null;
  const ms = ref - completed;
  return ms / (1000 * 60 * 60 * 24);
}

// First-week detection
// True when the athlete has completed onboarding but is still inside their
// baseline week: fewer than seven logged days, OR setup finished within the last
// seven days. Pre-onboarding users are handled by the Tutorial, not this card.
export function isFirstWeekUser(settings, entries, now) {
  const onboarded = settings?.onboarded === true || settings?.onboarded === "true";
  if (!onboarded) return false;

  const loggedDays = countLoggedDays(entries);
  if (loggedDays < FIRST_WEEK_DAYS) return true;

  const age = setupAgeDays(settings, now);
  if (age !== null && age >= 0 && age < FIRST_WEEK_DAYS) return true;

  return false;
}

// Data-mode resolution
// Manual is first-class. Oura is "connected" when the ring is actually linked OR
// the athlete chose the Oura data mode during setup.
export function resolveDataMode(settings, ouraConnected) {
  const chosen = settings?.setup?.dataMode;
  if (ouraConnected || chosen === "oura") return "oura";
  if (chosen === "later") return "later";
  return "manual";
}

function dataModeLabel(mode) {
  const found = ONBOARDING_DATA_MODES.find((m) => m.id === mode);
  return found ? found.label : "Manual only";
}

function goalLabel(goalId) {
  const found = ONBOARDING_GOALS.find((g) => g.id === goalId);
  return found ? found.label : null;
}

// Setup checklist
// Ordered items with a `done` predicate each. Status is assigned by a single
// rule so transitions stay predictable and testable:
//   - a completed item is always 'done'
//   - the FIRST not-yet-complete item is 'next'
//   - every later incomplete item is 'pending'
export function buildFirstWeekChecklist({ settings, entries, program, ouraConnected } = {}) {
  const onboarded = settings?.onboarded === true || settings?.onboarded === "true";
  const channels = countLoggedChannels(entries);
  const loggedDays = channels.total;
  const programSummary = summarizeProgramForHub(program);
  const hasProgram = programSummary.hasProgram;
  const mode = resolveDataMode(settings, ouraConnected);
  const dataModeChosen = nonEmptyString(settings?.setup?.dataMode) || ouraConnected;
  const goals = settings?.goals || {};
  const targetsSet = num(goals.protein) > 0 || num(goals.calories) > 0;

  const recoveryDetail =
    mode === "oura"
      ? "Wearable connected — HRV and resting HR add confidence."
      : mode === "later"
      ? "Manual now; connect a wearable (Oura or Whoop) later in Settings → Integrations."
      : "Manual recovery is first-class — log sleep and energy.";

  const specs = [
    {
      id: "setup",
      label: "Finish setup",
      detail: onboarded
        ? "Goal, data mode, and macro targets are saved."
        : "Pick a goal, data mode, and macro targets.",
      done: onboarded,
      targetTab: "More",
      targetAction: "openSettings",
      cta: onboarded ? "Review" : "Finish",
    },
    {
      id: "program",
      label: "Generate or confirm your program",
      detail: hasProgram
        ? `Weekly plan ready — ${programSummary.line}.`
        : "Build a weekly plan so Today has a session to coach.",
      done: hasProgram,
      targetTab: "More",
      targetAction: "generateProgram",
      cta: hasProgram ? "Review" : "Generate",
    },
    {
      id: "recovery-mode",
      label: "Choose your recovery mode",
      detail: recoveryDetail,
      done: dataModeChosen,
      targetTab: "Recovery",
      targetAction: "openRecovery",
      cta: dataModeChosen ? "Open" : "Choose",
    },
    {
      id: "log-training",
      label: "Log today's training or a rest note",
      detail:
        channels.training > 0
          ? "Training logged — keep the streak going."
          : "A logged session or rest note starts your baseline.",
      done: channels.training > 0,
      targetTab: "Today",
      targetAction: "openToday",
      cta: channels.training > 0 ? "Open" : "Log",
    },
    {
      id: "log-fuel",
      label: "Log a first meal or set nutrition targets",
      detail:
        channels.nutrition > 0
          ? "Nutrition logged — the app is learning your pattern."
          : targetsSet
          ? "Targets are set — log one meal to start the pattern."
          : "Set targets and log one meal under Fuel.",
      done: channels.nutrition > 0 || targetsSet,
      targetTab: "Fuel",
      targetAction: "openFuel",
      cta: channels.nutrition > 0 ? "Open" : "Set up",
    },
    {
      id: "review-progress",
      label: "Review Progress after 3+ logged days",
      detail:
        loggedDays >= PROGRESS_UNLOCK_DAYS
          ? "Enough data to review — trends firm up at 7 days."
          : `Unlocks after ${PROGRESS_UNLOCK_DAYS} logged days (${loggedDays}/${PROGRESS_UNLOCK_DAYS}).`,
      done: loggedDays >= PROGRESS_UNLOCK_DAYS,
      targetTab: "Progress",
      targetAction: "openProgress",
      cta: "Review",
    },
  ];

  let nextAssigned = false;
  return specs.map((s) => {
    let status;
    if (s.done) {
      status = "done";
    } else if (!nextAssigned) {
      status = "next";
      nextAssigned = true;
    } else {
      status = "pending";
    }
    return {
      id: s.id,
      label: s.label,
      detail: s.detail,
      status,
      targetTab: s.targetTab,
      targetAction: s.targetAction,
      cta: s.cta,
    };
  });
}

// Compact progress summary for the card header (e.g. "3/6 complete" + next CTA).
export function summarizeChecklist(checklist = []) {
  const total = checklist.length;
  const done = checklist.filter((i) => i.status === "done").length;
  const next = checklist.find((i) => i.status === "next") || null;
  return {
    done,
    total,
    complete: total > 0 && done === total,
    label: `${done}/${total} complete`,
    next,
  };
}

// New-account empty / baseline states
// Additive, tab-specific guidance shown when a new user has sparse data. This
// never replaces functional controls — the UI renders it above the real tab.
const EMPTY_STATES = {
  Today: {
    title: "Your baseline week",
    message: "Log today or confirm your program to unlock the daily call.",
    cta: "Log today",
    targetTab: "Today",
  },
  Recovery: {
    title: "Recovery is ready now",
    message: "Manual recovery works now; wearable data improves confidence later.",
    cta: "Log recovery",
    targetTab: "Recovery",
  },
  Fuel: {
    title: "Start your fuel pattern",
    message: "Set targets and log one meal; the app will learn your pattern.",
    cta: "Set targets",
    targetTab: "Fuel",
  },
  Progress: {
    title: "Progress is building",
    message: "Progress unlocks after 3 logged days; stronger after 7.",
    cta: null,
    targetTab: "Progress",
  },
  More: {
    title: "Manage your setup",
    message: "Manage plan, integrations, and data.",
    cta: null,
    targetTab: "More",
  },
};

export function buildNewUserEmptyState(tab, { settings, entries, program, ouraConnected } = {}) {
  const base = EMPTY_STATES[tab];
  if (!base) return null;

  // Light context tailoring: keep the required copy, add a mode-aware nudge on
  // Recovery so a connected user is not told to log manually.
  if (tab === "Recovery") {
    const mode = resolveDataMode(settings, ouraConnected);
    if (mode === "oura") {
      return {
        ...base,
        title: "Recovery is ready now",
        message:
          "Oura data adds confidence; manual sleep and energy still sharpen the read.",
      };
    }
  }
  if (tab === "Today") {
    const hasProgram = summarizeProgramForHub(program).hasProgram;
    if (hasProgram) {
      return {
        ...base,
        message: "Log today to unlock the daily call — your program is ready.",
      };
    }
  }
  return { ...base };
}

// First-week coach copy
// Conservative, baseline-building language. Before enough data exists we NEVER
// use judgmental / trend words — we say the baseline is being established.
export function buildFirstWeekCoachCopy({ loggedDays = 0, setupGoal, dataMode } = {}) {
  const days = Math.max(0, Math.floor(num(loggedDays)));
  const goal = goalLabel(setupGoal);
  const mode = dataMode || "manual";
  const goalPhrase = goal ? ` for your ${goal.toLowerCase()} goal` : "";
  const modePhrase =
    mode === "oura"
      ? "Oura fills in HRV and resting heart rate as you go."
      : "Manual sleep and energy logs drive a full readiness read — no wearable needed.";

  let headline;
  let body;
  if (days <= 0) {
    headline = "Let's establish your baseline";
    body = `Nothing to compare against yet — that's expected. Log your first day${goalPhrase} and the app starts learning. ${modePhrase}`;
  } else if (days < PROGRESS_UNLOCK_DAYS) {
    headline = "Baseline is forming";
    body = `${days} day${days === 1 ? "" : "s"} in. A little more logging${goalPhrase} and Progress begins to read patterns — it is still too early to call a trend. ${modePhrase}`;
  } else if (days < FIRST_WEEK_DAYS) {
    headline = "Baseline is taking shape";
    body = `${days} logged days give the app enough to surface early patterns${goalPhrase}. Reach a full week for steadier trends. ${modePhrase}`;
  } else {
    headline = "Your first week is complete";
    body = `A full week is logged${goalPhrase}. Trends and readiness now rest on real data — keep the cadence going.`;
  }

  return {
    headline,
    body,
    loggedDays: days,
    baselineComplete: days >= FIRST_WEEK_DAYS,
    tone: "neutral",
  };
}

// Beta feedback note
// Builds a plain-text report the user can copy/share. It contains ONLY
// whitelisted, non-identifying setup metadata plus what the user typed. It must
// never include entries, biometric/video payloads, tokens, usernames, or any
// other account identifier — so it reads named fields explicitly and never
// spreads `settings`.
const DEFAULT_FEEDBACK_PLACEHOLDER =
  "(describe what worked, what was confusing, or what you'd change)";

export function buildBetaFeedbackText({ tab, settings, loggedDays, userAgent, note, version } = {}) {
  const setup = settings?.setup || {};
  const goal = goalLabel(setup.goal) || "not set";
  const mode = dataModeLabel(setup.dataMode);
  const onboarded = settings?.onboarded === true || settings?.onboarded === "true" ? "yes" : "no";
  const days = Math.max(0, Math.floor(num(loggedDays)));
  const currentTab = nonEmptyString(tab) ? tab : "unknown";
  const ua = nonEmptyString(userAgent) ? userAgent.trim().slice(0, 300) : "not available";
  const userNote = nonEmptyString(note) ? note.trim() : DEFAULT_FEEDBACK_PLACEHOLDER;
  // Version is caller-overridable so newer releases can stamp their own label
  // without breaking the frozen APP_VERSION_LABEL default used by older callers.
  const ver = nonEmptyString(version) ? version.trim().slice(0, 16) : APP_VERSION_LABEL;

  const lines = [
    `0vertrained beta feedback — ${ver}`,
    "----------------------------------------",
    `App version: ${ver}`,
    `Current tab: ${currentTab}`,
    `Logged days: ${days}`,
    `Setup goal: ${goal}`,
    `Data mode: ${mode}`,
    `Onboarding complete: ${onboarded}`,
    `Browser: ${ua}`,
    "",
    "Notes:",
    userNote,
    "----------------------------------------",
    "This note contains no logged personal data or account identifiers.",
  ];
  return lines.join("\n");
}

export default {
  APP_VERSION_LABEL,
  FIRST_WEEK_DAYS,
  PROGRESS_UNLOCK_DAYS,
  dayHasSignal,
  countLoggedDays,
  countLoggedChannels,
  setupAgeDays,
  isFirstWeekUser,
  resolveDataMode,
  buildFirstWeekChecklist,
  summarizeChecklist,
  buildNewUserEmptyState,
  buildFirstWeekCoachCopy,
  buildBetaFeedbackText,
};
