// src/sections/OuraSignals.jsx
// What Oura measures beyond sleep and readiness (src/oura/extras.js):
// daytime stress on Today, which also fills an unanswered check-in stress;
// tonight's bedtime window on Today in the evening; and in Recovery,
// resilience over two weeks and how the mornings after your Oura tags
// compare with the rest. Each renders nothing until Oura has something.

import { useEffect, useState } from "react";
import { loadOuraExtras, loadOuraTags, forgetOuraExtras } from "../oura/extras";
import { bedtimeText, checkinStress, effectText, resilienceView, stressSentence, tagEffects } from "../oura/extrasView";
import { rememberBedtime } from "../reminders/localReminders";
import { getOuraAuthUrl } from "../oura/auth";

const EVENING_HOUR = 16;
const LEVEL_WORD = { limited: "Limited", adequate: "Adequate", solid: "Solid", strong: "Strong", exceptional: "Exceptional" };

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

function ResilienceCard({ extras }) {
  const view = resilienceView(extras?.resilience);
  if (!view) return null;
  const { latest, days } = view;
  return (
    <section aria-labelledby="resilience-title" data-testid="oura-resilience" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sec"><h2 id="resilience-title" className="t-h">Resilience</h2><span className="t-s c2">Oura, last {days.length} days</span></div>
      <p className="n-md">{LEVEL_WORD[latest.level]}</p>
      <div role="img" aria-label={`Resilience by day: ${days.map((day) => LEVEL_WORD[day.level].toLowerCase()).join(", ")}.`} style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 32 }}>
        {days.map((day) => (
          <div key={day.day} style={{ flex: 1, height: `${(day.rank / 5) * 100}%`, background: day.level === "limited" ? "var(--stop)" : "var(--ink)", borderRadius: 1 }} />
        ))}
      </div>
      {[latest.sleepRecovery, latest.daytimeRecovery, latest.stress].some((value) => value != null) && (
        <p className="t-s c2">Out of 100: sleep recovery {latest.sleepRecovery ?? "—"}, daytime recovery {latest.daytimeRecovery ?? "—"}, stress {latest.stress ?? "—"}.</p>
      )}
      {view.lighterWeek && (
        <p className="banner" role="status">Limited {view.limitedStreak} days running. A lighter week usually lets it build back.</p>
      )}
    </section>
  );
}

function TagsCard({ tags }) {
  const [opening, setOpening] = useState(false);
  if (!tags) return null;
  const reconnect = async () => {
    setOpening(true);
    forgetOuraExtras();
    const url = await getOuraAuthUrl().catch(() => null);
    if (url) window.location.href = url;
    else setOpening(false);
  };
  const { effects, few, needed } = tagEffects(tags);
  return (
    <section aria-labelledby="tags-title" data-testid="oura-tags" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 id="tags-title" className="t-h">After your Oura tags</h2>
      {tags.needsReconnect ? (
        <>
          <p className="t-s c2">Oura shares tags only with your permission. Reconnect once to see how your mornings go after sauna, alcohol or anything else you tag.</p>
          <button type="button" className="btn btn-s btn-sm" onClick={reconnect} disabled={opening} style={{ alignSelf: "flex-start" }}>{opening ? "Opening Oura…" : "Reconnect Oura"}</button>
        </>
      ) : effects.length === 0 && few.length === 0 ? (
        <p className="t-s c2">No tags in the last {tags.days || 90} days. Tag sauna, alcohol or a late meal in the Oura app, and this compares the mornings after.</p>
      ) : (
        <>
          {effects.length > 0 && (
            <ul className="rows">
              {effects.map((effect) => (
                <li key={effect.label} className="row" style={{ minHeight: 56 }}>
                  <span className="kv grow"><span className="t-bs">{effect.label}</span><span className="t-s c2">{effect.nights} mornings after: {effectText(effect)}</span></span>
                </li>
              ))}
            </ul>
          )}
          {few.length > 0 && <p className="t-s c2">Too few mornings yet for {few.map((tag) => `${tag.label.toLowerCase()} (${tag.nights})`).join(", ")}. Each needs {needed}.</p>}
          <p className="t-s c2">Against your other mornings over the last {tags.days || 90} days. It shows what tends to follow a tag, not what causes it.</p>
        </>
      )}
    </section>
  );
}

/** Recovery: resilience and tags, when Oura is connected. */
export function OuraRecoveryExtras({ enabled }) {
  const extras = useLoaded(loadOuraExtras, enabled);
  const tags = useLoaded(loadOuraTags, enabled);
  if (!extras && !tags) return null;
  return (
    <>
      <ResilienceCard extras={extras} />
      <TagsCard tags={tags} />
    </>
  );
}

export default OuraRecoveryExtras;
