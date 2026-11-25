// src/RecoveryView.jsx
// Recovery as the athlete reads it: the call first, then why, the check-in,
// the week's trend, the drivers and the training load. Which wearable said
// what, the coach's longer read and the raw ledger wait behind their own
// rows. RecoveryDashboard loads and resolves everything; this file only shows
// it, so nothing here can change a score.

import { useState } from "react";
import { Icon, Meter, Sheet, Method } from "./ui/ledger";
import { LineChart, DataTable, dayDate } from "./sections/charts";
import { describeCall } from "./recovery/verdictResolver";
import { checkinEvidenceLine, divergenceNote, checkinSummaryLine } from "./checkinMorning";
import { buildMuscleRecency } from "./muscleVolume";
import { buildEmptyStateExplanation } from "./recovery/wearableSyncEvents";

const NBSP = "\u00a0";
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const sentence = (text) => (text ? `${String(text).charAt(0).toUpperCase()}${String(text).slice(1)}` : "");
const shown = (value, unit = "", digits = 0) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${digits > 0 ? Number(value).toFixed(digits) : Math.round(Number(value))}${unit}`;
};
const duration = (minutes) => {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return "—";
  const total = Math.round(Number(minutes));
  return `${Math.floor(total / 60)}${NBSP}h ${String(total % 60).padStart(2, "0")}${NBSP}min`;
};

// A row that opens what is under it.
function FoldRow({ title, sub, tag = null, children }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ minHeight: 60 }}>
        <span className="kv grow"><span className="t-bs">{title}</span><span className="t-s c2">{sub}</span></span>
        {tag && <span className="tag tag-f">{tag}</span>}
        <Icon name={open ? "up" : "down"} size="s" className="c2" />
      </button>
      {open && <div style={{ ...column(16), padding: "4px 0 20px" }}>{children}</div>}
    </li>
  );
}

// Label and value pairs, one to a line.
function Ledger({ title, rows, note = null }) {
  const kept = rows.filter((row) => row && row[1] !== null && row[1] !== undefined && row[1] !== "");
  if (kept.length === 0) return null;
  return (
    <div style={column(4)}>
      {title && <h3 className="t-ss">{title}</h3>}
      <ul className="rows">
        {kept.map(([label, value, flagged]) => (
          <li key={label} className="row" style={{ minHeight: 44, alignItems: "flex-start", paddingTop: 10, paddingBottom: 10, gap: 16 }}>
            <span className="t-s c2" style={{ flex: "0 0 38%" }}>{label}</span>
            <span className="t-s grow" style={{ textAlign: "right", fontWeight: flagged ? 600 : 400 }}>{value}</span>
          </li>
        ))}
      </ul>
      {note && <p className="t-s c2">{note}</p>}
    </div>
  );
}

function Notices({ refreshingLabel, demo }) {
  if (!refreshingLabel && !demo) return null;
  return (
    <div style={column(2)}>
      {refreshingLabel && <p className="t-s c2" role="status">{refreshingLabel}</p>}
      {demo && <p className="t-s c2">Sample data. Nothing here is read from or written to an account or a wearable.</p>}
    </div>
  );
}

function Alerts({ alerts, conflicts }) {
  const LABEL = { error: "Problem", warning: "Warning", caution: "Caution", positive: "Good sign" };
  return (
    <>
      {alerts.map((alert, index) => (
        <div key={`${alert.type}-${index}`} className="banner" role={alert.severity === "warning" || alert.severity === "error" ? "alert" : undefined} style={{ flexDirection: "column", gap: 4 }}>
          <p className="t-ss" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {alert.severity !== "positive" && <Icon name="warn" size="s" />}
            {LABEL[alert.severity] || "Caution"}: {String(alert.type || "signal").replace(/_/g, " ")}
          </p>
          <p>{alert.message}</p>
          {alert.recommendation && <p className="c2">{alert.recommendation}</p>}
          {alert.markers?.length > 0 && <p className="t-s c2">From: {alert.markers.map((marker) => String(marker).replace(/_/g, " ")).join(", ")}.</p>}
        </div>
      ))}
      {conflicts.length > 0 && (
        <div className="banner" style={{ flexDirection: "column", gap: 4 }}>
          <p className="t-ss" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="warn" size="s" />Your wearables disagree today</p>
          <p>Oura and Whoop differ on {conflicts.map((conflict) => String(conflict.metric).replace(/_/g, " ")).join(", ")}. Treat this as a conservative day rather than trusting either one outright.</p>
          <p className="c2">Lean on how you feel and the more cautious reading until they agree again. The detail is under Wearables.</p>
        </div>
      )}
    </>
  );
}

function CheckinBanner({ checkin, todayBody, onOpenCheckin }) {
  return (
    <section className="banner" aria-labelledby="rec-checkin" data-testid="checkin-line" style={{ flexDirection: "column", gap: 2 }}>
      <h2 id="rec-checkin" className="t-ss">Your check-in</h2>
      <p>{checkin.answered ? sentence(checkinSummaryLine(todayBody)) : "No check-in yet today."}</p>
      {typeof onOpenCheckin === "function" && (
        <button type="button" className="btn btn-g btn-sm" onClick={onOpenCheckin} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
          {checkin.complete ? "Edit on Today" : "Check in on Today"}
        </button>
      )}
    </section>
  );
}

// The call: one word, an effort level, the score, one sentence and the state
// of the last few days. Until the check-in is done it says so; it never waits.
function Call({ verdict, recovery, trend, checkin, todayKey, firstSync }) {
  const call = describeCall(verdict.call);
  const stateName = trend?.state?.name || null;
  const calibrating = trend?.state?.key === "calibrating";
  const provisional = Boolean(todayKey) && !checkin.complete;
  const score = Number.isFinite(Number(recovery?.score)) ? Math.round(Number(recovery.score)) : null;
  const delta = trend?.delta?.label || "steady";
  const state = [
    stateName,
    !calibrating && score !== null ? (delta === "steady" ? "score steady" : `score ${delta} on the last 3 days`) : null,
    provisional ? "before check-in" : null,
    trend?.early && !calibrating ? "baseline forming" : null,
  ].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="rec-call" style={column(6)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Meter level={call.level} label={`Effort level ${call.level} of 5`} />
        <span className="stamp grow">{call.stamp}</span>
        <span className="n-lg">{score ?? "—"}</span><span className="t-s c2">/100</span>
      </div>
      <h2 id="rec-call" className="t-hl">{verdict.headline}</h2>
      {state && <p className={provisional || calibrating ? "t-ss c2" : "t-ss"}>{state}</p>}
      {recovery?.band === "insufficient_data" && (
        <p className="t-s c2">{firstSync
          ? "First sync running. Your history usually lands in under a minute. Your first call follows it, and the weekly trend appears after seven mornings."
          : "Not enough data yet: no wearable signals have been reported."}</p>
      )}
    </section>
  );
}

function Why({ verdict, trend, checkin, recovery, data, todayKey, todayPlan, changeSummary, provenance }) {
  const [explaining, setExplaining] = useState(false);
  const evidenceLines = [
    ...(trend?.evidence || []).slice(0, 2),
    ...(checkinEvidenceLine(checkin) ? [checkinEvidenceLine(checkin)] : []),
  ];
  const reasons = evidenceLines.length ? evidenceLines : [verdict.deck];
  // Flags raised by the alerts already stand as banners above the reasons.
  const flagged = changeSummary.hasFlags ? changeSummary.rows.filter((row) => row.key !== "alerts" && (row.tone === "warning" || row.tone === "caution")) : [];
  const diverge = divergenceNote(checkin, recovery?.score);
  const recency = todayKey ? buildMuscleRecency(data, todayKey) : null;
  const loaded = (recency || []).filter((muscle) => muscle.daysSinceAny !== null && muscle.daysSinceAny <= 1).slice(0, 3);
  const context = [
    todayPlan ? `Today: ${todayPlan}.` : null,
    loaded.length ? `Recently loaded: ${loaded.map((muscle) => `${muscle.label} (${muscle.daysSinceAny === 0 ? "today" : "1d"})`).join(", ")}.` : null,
  ].filter(Boolean).join(" ");
  const limiter = verdict.limiter;

  return (
    <section aria-labelledby="rec-why" style={column(8)}>
      <h2 id="rec-why" className="t-h">Why this call</h2>
      {limiter && (
        <p className="banner">
          <Icon name="warn" size="s" />
          <span><b>{sentence(String(limiter.label).replace(" · ", ": "))}.</b> {limiter.detail}</span>
        </p>
      )}
      <ul className="rows">
        {reasons.filter(Boolean).map((line) => <li key={line} className="row" style={{ minHeight: 44, paddingTop: 10, paddingBottom: 10 }}><span className="t-b grow">{line}</span></li>)}
        {flagged.map((row) => (
          <li key={row.key} className="row" style={{ minHeight: 44, paddingTop: 10, paddingBottom: 10 }}>
            <span className="t-b grow">{row.sentence || `${row.label}: ${row.value}`}</span>
            <span className={row.tone === "warning" ? "tag tag-x" : "tag"}>{row.tone === "warning" ? "Warning" : "Watch"}</span>
          </li>
        ))}
      </ul>
      {diverge && <p className="t-s">{diverge}</p>}
      {context && <p className="t-s c2">{context} These are likely limiters, not a diagnosis.</p>}
      {provenance && <p className="t-s c2">{provenance}</p>}
      {trend?.meaning && (
        <>
          <button type="button" className="btn btn-g btn-sm" aria-haspopup="dialog" onClick={() => setExplaining(true)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>What does this mean?</button>
          <Sheet open={explaining} title="What this call means" onClose={() => setExplaining(false)}>
            <div style={column(12)}>
              <div className="kv"><h3 className="t-ss">What</h3><p className="t-b">{trend.meaning.what}</p></div>
              <div className="kv"><h3 className="t-ss">Why</h3><p className="t-b">{trend.meaning.why}</p></div>
              <div className="kv"><h3 className="t-ss">Now</h3><p className="t-b">{trend.meaning.action}</p></div>
              <p className="t-s c2">“Your normal range” is the week’s HRV average measured against your own baseline of about four weeks, give or take half its usual variation. It is you against you, never a population chart. The check-in can lower a call and never raise it. The score itself is always pure physiology.</p>
            </div>
          </Sheet>
        </>
      )}
    </section>
  );
}

function Trend({ history, score }) {
  if (!history || history.length < 2) return null;
  const withAverage = history.length >= 4;
  const points = history.map((point, index, all) => {
    const window = all.slice(Math.max(0, index - 2), index + 1);
    return { date: point.date, value: Math.round(Number(point.value) || 0), also: withAverage ? Math.round(window.reduce((sum, item) => sum + (Number(item.value) || 0), 0) / window.length) : null };
  });
  const last = points[points.length - 1];
  const before = points[points.length - 2];
  const drift = withAverage ? (last.also > before.also ? "and rising" : last.also < before.also ? "and falling" : "and level") : "";
  return (
    <section aria-labelledby="rec-trend" style={column(8)}>
      <h2 id="rec-trend" className="t-h">Trend, {points.length}{NBSP}days</h2>
      <p className="t-s c2">Today is {score ?? last.value}.{withAverage ? ` The 3-day average is ${last.also} ${drift}.` : ""}</p>
      <LineChart
        label={`Line chart of recovery score for ${points.length} days, from ${points[0].value} to ${last.value}${withAverage ? `, with its 3-day average at ${last.also}` : ""}.`}
        points={points}
        second={withAverage}
        height={104}
      />
      {withAverage && (
        <p className="t-c c2" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><svg width="20" height="8" aria-hidden="true"><path d="M0 4h20" stroke="var(--ink)" strokeWidth="2" /></svg>Score</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><svg width="20" height="8" aria-hidden="true"><path d="M0 4h20" stroke="var(--s2)" strokeWidth="2" strokeDasharray="6 4" /></svg>3-day average</span>
        </p>
      )}
      <DataTable
        caption="Recovery score by day, newest first"
        head={withAverage ? ["Day", "Score", "3-day average"] : ["Day", "Score"]}
        rows={[...points].reverse().map((point) => (withAverage ? [dayDate(point.date), point.value, point.also] : [dayDate(point.date), point.value]))}
      />
    </section>
  );
}

// Last night's readings. The thresholds for the words are the ones the change
// summary already uses; the scoring sources are listed under Data trust.
function Drivers({ hrv, rhr, sleep, temp, rawMetrics, sleepDebt }) {
  const debt = Number(sleepDebt?.debtHours);
  const slept = String(rawMetrics.sleep || "").match(/([\d.]+)h slept/);
  const spaced = (text) => String(text || "").replace(/(\d)\s?(ms|bpm)\b/, `$1${NBSP}$2`);
  const items = [
    hrv && ["Heart rate variability (HRV)", spaced(rawMetrics.hrv) || "Not available",
      Number(hrv.zScore) >= 0.5 ? "Above your baseline" : Number(hrv.zScore) <= -1 ? "Well below your baseline" : Number(hrv.zScore) <= -0.5 ? "Below your baseline" : "Near your baseline"],
    rhr && ["Resting heart rate", spaced(rawMetrics.rhr) || "Not available",
      Number(rhr.delta) > 3 ? `${Number(rhr.delta).toFixed(1)}${NBSP}bpm above baseline` : Number(rhr.delta) <= -2 ? `${Math.abs(Number(rhr.delta)).toFixed(1)}${NBSP}bpm below baseline` : "Steady"],
    sleep && ["Sleep last night", slept ? `${slept[1]}${NBSP}h` : rawMetrics.sleep || "Not available",
      Number.isFinite(debt) ? `Debt ${debt.toFixed(1)}${NBSP}h over 7${NBSP}days` : ""],
    temp && ["Temperature, against your usual", String(rawMetrics.temp || "Not available").replace(" deviation", ""),
      temp.consecutiveNights > 0 ? `Raised for ${temp.consecutiveNights} night${temp.consecutiveNights === 1 ? "" : "s"} or more` : ""],
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="rec-drivers" style={column(10)}>
      <h2 id="rec-drivers" className="t-h">Drivers</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
        {items.map(([label, value, status]) => (
          <div key={label} className="kv">
            <span className="t-c c2">{label} · Oura</span>
            <span className="n-md">{value}</span>
            {status && <span className="t-s">{status}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Load({ trainingLoad, externalCardio, unloggedFlags }) {
  if (!trainingLoad || trainingLoad.rolling.zone === "insufficient_data") return null;
  const { rolling, zoneInfo } = trainingLoad;
  return (
    <section aria-labelledby="rec-load" style={column(10)}>
      <div className="sec"><h2 id="rec-load" className="t-h">Training load</h2><span className="tag tag-f">{zoneInfo.label}</span></div>
      <p className="t-s c2">{zoneInfo.description} The last 7{NBSP}days against the last 28 is {rolling.ratio}.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <div className="kv"><span className="t-c c2">Last 7{NBSP}days</span><span className="n-md">{rolling.acute}</span></div>
        <div className="kv"><span className="t-c c2">28-day average</span><span className="n-md">{rolling.chronic}</span></div>
        <div className="kv"><span className="t-c c2">Ratio</span><span className="n-md">{rolling.ratio}</span></div>
      </div>
      <p className="t-s">{zoneInfo.recommendation}</p>
      <p className="t-s c2">
        Trend: {String(rolling.trend || "steady").replace(/_/g, " ")}.
        {externalCardio && ` From Strava in the last 7 days: ${externalCardio.runMiles > 0 ? `${externalCardio.runMiles}${NBSP}mi, ` : ""}${externalCardio.minutes}${NBSP}min.`}
      </p>
      {unloggedFlags.length > 0 && (
        <p className="banner">
          <Icon name="info" size="s" />
          <span>{unloggedFlags.length} day{unloggedFlags.length === 1 ? "" : "s"} in the last 14 had load that was not logged ({unloggedFlags.map((flag) => `${flag.date.slice(5)}: ${flag.source === "strava" ? `${flag.miles}${NBSP}mi run on Strava` : `strain ${flag.strain}`}`).join(", ")}), so the ratio understates your true load. This is a flag only. Nothing is added for you.</span>
        </p>
      )}
      <Method
        testId="method-load"
        method="This week’s load against your own 28-day norm, counted in effort-minutes across lifting and cardio."
        detail={<p>Every session earns load from how hard and how long it was: a zone-2 hour counts like an easy hour, a heavy leg day like a heavy leg day (lifting by session effort, cardio by heart-rate zones, one shared currency). The acute:chronic ratio compares your last 7 days with your last 28. Around 1.0 means you are training at your norm. Well above about 1.3 means load is rising faster than your base can absorb. The label and the advice above come straight from that ratio, worked out only from your own history.</p>}
      />
    </section>
  );
}

function Whoop({ connected, summary, syncEvents }) {
  if (!connected) return null;
  if (!summary) {
    const explanation = buildEmptyStateExplanation({ events: syncEvents, source: "whoop", connected });
    return <Ledger title="From Whoop" rows={[[explanation.title, explanation.body, explanation.tone === "warning"]]} note="Shown for awareness only. It does not change the recovery score or the call." />;
  }
  const { recovery, sleep, cycle, workouts = [], date } = summary;
  const top = workouts.reduce((best, workout) => (best === null || Number(workout?.strain) > Number(best?.strain) ? workout : best), null);
  return (
    <Ledger
      title={`From Whoop${date ? `, ${date}` : ""}`}
      rows={[
        ["Recovery", !recovery ? "Not available yet" : recovery.calibrating || recovery.recoveryScore == null ? "Pending" : `${shown(recovery.recoveryScore)} of 100`],
        ["HRV (rmssd)", recovery ? shown(recovery.hrvRmssd, `${NBSP}ms`, 1) : null],
        ["Resting heart rate", recovery ? shown(recovery.rhr, `${NBSP}bpm`) : null],
        ["Blood oxygen", recovery ? shown(recovery.spo2, "%", 1) : null],
        ["Skin temperature", recovery ? shown(recovery.skinTempC, "°C", 1) : null],
        ["Asleep", sleep ? duration(sleep.asleepMin) : "Not available yet"],
        ["In bed", sleep ? duration(sleep.inBedMin) : null],
        ["Sleep efficiency", sleep ? shown(sleep.efficiencyPct, "%") : null],
        ["Breathing rate", sleep ? shown(sleep.respiratoryRate, `${NBSP}a minute`, 1) : null],
        ["Day strain", cycle ? shown(cycle.strain, "", 1) : "Not available yet"],
        ["Hardest workout strain", top ? shown(top.strain, "", 1) : null],
        ["Average heart rate", cycle || top ? shown(cycle?.avgHr ?? top?.avgHr, `${NBSP}bpm`) : null],
        ["Highest heart rate", cycle || top ? shown(cycle?.maxHr ?? top?.maxHr, `${NBSP}bpm`) : null],
      ]}
      note="Shown for awareness only. Whoop does not change the recovery score or the call."
    />
  );
}

function Wearables({ view }) {
  const { qa, blendExplanation, confidenceExplanation, aggregatedContext, whoop, connected, manualOn } = view;
  const on = [connected && "Oura", whoop.connected && "Whoop", manualOn && "Manual check-in"].filter(Boolean);
  return (
    <>
      <p className="t-s">Connected: {on.length ? on.join(", ") : "nothing yet"}.</p>
      {qa && (
        <div style={column(4)}>
          <h3 className="t-ss">{qa.title}</h3>
          <p className="t-s c2">{qa.body}</p>
          {qa.sources?.length > 0 && <Ledger rows={qa.sources.map((item) => [item.sourceLabel, item.title, item.tone === "warning" || item.tone === "caution"])} />}
          {qa.mixedSignal && <p className="t-s">Oura and Whoop are never averaged. The day’s read stays conservative.</p>}
          <p className="t-s c2">This explains what your wearables are showing. It never changes the recovery score.</p>
        </div>
      )}
      {blendExplanation?.available && (
        <Ledger
          title="Which source won each metric"
          rows={[
            ["Summary", blendExplanation.headline],
            ["Sources", blendExplanation.sourceLine],
            ["Confidence across sources", confidenceExplanation?.label, confidenceExplanation?.tone === "warning"],
            ["Why", confidenceExplanation?.reasons?.length ? confidenceExplanation.reasons.join("; ") : null],
            ["Whoop recovery", aggregatedContext?.whoopRecoveryContext?.note],
            ["Whoop strain", aggregatedContext?.whoopStrainContext && aggregatedContext.whoopStrainContext.level !== "normal" ? aggregatedContext.whoopStrainContext.note : null, aggregatedContext?.whoopStrainContext?.level === "high"],
            ["Note", blendExplanation.conservativeCopy, true],
          ]}
          note={blendExplanation.disclaimer}
        />
      )}
      {blendExplanation?.available && blendExplanation.points.length > 0 && (
        <ul className="lst">{blendExplanation.points.slice(0, 3).map((point) => <li key={point}>{point}</li>)}</ul>
      )}
      <Whoop connected={whoop.connected} summary={whoop.summary} syncEvents={whoop.syncEvents} />
    </>
  );
}

function CoachRead({ coach }) {
  return (
    <>
      {coach.cluster && <p className="t-bs">{coach.cluster}</p>}
      {coach.guidance && <p className="t-b">{coach.guidance}</p>}
      {coach.body && <p className="t-s c2">{coach.body}</p>}
      {coach.confidenceNote && <p className="t-s c2">{sentence(coach.confidenceNote)}</p>}
    </>
  );
}

function Trust({ view }) {
  const { recovery, heroMeta, syncFreshness, tokenStatus, rawMetrics, sources, hrv, rhr, sleep, temp, baselines, quality, confidence, blendedRecommendation, resolvedRecommendation, changeSummary, alertHistory, sleepDebt, subjectiveRecovery, manualSummary, manualCompleteness, connected } = view;
  const stale = tokenStatus?.syncStatus === "failed" || tokenStatus?.syncStatus === "stale";
  const debtLine = sleepDebt
    ? `${sleepDebt.debtHours}${NBSP}h · ${sleepDebt.band}${Number.isFinite(sleepDebt.baselineHours) ? ` · against ${sleepDebt.baselineHours}${NBSP}h a night, ${sleepDebt.baselineSource === "wearable-need" ? "baseline need (Whoop)" : sleepDebt.baselineSource === "personal-norm" ? "your norm" : "target"} · naps credited` : ""}`
    : null;
  const history = Object.entries(alertHistory || {}).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);
  const component = (label, part, max, key, note) => part && [
    `${label}: ${part.score ?? part.nightly} of ${max}`,
    [rawMetrics[key], baselines?.[key]?.label && `baseline ${baselines[key].label}`, sources?.[key], note].filter(Boolean).join(" · "),
  ];
  return (
    <>
      <Ledger
        title="Today’s read"
        rows={[
          ["Score", recovery ? `${recovery.score ?? "—"} of 100 from ${heroMeta.source.toLowerCase()}, for ${recovery.scoredDay || heroMeta.latestDay || "the latest usable day"}` : null],
          ["Call", resolvedRecommendation?.label ? `${resolvedRecommendation.label}${resolvedRecommendation.readiness && resolvedRecommendation.readiness !== "n/a" ? ` · ${resolvedRecommendation.readiness}` : ""}` : null],
          ["Confidence", `${sentence(blendedRecommendation?.confidence || confidence?.level || "unknown")}. ${sentence(blendedRecommendation?.wearableAdjustment?.reason || confidence?.reason || "pending")}`, (blendedRecommendation?.confidence || confidence?.level) === "low"],
          ["Last sync", syncFreshness, stale],
          ["Latest recovery day", heroMeta.latestDay || "Not known", heroMeta.stale],
          ["Scoring basis", recovery?.scoringBasis],
          ["Data quality", quality?.summary],
        ]}
        note="If a number looks off, check here first: the raw wearable value, the scoring source, the sample depth and how fresh the sync is."
      />
      <Ledger
        title="How the score is made"
        rows={[
          component("HRV", hrv, 35, "hrv", hrv && `z ${hrv.zScore} · variation ${hrv.cv}%${hrv.sampleCount != null ? ` · ${hrv.sampleCount} samples` : ""}`),
          component("Resting heart rate", rhr, 25, "rhr", rhr && `${rhr.delta > 0 ? "+" : ""}${rhr.delta}${NBSP}bpm against baseline`),
          component("Sleep", sleep, 25, "sleep", "nightly contribution"),
          component("Temperature", temp, 15, "temp", temp && (temp.consecutiveNights > 0 ? `${temp.consecutiveNights} or more raised nights` : "at baseline")),
        ]}
        note="HRV adds up to 35 points, resting heart rate up to 25, sleep up to 25 and body temperature up to 15. These are contribution points, not raw wearable values. If detailed sleep data is missing, the score falls back to Oura’s readiness contributors and confidence drops."
      />
      <Ledger title="What moved today" rows={changeSummary.rows.map((row) => [row.label, row.value, row.tone === "warning" || row.tone === "caution"])} />
      {quality && (
        <Ledger
          title="Oura data"
          rows={[
            ["Quality", `${quality.score} of 100`],
            ["Window", `${quality.daysLoaded} of ${quality.daysRequested} days · latest sync ${quality.latestDate || "not known"}`],
            ["Recovery day", quality.latestRecoveryDate ? `${quality.latestRecoveryDate} · ${quality.latestRecoveryDate === quality.latestDate ? "current" : "latest usable sleep and readiness"}` : null],
            ["Sleep records", `${quality.sleepRecords} of ${quality.daysLoaded || quality.daysRequested}`],
            ["Readiness records", `${quality.readinessRecords} of ${quality.daysLoaded || quality.daysRequested}`],
            ["Blood oxygen days", String(quality.spo2Records ?? "—")],
            ["Temperature days", String(quality.tempRecords ?? "—")],
            ["Fallback mode", quality.fallbackMode ? "On" : "Off", quality.fallbackMode],
            ["Last sync", tokenStatus ? (tokenStatus.lastSynced ? `${new Date(tokenStatus.lastSynced).toLocaleDateString()} ${new Date(tokenStatus.lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${tokenStatus.syncStatus}` : "Never synced") : null, stale],
            ["Connection", tokenStatus?.isExpired ? "Needs reconnecting" : null, true],
          ]}
          note={`Record counts show how complete the window is. A low count means fewer synced nights or missing fields, not a scoring failure.${quality.fallbackMode ? " Fallback mode is on: missing sleep and readiness detail is filled from Oura’s readiness contributors, which lowers confidence." : ""}`}
        />
      )}
      <Ledger
        title="Your own inputs"
        rows={[
          ["Sleep debt, 7 days", debtLine],
          ["Primary source", connected ? "Oura biometrics" : "Manual check-in"],
          ["Manual score", subjectiveRecovery ? `${subjectiveRecovery.score} of 100 · ${subjectiveRecovery.read}` : null],
          ["Manual inputs", manualSummary],
          ["Input depth", `${manualCompleteness.filled} of ${manualCompleteness.total} recovery fields`],
        ]}
      />
      {history.length > 0 && (
        <Ledger
          title="Flags, last 7 days"
          rows={history.map(([date, entry]) => [dayDate(date), `${entry.markerCount > 0 ? `${entry.markerCount} marker${entry.markerCount > 1 ? "s" : ""}` : "Clear"}${entry.positiveMarkerCount > 0 ? ` · ${entry.positiveMarkerCount} good` : ""}`, entry.severity === "warning"])}
        />
      )}
    </>
  );
}

// While the wearable read loads. Named rows, so the wait says what is coming.
export function RecoveryLoading() {
  return (
    <div className="shell" data-screen="recovery">
      <div className="main" style={{ gap: 12 }} role="status" aria-live="polite">
        <p className="t-b c2">Loading your recovery…</p>
        {["The call", "Why this call", "Trend", "Drivers", "Training load"].map((label) => (
          <div key={label} className="card" style={{ ...column(8), opacity: 0.6 }} aria-hidden="true">
            <span className="t-c c2">{label}</span>
            <span style={{ height: 12, borderRadius: 4, background: "var(--press)", width: "70%" }} />
            <span style={{ height: 12, borderRadius: 4, background: "var(--press)", width: "45%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// No wearable: the manual check-in is the whole read, and it is a complete one.
export function RecoveryManual({ view }) {
  const { subjectiveRecovery, manualSummary, manualCompleteness, interpretation, qa, whoop, refreshingLabel, onOpenIntegrations, onOpenCheckin, isBroadsheet } = view;
  const inputs = manualSummary ? manualSummary.split(" · ") : [];
  return (
    <div className="shell" data-screen="recovery" style={isBroadsheet ? { maxWidth: "var(--ovt-content-width)" } : undefined}>
      <div className="main" style={{ gap: 16 }}>
        <Notices refreshingLabel={refreshingLabel} demo={view.demo} />
        <section aria-labelledby="rec-call" style={column(6)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="stamp grow">Manual</span>
            <span className="n-lg">{subjectiveRecovery ? subjectiveRecovery.score : "—"}</span><span className="t-s c2">/100</span>
          </div>
          <h2 id="rec-call" className="t-hl">{subjectiveRecovery ? sentence(subjectiveRecovery.read) : "No check-in yet today."}</h2>
          <p className="t-s c2">{subjectiveRecovery
            ? "From your check-in. It is a complete read on its own. A wearable adds biometrics when one is connected."
            : "Log today’s check-in to see a score. Sleep, sleep quality, soreness, stress, motivation and any illness or injury flag make up the read."}</p>
          {typeof onOpenCheckin === "function" && <button type="button" className="btn btn-p btn-b" onClick={onOpenCheckin} style={{ marginTop: 6 }}>{subjectiveRecovery ? "Edit check-in on Today" : "Check in on Today"}</button>}
        </section>

        <section aria-labelledby="rec-inputs" style={column(4)}>
          <div className="sec"><h2 id="rec-inputs" className="t-h">What you logged</h2><span className="t-s c2">{manualCompleteness.filled} of {manualCompleteness.total} fields</span></div>
          {inputs.length
            ? <ul className="rows">{inputs.map((part) => <li key={part} className="row" style={{ minHeight: 44 }}><span className="t-b grow" style={/illness|injury/i.test(part) ? { fontWeight: 600 } : undefined}>{sentence(part)}</span></li>)}</ul>
            : <p className="t-s c2">Nothing logged yet today.</p>}
        </section>

        <section aria-labelledby="rec-coach" style={column(6)}>
          <h2 id="rec-coach" className="t-h">The coach’s read</h2>
          <CoachRead coach={interpretation} />
          <p className="t-s c2">HRV and resting heart rate are context only until you have a personal baseline. A convenient number is not a baseline.</p>
        </section>

        <ul className="rows">
          <FoldRow title="Wearables" sub="Optional. What connecting one adds">
            {qa && <div style={column(4)}><h3 className="t-ss">{qa.title}</h3><p className="t-s c2">{qa.body}</p></div>}
            <Whoop connected={whoop.connected} summary={whoop.summary} syncEvents={whoop.syncEvents} />
            {typeof onOpenIntegrations === "function" && <button type="button" className="btn btn-s btn-b" onClick={onOpenIntegrations}>Open integrations</button>}
          </FoldRow>
        </ul>
      </div>
    </div>
  );
}

export function RecoveryConnected({ view }) {
  const { verdict, recovery, trend, checkin, todayBody, todayKey, todayPlan, data, changeSummary, provenance, alerts, conflicts, recoveryHistory, trainingLoad, externalCardio, unloggedFlags, coachInterp, edition, isBroadsheet, onOpenCheckin, onOpenIntegrations } = view;
  const score = Number.isFinite(Number(recovery?.score)) ? Math.round(Number(recovery.score)) : null;
  const head = (
    <>
      <Notices refreshingLabel={view.refreshingLabel} demo={view.demo} />
      {view.reconnect && (
        <div className="banner" role="alert" style={{ flexDirection: "column", gap: 6 }}>
          <p><b>Oura needs reconnecting.</b> Syncing has stopped, so what you see here may be out of date.</p>
          {typeof onOpenIntegrations === "function" && <button type="button" className="btn btn-s btn-sm" onClick={onOpenIntegrations} style={{ alignSelf: "flex-start" }}>Reconnect Oura</button>}
        </div>
      )}
      {edition.available && (
        <button type="button" className="row" data-testid="sunday-edition-line" onClick={edition.onOpen} style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          <span className="kv grow"><span className="t-bs">The Sunday Edition is out</span><span className="t-s c2">Your week, ending on one change</span></span>
          <Icon name="next" size="s" className="c2" />
        </button>
      )}
      {verdict && <Call verdict={verdict} recovery={recovery} trend={trend} checkin={checkin} todayKey={todayKey} firstSync={view.firstSync} />}
      <Alerts alerts={alerts} conflicts={conflicts} />
      {verdict && <Why verdict={verdict} trend={trend} checkin={checkin} recovery={recovery} data={data} todayKey={todayKey} todayPlan={todayPlan} changeSummary={changeSummary} provenance={provenance} />}
      {todayKey && <CheckinBanner checkin={checkin} todayBody={todayBody} onOpenCheckin={onOpenCheckin} />}
    </>
  );
  const figures = (
    <>
      <Trend history={recoveryHistory} score={score} />
      <Drivers hrv={view.hrv} rhr={view.rhr} sleep={view.sleep} temp={view.temp} rawMetrics={view.rawMetrics} sleepDebt={view.sleepDebt} />
      <Load trainingLoad={trainingLoad} externalCardio={externalCardio} unloggedFlags={unloggedFlags} />
    </>
  );
  const audit = (
    <ul className="rows" style={{ borderTop: "1px solid var(--line)" }}>
      {(coachInterp.cluster || coachInterp.guidance) && (
        <FoldRow title="The coach’s read" sub="The pattern behind today’s markers" tag={coachInterp.tone === "warning" ? "Caution" : coachInterp.tone === "good" ? "Clear" : "Watch"}>
          <CoachRead coach={coachInterp} />
        </FoldRow>
      )}
      <FoldRow title="Wearables" sub="Oura and Whoop, and which source won each metric">
        <Wearables view={view} />
      </FoldRow>
      <FoldRow title="Data trust" sub="Raw values, sample depth, last sync">
        <Trust view={view} />
      </FoldRow>
    </ul>
  );

  if (isBroadsheet) {
    return (
      <div className="shell" data-screen="recovery">
        <div className="main" style={{ display: "grid", gridTemplateColumns: "var(--ovt-rail-m) minmax(0, 1fr) var(--ovt-rail-s)", gap: 32, alignItems: "start" }}>
          <section data-section="rec-verdict" style={{ ...column(16), minWidth: 0 }}>{head}</section>
          <section data-section="rec-plates" style={{ ...column(24), minWidth: 0 }}>{figures}</section>
          <section data-section="rec-audit" style={{ minWidth: 0 }}>{audit}</section>
        </div>
      </div>
    );
  }
  return (
    <div className="shell" data-screen="recovery">
      <div className="main" style={{ gap: 16 }}>
        {head}
        {figures}
        {audit}
      </div>
    </div>
  );
}
