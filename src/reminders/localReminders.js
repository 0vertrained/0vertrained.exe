// src/reminders/localReminders.js
// Reminders the iPhone app schedules itself (ios/App/App/RemindersPlugin.swift),
// because the web's push notifications don't reach the app: the day's plan
// each morning, the evening check-in and the Sunday Edition. The check-in
// and Edition words and times are the server's (netlify/functions/
// push-reminders.js and edition-courier.js); the morning's words come from
// the plan (./morningPlan.js). They're kept on this phone and off until
// turned on. The Morning Edition and state changes wait on data reaching
// the server, so they stay push-only.

import { nativePlugin } from "../native";
import { DEFAULT_MORNING_TIME, nextMornings, parseTime, timeLabel } from "./morningPlan";

const PREFS_KEY = "ovt-local-reminders";
const PLAN_KEY = "ovt-morning-plan";
const SCHEDULED_KEY = "ovt-local-reminders-set";

export const LOCAL_REMINDERS = [
  {
    id: "morning",
    label: "Today’s plan",
    // The note carries the chosen time; see reminderNote.
    note: "Each morning, with the day’s training.",
    plan: true,
  },
  {
    id: "checkin",
    label: "Evening check-in",
    note: "Every evening at 7:30.",
    title: "Evening check-in",
    body: "Log sleep, energy, and soreness — tomorrow's call depends on tonight's data.",
    hour: 19,
    minute: 30,
  },
  {
    id: "sunday",
    label: "The Sunday Edition",
    note: "Sundays at 5 pm.",
    title: "The Sunday Edition is out",
    body: "Your week, one page — and the one change for the next.",
    // Sunday, as iOS counts weekdays.
    weekday: 1,
    hour: 17,
    minute: 0,
  },
];

const OFF = { ...Object.fromEntries(LOCAL_REMINDERS.map((reminder) => [reminder.id, false])), morningTime: DEFAULT_MORNING_TIME };

/** This app build can schedule its own reminders. */
export function hasLocalReminders() {
  return Boolean(nativePlugin("OTReminders"));
}

export function readReminderPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const switches = Object.fromEntries(LOCAL_REMINDERS.map(({ id }) => [id, saved?.[id] === true]));
    const { hour, minute } = parseTime(saved?.morningTime);
    return { ...switches, morningTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
  } catch {
    return { ...OFF };
  }
}

export function writeReminderPrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* scheduled, just not remembered */ }
}

/** What the switch says under its name. */
export function reminderNote(reminder, prefs) {
  return reminder.plan ? `Each morning at ${timeLabel(prefs?.morningTime)}, with the day’s training.` : reminder.note;
}

/** Keeps the mornings ahead (./morningPlan.js planDays) for scheduling. */
export function rememberMorningPlan(days) {
  try { localStorage.setItem(PLAN_KEY, JSON.stringify(days || [])); } catch { /* the last plan stays */ }
}

export function readMorningPlan() {
  try {
    const days = JSON.parse(localStorage.getItem(PLAN_KEY) || "[]");
    return Array.isArray(days) ? days : [];
  } catch {
    return [];
  }
}

/** What the phone is asked to schedule for these switches. */
export function remindersFor(prefs, { days = readMorningPlan(), now = new Date() } = {}) {
  const reminders = [];
  for (const reminder of LOCAL_REMINDERS) {
    if (prefs?.[reminder.id] !== true) continue;
    if (reminder.plan) {
      const { hour, minute } = parseTime(prefs.morningTime);
      for (const morning of nextMornings(days, { time: prefs.morningTime, now })) {
        reminders.push({ id: `morning-${morning.weekday}`, title: morning.title, body: morning.body, hour, minute, weekday: morning.weekday });
      }
      continue;
    }
    const { id, title, body, hour, minute, weekday } = reminder;
    reminders.push({ id, title, body, hour, minute, ...(weekday ? { weekday } : {}) });
  }
  return reminders;
}

/**
 * Replaces what the phone has scheduled. Resolves { allowed }: false when
 * iOS doesn't allow the app's notifications. With onlyIfChanged, nothing is
 * sent when the phone already has exactly these.
 */
export async function applyReminderPrefs(prefs, { onlyIfChanged = false, now = new Date() } = {}) {
  const plugin = nativePlugin("OTReminders");
  if (!plugin) return { allowed: false };
  const reminders = JSON.stringify(remindersFor(prefs, { now }));
  let scheduled = "";
  try { scheduled = localStorage.getItem(SCHEDULED_KEY) || ""; } catch { /* sends again */ }
  if (onlyIfChanged && reminders === scheduled) return { allowed: true, unchanged: true };
  const result = await plugin.set({ reminders });
  try { localStorage.setItem(SCHEDULED_KEY, reminders); } catch { /* sends again next time */ }
  return { allowed: result?.allowed !== false };
}
