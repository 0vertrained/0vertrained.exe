// src/sections/StravaCardioRow.jsx
// Strava → cardio ledger suggestion.
//
// When the displayed day has Strava activity but no manually logged cardio,
// this renders one quiet ruled row: what was recorded, a single "Use for
// today" action, a dismiss, and the Strava deep link the API Agreement
// requires. UX contract:
//   · Provisional until confirmed — dotted ProvisionalTag, dim ink. The run
//     already counts toward training load (the work happened); confirming is
//     what marks it as plan-followed, keeping "did I follow the plan" the
//     athlete's statement rather than an import's.
//   · One tap fills miles + time via the existing updateToday write path;
//     pace derives from the existing autofill effect. No new persistence.
//   · Editing after confirm is just editing manual fields — provenance flips.
//   · Dismiss is per-day, remembered locally, and never nags again.
//   · Disappears on its own the moment manual cardio exists.
// Ghost-weight actions only: Today's single filled CTA stays the hero's.

import { useState } from "react";
import { useTheme } from "../theme";
import { ProvisionalTag } from "../ui/primitives";
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
  const { C, S } = useTheme();
  const mono = C.monoFamily;
  const serif = C.serifFamily;
  const [dismissed, setDismissed] = useState(() => isStravaSuggestionDismissed(dateKey));

  const fill = buildCardioFillFromActivities(activities);
  if (!fill || dismissed || hasManualCardio(cardio, cardioSessions)) return null;

  const primary = (activities || []).find((a) => a.kind === "run") || activities[0];
  const summaryBits = [
    fill.miles ? `${fill.miles} mi` : null,
    fill.time || null,
    primary?.paceSecPerMile ? `${Math.floor(primary.paceSecPerMile / 60)}:${String(primary.paceSecPerMile % 60).padStart(2, "0")} /mi` : null,
  ].filter(Boolean).join(" · ");
  const titleLine = fill.count === 1 ? (fill.titles[0] || primary?.sport || "Activity") : `${fill.count} activities`;

  const ghostBtn = {
    background: "none",
    border: `1px solid ${C.lineBright}`,
    color: C.text,
    fontFamily: mono,
    fontSize: 10.5,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    padding: "9px 12px",
    minHeight: 36,
    cursor: "pointer",
  };

  return (
    <section aria-label="Strava activity available to log" style={{ ...S.block, background: C.panel }}>
      <div style={{ ...S.blockHead, marginBottom: 8 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span style={S.sourceTag}>STRAVA</span>
          <ProvisionalTag>Not counted yet</ProvisionalTag>
        </span>
        <a
          href={stravaActivityUrl(primary)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...S.blockStat, color: C.textDim, textDecoration: "none" }}
        >
          View on Strava →
        </a>
      </div>
      <div style={{ fontFamily: serif, fontSize: 19, fontWeight: 500, letterSpacing: "-0.02em", color: C.text, lineHeight: 1.15 }}>
        {dayLabel ? `${dayLabel} · ${summaryBits || titleLine}` : (summaryBits || titleLine)}
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, letterSpacing: "0.03em", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {titleLine} · recorded on Strava — {isToday ? "log it as today's cardio?" : `log it for ${dayLabel?.toLowerCase() || "this day"}?`}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" style={ghostBtn} onClick={() => onApply && onApply(fill)}>
          {isToday ? "Use for today" : dayLabel === "Yesterday" ? "Use for yesterday" : "Use for this day"}
        </button>
        <button
          type="button"
          style={{ ...ghostBtn, border: "1px solid transparent", color: C.textFaint }}
          onClick={() => { rememberDismiss(dateKey); setDismissed(true); }}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
