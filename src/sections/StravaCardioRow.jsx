// src/sections/StravaCardioRow.jsx
// Strava → cardio ledger suggestion.
//
// When the displayed day has Strava activity but no manually logged cardio,
// this renders one note in Today's plan: what was recorded, a single "Use
// for today" action, a dismiss, and the Strava deep link the API Agreement
// requires. UX contract:
//   · Provisional until confirmed, and labelled "not counted yet". The run
//     already counts toward training load (the work happened); confirming is
//     what marks it as plan-followed, keeping "did I follow the plan" the
//     athlete's statement rather than an import's.
//   · One tap fills miles + time via the existing updateToday write path;
//     pace derives from the existing autofill effect. Local activity references retain the import identity.
//   · Editing after confirm is just editing manual fields — provenance flips.
//   · Dismiss is per-day, remembered locally, and never nags again.
//   · Disappears on its own the moment manual cardio exists.
// Quiet actions only: Today's one filled button stays the call's.

import { useState } from "react";
import { stravaActivityUrl } from "../strava/dataLoading";

const DISMISS_PREFIX = "ovt-strava-suggest-dismissed:";

export function isStravaSuggestionDismissed(dateKey) {
  try { return localStorage.getItem(`${DISMISS_PREFIX}${dateKey}`) === "1"; } catch { return false; }
}

function rememberDismiss(dateKey) {
  try { localStorage.setItem(`${DISMISS_PREFIX}${dateKey}`, "1"); } catch { /* private mode — session-only dismiss */ }
}

export function formatMinutesAsTime(totalMinutes) {
  const totalSec = Math.round((Number(totalMinutes) || 0) * 60);
  if (totalSec <= 0) return "";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Build the fields a confirm writes. Runs sum together; if the day has no
// runs, all moving activities sum (a ride day still fills time honestly).
export function buildCardioFillFromActivities(activities) {
  const acts = Array.isArray(activities) ? activities.filter(Boolean) : [];
  if (!acts.length) return null;
  const runs = acts.filter((a) => a.kind === "run" && (a.miles > 0 || a.minutes > 0));
  const used = runs.length ? runs : acts;
  const miles = Math.round(used.reduce((sum, a) => sum + (Number(a.miles) || 0), 0) * 100) / 100;
  const minutes = used.reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
  if (!(miles > 0) && !(minutes > 0)) return null;
  return {
    miles: miles > 0 ? String(miles) : "",
    time: formatMinutesAsTime(minutes),
    // Keep identity and timing locally alongside the fill so overlapping
    // recordings from other services can be reconciled after confirmation.
    activityRefs: used.map(a => ({ source: "strava", id: a.stravaId || a.id, startTime: a.startTime,
      kind: a.kind === "other" ? null : a.kind, minutes: a.minutes, miles: a.miles })),
    count: used.length,
    titles: used.map((a) => a.title).filter(Boolean),
  };
}

export function hasManualCardio(cardio, cardioSessions) {
  if ((parseFloat(cardio?.miles) || 0) > 0) return true;
  if (String(cardio?.time || "").trim() !== "") return true;
  return Object.values(cardioSessions || {}).some(
    (c) => (parseFloat(c?.miles) || 0) > 0 || String(c?.time || "").trim() !== ""
  );
}

export function StravaCardioRow({ activities, cardio, cardioSessions, dateKey, dayLabel, isToday = true, onApply }) {
  const [dismissed, setDismissed] = useState(() => isStravaSuggestionDismissed(dateKey));

  const fill = buildCardioFillFromActivities(activities);
  if (!fill || dismissed || hasManualCardio(cardio, cardioSessions)) return null;

  const primary = (activities || []).find((a) => a.kind === "run") || activities[0];
  const titleLine = fill.count === 1 ? (fill.titles[0] || primary?.sport || "Activity") : `${fill.count} activities`;
  const summary = [
    titleLine,
    fill.miles ? `${fill.miles}\u00a0mi` : null,
    fill.time || null,
    primary?.paceSecPerMile ? `${Math.floor(primary.paceSecPerMile / 60)}:${String(primary.paceSecPerMile % 60).padStart(2, "0")}\u00a0min/mi` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="banner" aria-label="Strava activity available to log" style={{ flexDirection: "column", gap: 8 }}>
      <p><span className="t-ss">From Strava · not counted yet</span><br /><span className="n-s">{dayLabel ? `${dayLabel} · ${summary}` : summary}</span></p>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn btn-s btn-sm" onClick={() => onApply && onApply(fill)}>
          {isToday ? "Use for today" : dayLabel === "Yesterday" ? "Use for yesterday" : "Use for this day"}
        </button>
        <button type="button" className="btn btn-g btn-sm" onClick={() => { rememberDismiss(dateKey); setDismissed(true); }}>Dismiss</button>
        <a className="t-s u" href={stravaActivityUrl(primary)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: "auto", minHeight: 44, display: "flex", alignItems: "center" }}>View on Strava<span className="sr"> (opens in a new tab)</span></a>
      </div>
    </section>
  );
}
