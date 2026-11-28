// src/reminders/useMorningPlan.js
// In iPhone app builds that schedule their own reminders: keeps the coming
// mornings' plan (./morningPlan.js) on the phone, and when the morning
// reminder is on, sends the phone new words whenever the plan or the day
// changes them. In a browser it does nothing.

import { useEffect } from "react";
import { getTodayKey } from "../constants";
import { nativePlugin } from "../native";
import { applyReminderPrefs, rememberMorningPlan, setReminderOwner } from "./localReminders";
import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { planDays } from "./morningPlan";

const SEND_DELAY_MS = 1200;

// `ready`: the account's own program is loaded, so the mornings are real.
export function useMorningPlan({ owner, authReady, ready, program }) {
  const native = Boolean(nativePlugin("OTReminders"));
  const todayKey = getTodayKey();

  useEffect(() => {
    if (!native || !authReady) return;
    const reconcile = () => { void setReminderOwner(owner).catch(() => {}); };
    reconcile();
    window.addEventListener(APP_FOREGROUND_EVENT, reconcile);
    return () => window.removeEventListener(APP_FOREGROUND_EVENT, reconcile);
  }, [native, authReady, owner]);

  useEffect(() => {
    if (!native || !authReady || !ready || !owner) return;
    const refresh = force => {
      rememberMorningPlan(planDays(program, { todayKey: getTodayKey() }), owner);
      void applyReminderPrefs(null, { owner, onlyIfChanged: !force }).catch(() => {});
    };
    const timer = setTimeout(() => refresh(false), SEND_DELAY_MS);
    const resume = () => refresh(true);
    window.addEventListener(APP_FOREGROUND_EVENT, resume);
    return () => { clearTimeout(timer); window.removeEventListener(APP_FOREGROUND_EVENT, resume); };
  }, [owner, native, authReady, ready, program, todayKey]);
}

export default useMorningPlan;
