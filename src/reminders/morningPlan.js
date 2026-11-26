// src/reminders/morningPlan.js
// The words of the morning reminder for the days ahead: what the plan has
// that day, read the way Today will read it (race plan and moved days
// included). The phone repeats each morning's reminder weekly on its
// weekday, and the app writes them again whenever it opens or the plan
// changes (./useMorningPlan.js), so each one carries the coming day's plan.
import { DEFAULT_PROGRAM, getDayName } from "../constants";
import { getProgramSessions } from "../programSessions";
import { applyRaceBuild } from "../raceBuild";
import { cardioPart } from "../widgets/widgetCards";

export const DEFAULT_MORNING_TIME = "06:30";
/** Today and the next seven days, so every weekday has its next morning. */
export const PLAN_DAYS = 8;
const NAMED_LIFTS = 3;

/** "06:30" as { hour, minute }; anything unreadable is the default. */
export function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  return parseTime(DEFAULT_MORNING_TIME);
}

/** "6:30 am" for the switch's note. */
export function timeLabel(text) {
  const { hour, minute } = parseTime(text);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

function keyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shift(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return keyOf(date);
}

function liftNames(lifts) {
  const names = lifts.map((exercise) => String(exercise?.name || "").trim()).filter(Boolean);
  if (names.length <= NAMED_LIFTS) return names.join(", ");
  const more = names.length - NAMED_LIFTS;
  return `${names.slice(0, NAMED_LIFTS).join(", ")} and ${more} more`;
}

/** The reminder for one morning: { title, body }. */
export function morningText(program, dateKey) {
  const dayName = getDayName(new Date(`${dateKey}T12:00:00`));
  const live = applyRaceBuild(program || DEFAULT_PROGRAM, dateKey) || DEFAULT_PROGRAM;
  const day = live[dayName] || DEFAULT_PROGRAM[dayName] || {};
  const sessions = getProgramSessions(day);
  const lifts = sessions.flatMap((session) => session.lifting || []);
  const runs = sessions.map((session) => session.cardio).filter(Boolean);
  if (!lifts.length && !runs.length) {
    return { title: "Rest day", body: "Nothing is planned today." };
  }
  const name = day.type || (lifts.length ? "Lifting" : runs[0]?.type || "Training");
  const parts = [];
  if (lifts.length) parts.push(liftNames(lifts));
  for (const cardio of runs) parts.push(cardioPart(cardio));
  return { title: `Today: ${name}`, body: parts.filter(Boolean).join(" · ") };
}

/** The mornings from `todayKey` on, each { date, title, body }. */
export function planDays(program, { todayKey, days = PLAN_DAYS } = {}) {
  return Array.from({ length: days }, (_, index) => {
    const date = shift(todayKey, index);
    return { date, ...morningText(program, date) };
  });
}

/**
 * The next morning for each weekday from the saved days: each { weekday,
 * date, title, body }, where weekday counts as iOS does (1 is Sunday).
 * Today counts only while its time hasn't come yet.
 */
export function nextMornings(days, { time = DEFAULT_MORNING_TIME, now = new Date() } = {}) {
  const { hour, minute } = parseTime(time);
  const todayKey = keyOf(now);
  const passed = now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute;
  const byWeekday = new Map();
  for (const day of Array.isArray(days) ? days : []) {
    if (!day?.date || day.date < todayKey || (day.date === todayKey && passed)) continue;
    const weekday = new Date(`${day.date}T12:00:00`).getDay() + 1;
    const earlier = byWeekday.get(weekday);
    if (!earlier || day.date < earlier.date) byWeekday.set(weekday, { weekday, date: day.date, title: day.title, body: day.body });
  }
  return [...byWeekday.values()].sort((a, b) => a.date.localeCompare(b.date));
}
