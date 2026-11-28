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
import { bedtimeText } from "../oura/extrasView";

const PREFS_KEY = "ovt-local-reminders";
const PLAN_KEY = "ovt-morning-plan";
const SCHEDULED_KEY = "ovt-local-reminders-set";
const BEDTIME_KEY = "ovt-oura-bedtime";
// An old window says nothing about tonight.
const BEDTIME_DAYS = 7;
const OWNER_KEY = "ovt-reminder-owner-v2";
const scoped = (key, owner) => key + ":" + encodeURIComponent(owner);
let session;
let queue = Promise.resolve();

function enqueue(action) {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
}

async function clearPrevious(active) {
  if (active !== session || !active.clear) return;
  const result = await nativePlugin("OTReminders").set({ reminders: "[]", clearDelivered: true });
  if (result?.allowed !== true) throw new Error("The previous reminders could not be cleared.");
  if (active !== session) return;
  active.clear = false;
  try {
    // An older shell can clear pending requests only. Leave the marker unset
    // so the first launch after an Xcode upgrade also clears delivered alerts.
    if (result.deliveredCleared) localStorage.setItem(OWNER_KEY, JSON.stringify(active.owner));
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* Clear again on cold start. */ }
}

// The OS has one notification queue for the whole device. Invalidate the old
// writer synchronously; order cleanup after any in-flight native operation.
export function setReminderOwner(owner) {
  if (!hasLocalReminders()) return Promise.resolve();
  owner = owner || null;
  if (!session || session.owner !== owner) {
    let clear = true;
    try {
      const marker = localStorage.getItem(OWNER_KEY);
      clear = Boolean(session) || marker !== JSON.stringify(owner);
      const previous = session ? session.owner : JSON.parse(marker || "null");
      if (typeof previous === "string" && previous !== owner) {
        localStorage.removeItem(scoped(PLAN_KEY, previous));
        localStorage.removeItem(scoped(BEDTIME_KEY, previous));
      }
      for (const key of [PREFS_KEY, PLAN_KEY, BEDTIME_KEY, SCHEDULED_KEY]) {
        if (localStorage.getItem(key) !== null) {
          clear = true;
          localStorage.removeItem(key);
        }
      }
    } catch { /* Unattributed reminders must still be cancelled. */ }
    session = { owner, clear, scheduled: null };
  }
  const active = session;
  return enqueue(() => clearPrevious(active));
}

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

export function readReminderPrefs(owner) {
  if (!owner) return { ...OFF };
  try {
    const saved = JSON.parse(localStorage.getItem(scoped(PREFS_KEY, owner)) || "{}");
    const switches = Object.fromEntries(LOCAL_REMINDERS.map(({ id }) => [id, saved?.[id] === true]));
    const { hour, minute } = parseTime(saved?.morningTime);
    return { ...switches, morningTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
  } catch {
    return { ...OFF };
  }
}

export function writeReminderPrefs(prefs, owner) {
  if (!owner) return;
  try { localStorage.setItem(scoped(PREFS_KEY, owner), JSON.stringify(prefs)); } catch { /* scheduled, just not remembered */ }
}

/** What the switch says under its name. */
export function reminderNote(reminder, prefs) {
  return reminder.plan ? `Each morning at ${timeLabel(prefs?.morningTime)}, with the day’s training.` : reminder.note;
}

/** Keeps the mornings ahead (./morningPlan.js planDays) for scheduling. */
export function rememberMorningPlan(days, owner) {
  if (!owner || session?.owner !== owner) return;
  try { localStorage.setItem(scoped(PLAN_KEY, owner), JSON.stringify(days || [])); } catch { /* the last plan stays */ }
}

export function readMorningPlan(owner) {
  if (!owner) return [];
  try {
    const days = JSON.parse(localStorage.getItem(scoped(PLAN_KEY, owner)) || "[]");
    return Array.isArray(days) ? days : [];
  } catch {
    return [];
  }
}

/**
 * Keeps Oura's bedtime window (src/oura/extras.js) for the evening
 * check-in's words, and sends the phone the new words when it changed.
 */
export function rememberBedtime(bedtime, { owner, now = new Date() } = {}) {
  if (!owner || session?.owner !== owner || !hasLocalReminders()) return;
  const text = bedtimeText(bedtime);
  let before = "";
  try { before = JSON.parse(localStorage.getItem(scoped(BEDTIME_KEY, owner)) || "null")?.text || ""; } catch { /* nothing kept */ }
  try {
    if (text) localStorage.setItem(scoped(BEDTIME_KEY, owner), JSON.stringify({ text, at: now.getTime() }));
    else localStorage.removeItem(scoped(BEDTIME_KEY, owner));
  } catch { return; }
  if (text === before) return;
  if (readReminderPrefs(owner).checkin) applyReminderPrefs(null, { owner, onlyIfChanged: true, now }).catch(() => {});
}

function bedtimeLine(now, owner) {
  if (!owner) return "";
  try {
    const saved = JSON.parse(localStorage.getItem(scoped(BEDTIME_KEY, owner)) || "null");
    if (!saved?.text || !Number.isFinite(saved.at) || now.getTime() - Number(saved.at) > BEDTIME_DAYS * 24 * 60 * 60 * 1000) return "";
    return ` Bedtime tonight: ${saved.text}, Oura’s window for you.`;
  } catch {
    return "";
  }
}

/** What the phone is asked to schedule for these switches. */
export function remindersFor(prefs, { owner, days = readMorningPlan(owner), now = new Date() } = {}) {
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
    const { id, title, hour, minute, weekday } = reminder;
    const body = reminder.id === "checkin" ? `${reminder.body}${bedtimeLine(now, owner)}` : reminder.body;
    reminders.push({ id, title, body, hour, minute, ...(weekday ? { weekday } : {}) });
  }
  return reminders;
}

/**
 * Replaces what the phone has scheduled. Resolves { allowed }: false when
 * iOS doesn't allow the app's notifications. With onlyIfChanged, nothing is
 * sent when the phone already has exactly these.
 */
export function applyReminderPrefs(prefs, { owner, onlyIfChanged = false, savePrefs = false, now = new Date() } = {}) {
  const active = session;
  return enqueue(async () => {
    const plugin = nativePlugin("OTReminders");
    if (!plugin || !owner || active !== session || active?.owner !== owner) return { allowed: false, stale: true };
    await clearPrevious(active);
    if (active !== session) return { allowed: false, stale: true };
    const desired = prefs || readReminderPrefs(owner);
    const reminders = JSON.stringify(remindersFor(desired, { owner, now }));
    if (onlyIfChanged && reminders === active.scheduled) return { allowed: true, unchanged: true };
    active.scheduled = null;
    const result = await plugin.set({ reminders });
    if (active !== session) return { allowed: false, stale: true };
    const allowed = result?.allowed === true;
    active.scheduled = allowed ? reminders : null;
    const previous = readReminderPrefs(owner);
    const onlyTurningOff = previous.morningTime === desired.morningTime &&
      LOCAL_REMINDERS.some(({id}) => previous[id] && !desired[id]) &&
      LOCAL_REMINDERS.every(({id}) => !desired[id] || previous[id]);
    const saved = savePrefs && (allowed || onlyTurningOff);
    if (saved) writeReminderPrefs(desired, owner);
    return { allowed, saved };
  });
}
