// src/sections/OuraSignals.jsx
// What Oura measures beyond sleep and readiness (src/oura/extras.js):
// daytime stress on Today, which also fills an unanswered check-in stress,
// and tonight's bedtime window on Today in the evening. Each renders
// nothing until Oura has something.

import { useEffect, useState } from "react";
import { loadOuraExtras } from "../oura/extras";
import { bedtimeText, checkinStress, stressSentence } from "../oura/extrasView";
import { rememberBedtime } from "../reminders/localReminders";

const EVENING_HOUR = 16;

function useLoaded(load, enabled) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    load().then((result) => { if (alive) setValue(result || null); }).catch(() => {});
    return () => { alive = false; };
  }, [load, enabled]);
  return enabled ? value : null;
}

/**
 * Today: yesterday's daytime stress and today's so far. With `fill`, an
 * unanswered check-in stress takes yesterday's (marked as from Oura).
 */
export function OuraStressLine({ enabled, todayKey, body, updateToday, fill = false }) {
  const extras = useLoaded(loadOuraExtras, enabled);
  const fillWith = fill && extras ? checkinStress(extras.stress, todayKey) : null;
  const answered = body?.stress !== undefined && body?.stress !== null && body?.stress !== "";

  useEffect(() => {
    if (fillWith == null || answered || typeof updateToday !== "function") return;
    updateToday("body.stress", String(fillWith));
    updateToday("body.stressFrom", "oura");
  }, [fillWith, answered, updateToday]);

  // Tonight's window goes into the evening check-in reminder too.
  useEffect(() => {
    if (extras) rememberBedtime(extras.bedtime || null);
  }, [extras]);

  const sentence = extras ? stressSentence(extras.stress, todayKey) : "";
  if (!sentence) return null;
  return (
    <div className="row" data-testid="oura-stress" style={{ borderTop: "1px solid var(--line)", paddingTop: 8, alignItems: "flex-start" }}>
      <span className="kv grow"><span className="t-bs">Daytime stress</span><span className="t-s c2">{sentence}</span></span>
      <span className="t-c c2">Oura</span>
    </div>
  );
}

/** Today, from 4 pm: Oura's bedtime window for tonight. */
export function OuraBedtimeLine({ enabled, now = new Date() }) {
  const extras = useLoaded(loadOuraExtras, enabled && now.getHours() >= EVENING_HOUR);
  const range = extras ? bedtimeText(extras.bedtime) : "";
  if (!range) return null;
  return <p className="t-s c2" data-testid="oura-bedtime" style={{ paddingTop: 4 }}>Bedtime tonight: {range}, Oura’s window for you.</p>;
}
