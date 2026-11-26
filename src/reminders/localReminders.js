// src/reminders/localReminders.js
// The Courier's fixed-time sends, scheduled by the iPhone app itself
// (ios/App/App/RemindersPlugin.swift), because the web's push notifications
// don't reach the app: the evening check-in and the Sunday Edition. The words
// and times are the server's (netlify/functions/push-reminders.js and
// edition-courier.js). They're kept on this phone and off until turned on.
// The Morning Edition and state changes wait on data reaching the server,
// so they stay push-only.

import { nativePlugin } from "../native";

const PREFS_KEY = "ovt-local-reminders";

export const LOCAL_REMINDERS = [
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

const OFF = Object.fromEntries(LOCAL_REMINDERS.map((reminder) => [reminder.id, false]));

/** This app build can schedule its own reminders. */
export function hasLocalReminders() {
  return Boolean(nativePlugin("OTReminders"));
}

export function readReminderPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return Object.fromEntries(LOCAL_REMINDERS.map(({ id }) => [id, saved?.[id] === true]));
  } catch {
    return { ...OFF };
  }
}

export function writeReminderPrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* scheduled, just not remembered */ }
}

/** What the phone is asked to schedule for these switches. */
export function remindersFor(prefs) {
  return LOCAL_REMINDERS
    .filter(({ id }) => prefs?.[id] === true)
    .map(({ id, title, body, hour, minute, weekday }) => ({ id, title, body, hour, minute, ...(weekday ? { weekday } : {}) }));
}

/**
 * Replaces what the phone has scheduled. Resolves { allowed }: false when
 * iOS doesn't allow the app's notifications.
 */
export async function applyReminderPrefs(prefs) {
  const plugin = nativePlugin("OTReminders");
  if (!plugin) return { allowed: false };
  const result = await plugin.set({ reminders: JSON.stringify(remindersFor(prefs)) });
  return { allowed: result?.allowed !== false };
}
