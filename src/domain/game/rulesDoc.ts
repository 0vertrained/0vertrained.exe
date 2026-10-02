// The README's game-rules table, rendered from config.ts so the two can't
// drift: scripts/gen-rules.mjs writes it, rulesDoc.test.ts fails when the
// README is stale.

import { ACHIEVEMENTS, LEVELS, RANKS, REDUCED, RULES_VERSION, STATS, STREAK, TITLE_COUNT, TRIAL, XP } from "./config";
import { xpToReachLevel } from "./levels";

export const RULES_START = "<!-- game-rules:start -->";
export const RULES_END = "<!-- game-rules:end -->";

function share(days: number): number {
  return Math.round(XP.weeklyTrainingPool / days / XP.trainingShareStep) * XP.trainingShareStep;
}

export function renderRulesMarkdown(): string {
  const lines: string[] = [];
  const row = (...cells: string[]) => lines.push(`| ${cells.join(" | ")} |`);
  lines.push(`_Generated from \`src/domain/game/config.ts\` (rules v${RULES_VERSION}) by \`npm run gen:rules\`. Do not edit by hand._`, "");

  lines.push("**XP**", "", "| Source | XP |", "|---|---|");
  row("Status check (3 of 4 rows answered)", `+${XP.checkin} per day`);
  row("Training quest", `a weekly pool of ${XP.weeklyTrainingPool} split across planned days: ${[2, 3, 4, 5, 6].map((d) => `${d} days → ${share(d)}`).join(", ")}`);
  row("…paid as", `${Math.round(XP.completionWeight * 100)}% pro rata by completion, plus ${Math.round(XP.clearBonusWeight * 100)}% once completion reaches ${Math.round(XP.clearedThreshold * 100)}% (cleared). A full week is ${XP.weeklyTrainingPool} training XP on any plan.`);
  row("Engine-issued REDUCED day", "the same share as FULL");
  row("Engine-issued RECOVER day", `the full share for the first ${XP.recoverFullPayPer7Days} in any 7 days, then +${XP.restDay}`);
  row("Scheduled rest day, recovery done", `+${XP.restDay}`);
  row("Illness day", `+${XP.checkin} check-in only; streak protected`);
  row("Record", `+${XP.record}, at most ${XP.recordsPerDay} a day and ${XP.recordsPer7Days} in any 7 days, after ${XP.recordMinPriorExposures} prior exposures; never from extra sets or on a recovery day`);
  row("Weekly quest", `+${XP.weeklyObjective} per objective, +${XP.weeklyBothBonus} for both`);
  row("Rank Trial passed", `+${XP.rankTrial}, once per rank`);
  row("Imported v19 day with work", `+${XP.legacyTrainingDay} flat`);
  row("Extra sets, second sessions, training while ill or on a recovery day", "0 (records still saved)");
  row("Sets logged more than", `${XP.lateLoggingHours} h after the day ends earn nothing`);
  lines.push("");

  lines.push("**Reduced day**", "", `One set less per lift (never below ${REDUCED.minSetsPerLift}); cardio × ${REDUCED.cardioFactor}, rounded to ${REDUCED.cardioRoundMinutes} min.`, "");

  lines.push("**Levels**", "", `XP from level L to L+1 is ${LEVELS.perLevel} × L (cumulative ${LEVELS.perLevel / 2} × L × (L−1)), capped at ${LEVELS.max}.`, "",
    "| Level | Total XP |", "|---|---|");
  for (const L of [2, 5, 10, 22, 35, 50, 99]) row(String(L), xpToReachLevel(L).toLocaleString("en-US"));
  lines.push("");

  lines.push("**Streak and shields**", "", `A kept day is a cleared training quest, a scheduled rest day or a cleared recovery day. A shield is earned every ${STREAK.shieldEveryKeptDays} kept days in a row (${STREAK.maxShields} at most) and is spent automatically on a missed day. Illness and paused days are protected and share an allowance of ${STREAK.pauseAllowanceDays} days per ${STREAK.pauseWindowDays}. Missing a day never costs XP, level or rank.`, "");

  lines.push("**Ranks**", "", "| Rank | Title | Level | Qualifying weeks | STR or END | VIT | Rank Trial |", "|---|---|---|---|---|---|---|");
  for (const r of RANKS) {
    const weeks = r.minKeptDays !== undefined ? `${r.minKeptDays} kept days` : String(r.minQualifyingWeeks);
    row(r.rank, r.title, String(r.minLevel), weeks, String(r.minStrOrEnd), String(r.minVit), r.trial ? "yes" : "no");
  }
  lines.push("", `A Rank Trial is sub-maximal: ${TRIAL.reps} reps at ${Math.round(TRIAL.loadRatio * 100)}% of your best estimated max (loaded lifts), reps at ${Math.round(TRIAL.bodyweightRatio * 100)}% of your best set plus a plank capped at ${TRIAL.plankCapSeconds} s (bodyweight), or ${TRIAL.cardioMinutes} continuous minutes (cardio). At most one every ${TRIAL.minDaysBetween} days, on a full-condition day. The displayed rank never decreases.`, "");

  lines.push("**Stats (0–100)**", "",
    `- **STR**: best estimated max per strength group over ${STATS.str.windowDays} days, as a share of bodyweight, against elite ratios of squat ${STATS.str.elite.squat}, hinge ${STATS.str.elite.hinge}, push ${STATS.str.elite.push}, pull ${STATS.str.elite.pull}; the mean of the four groups.`,
    `- **END**: ${Math.round(STATS.end.weeklyWeight * 100)}% weekly cardio minutes (${STATS.end.weeklyMinutesFull}/week scores 100) + ${Math.round(STATS.end.longestWeight * 100)}% longest session (${STATS.end.longestMinutesFull} min scores 100).`,
    `- **VIT**: over ${STATS.vit.windowDays} days, ${STATS.vit.checkinWeight} × check-in rate + ${STATS.vit.sleepWeight} × sleep score + ${STATS.vit.restWeight} × honoured rest. Calibrating for the first ${STATS.vit.calibratingDays} days.`,
    `- A change within ±${STATS.steadyBand} of the value 28 days ago reads as steady; drops are shown neutrally.`, "");

  lines.push("**Titles**", "", `${TITLE_COUNT} titles: one per rank above E and one per achievement.`, "", "| Achievement | Requirement | XP |", "|---|---|---|");
  for (const a of ACHIEVEMENTS) row(a.title, a.description, `+${a.xp}`);
  return lines.join("\n");
}

/** Replace the block between the markers; the markers stay. */
export function spliceRules(readme: string, rules: string): string {
  const start = readme.indexOf(RULES_START);
  const end = readme.indexOf(RULES_END);
  if (start === -1 || end === -1 || end < start) throw new Error(`README is missing the ${RULES_START} … ${RULES_END} markers.`);
  return `${readme.slice(0, start + RULES_START.length)}\n${rules}\n${readme.slice(end)}`;
}
