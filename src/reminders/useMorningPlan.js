// src/reminders/useMorningPlan.js
// In iPhone app builds that schedule their own reminders: keeps the coming
// mornings' plan (./morningPlan.js) on the phone, and when the morning
// reminder is on, sends the phone new words whenever the plan or the day
// changes them. In a browser it does nothing.

import { useEffect } from "react";
import { getTodayKey } from "../constants";
import { nativePlugin } from "../native";
import { applyReminderPrefs, readReminderPrefs, rememberMorningPlan } from "./localReminders";
import { planDays } from "./morningPlan";

const SEND_DELAY_MS = 1200;

// `ready`: the account's own program is loaded, so the mornings are real.
export function useMorningPlan({ ready, program }) {
  const native = Boolean(nativePlugin("OTReminders"));
  const todayKey = getTodayKey();

  useEffect(() => {
    if (!native || !ready) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        rememberMorningPlan(planDays(program, { todayKey }));
        const prefs = readReminderPrefs();
        if (prefs.morning) await applyReminderPrefs(prefs, { onlyIfChanged: true });
      } catch {
        // What the phone already has stays scheduled.
      }
    }, SEND_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [native, ready, program, todayKey]);
}

export default useMorningPlan;
