// src/tomorrowLine.js
// Tomorrow's plan in one line for Today, so there's time to get ready: the
// day's lifting and any run, or a rest day. It reads the program the way
// tomorrow's Today will, race plan included.

import { DEFAULT_PROGRAM, getDayName } from "./constants";
import { getProgramSessions } from "./programSessions";
import { applyRaceBuild } from "./raceBuild";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cardioPart(cardio) {
  const minutes = Number(cardio?.minutes);
  const miles = Number(cardio?.miles);
  const amount = minutes > 0 ? `${Math.round(minutes)} min` : miles > 0 ? `${Math.round(miles * 10) / 10} mi` : "";
  return [cardio?.type || "Cardio", amount].filter(Boolean).join(", ");
}

/** "Tomorrow: Upper B — Pull + Biceps, 6 exercises · Easy Run, 30 min", or null. */
export function tomorrowSummary(program, todayKey) {
  if (!DATE_KEY.test(todayKey || "")) return null;
  const key = nextDay(todayKey);
  const dayName = getDayName(new Date(`${key}T12:00:00`));
  const live = applyRaceBuild(program, key) || DEFAULT_PROGRAM;
  const day = live[dayName] || DEFAULT_PROGRAM[dayName];
  const sessions = getProgramSessions(day);
  const lifts = sessions.reduce((count, session) => count + (session.lifting?.length || 0), 0);
  const parts = [];
  if (lifts > 0) parts.push(`${day.type || "Lifting"}, ${lifts} ${lifts === 1 ? "exercise" : "exercises"}`);
  for (const session of sessions) {
    if (session.cardio) parts.push(cardioPart(session.cardio));
  }
  return parts.length ? `Tomorrow: ${parts.join(" · ")}` : "Tomorrow: rest day";
}
