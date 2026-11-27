// src/CardioSession.jsx
// The interval runner: the cardio counterpart to the session runner.
// Three phases: setup (presets and work, rest, rounds and warm-up steppers,
// filled from the plan's steps or notes when they are unambiguous), running
// (what you are in now, the time left in it, the round, what is next, and
// Pause, Skip segment and End), then done (the elapsed time and one tap to log
// it through the existing workout.cardio.time write path).
// Timer math is timestamp-based so a backgrounded tab does not drift.

import { useState, useEffect, useRef, useMemo } from "react";
import { Flow, Icon, TopBar } from "./ui/ledger";
import { CARDIO_PRESETS, normalizePlan, buildSegments, totalPlannedSeconds, fmtSeconds, suggestPlanFromNotes, suggestPlanFromSteps } from "./cardioSession";
import { triggerHaptic, useScreenWakeLock } from "./sessionDevice";
import { WhoopWorkoutPulse } from "./workout/WhoopWorkoutPulse";
import { WorkoutPulseTimeline } from "./workout/WorkoutPulseTimeline";
import { useWhoopBluetooth } from "./whoop/bluetooth";
import { selectionHaptic } from "./native";

const NBSP = "\u00a0";
const KIND = { work: "Work", rest: "Rest", warmup: "Warm-up" };

function Stepper({ label, value, display, onChange, step, min, max }) {
  return (
    <div className="row" style={{ minHeight: 64 }}>
      <span className="t-bs grow">{label}</span>
      <div className="step" role="group" aria-label={label} style={{ width: 216 }}>
        <button type="button" aria-label={`Less ${label.toLowerCase()}`} onClick={() => { selectionHaptic(); onChange(Math.max(min, value - step)); }}><Icon name="minus" /></button>
        <span className="stepv"><span className="n-md">{display}</span></span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => { selectionHaptic(); onChange(Math.min(max, value + step)); }}><Icon name="plus" /></button>
      </div>
    </div>
  );
}

export function CardioSession({ open, onClose, cardio, onLogTime, showToast, settings, pulseSummary, onSavePulse }) {
  // Structured race-plan steps win; prose parsing stays the fallback.
  const suggested = useMemo(() => suggestPlanFromSteps(cardio?.steps) || suggestPlanFromNotes(cardio?.notes), [cardio]);
  const hapticsEnabled = settings?.trainingCues?.haptics !== false;
  useScreenWakeLock(open);

  const [phase, setPhase] = useState("setup"); // setup | running | done
  const [plan, setPlan] = useState(() => suggested || normalizePlan(CARDIO_PRESETS[0]));
  const [segIdx, setSegIdx] = useState(0);
  const [segEndsAt, setSegEndsAt] = useState(null);
  const [pausedRemaining, setPausedRemaining] = useState(null);
  const [now, setNow] = useState(Date.now());
  const startedAtRef = useRef(null);
  const [startedAt, setStartedAt] = useState(null);
  const elapsedRef = useRef(0);
  const wasOpen = useRef(false);
  const pulse = useRef(null);
  const strap = useWhoopBluetooth();
  const closeSession = () => { pulse.current?.flush(); onClose(); };

  const segments = useMemo(() => buildSegments(plan), [plan]);
  const seg = segments[segIdx] || null;

  useEffect(() => {
    // A checkpoint can refresh the plan object while the timer is running.
    if (open && !wasOpen.current) {
      setPhase("setup");
      setPlan(suggested || normalizePlan(CARDIO_PRESETS[0]));
      setSegIdx(0); setSegEndsAt(null); setPausedRemaining(null);
      elapsedRef.current = 0; startedAtRef.current = null;
      setStartedAt(null);
    }
    wasOpen.current = open;
  }, [open, suggested]);

  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [phase]);

  const remaining = segEndsAt !== null ? (segEndsAt - now) / 1000 : (pausedRemaining ?? 0);

  // Segment complete → advance (or finish)
  useEffect(() => {
    if (phase !== "running" || segEndsAt === null || remaining > 0) return;
    if (segIdx < segments.length - 1) {
      const next = segments[segIdx + 1];
      triggerHaptic(next.kind === "work" ? [200, 100, 200] : 200, hapticsEnabled);
      setSegIdx(segIdx + 1);
      setSegEndsAt(Date.now() + next.seconds * 1000);
    } else {
      triggerHaptic([300, 100, 300, 100, 300], hapticsEnabled);
      elapsedRef.current = Math.round((Date.now() - startedAtRef.current) / 1000);
      pulse.current?.flush();
      setPhase("done");
    }
  }, [phase, remaining, segEndsAt, segIdx, segments, hapticsEnabled]);

  if (!open) return null;

  const start = () => {
    startedAtRef.current = Date.now();
    setStartedAt(startedAtRef.current);
    setSegIdx(0);
    setSegEndsAt(Date.now() + segments[0].seconds * 1000);
    setPhase("running");
  };
  const pause = () => { setPausedRemaining(remaining); setSegEndsAt(null); };
  const resume = () => { setSegEndsAt(Date.now() + (pausedRemaining ?? 0) * 1000); setPausedRemaining(null); };
  const skip = () => {
    if (segIdx < segments.length - 1) {
      setSegIdx(segIdx + 1);
      setSegEndsAt(Date.now() + segments[segIdx + 1].seconds * 1000);
      setPausedRemaining(null);
    } else {
      elapsedRef.current = Math.round((Date.now() - startedAtRef.current) / 1000);
      pulse.current?.flush();
      setPhase("done");
    }
  };
  const endEarly = () => {
    pulse.current?.flush();
    elapsedRef.current = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0;
    setPhase("done");
  };

  const workRounds = segments.filter(s => s.kind === "work").length;
  const paused = phase === "running" && segEndsAt === null;
  const nextSeg = segments[segIdx + 1] || null;
  const elapsedNow = phase === "running" && startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const planLine = `${plan.rounds}${NBSP}×${NBSP}${fmtSeconds(plan.work)} work${plan.rest ? ` · ${fmtSeconds(plan.rest)} rest` : ""}`;
  const title = cardio?.type || "Intervals";
  // The plan's own words, cut at a word when they run long.
  const notes = String(cardio?.notes || "").trim();
  const planNote = notes.length > 110 ? `${notes.slice(0, 110).replace(/\s+\S*$/, "")}…` : notes;

  return (
    <Flow label="Cardio session" onClose={closeSession} data-screen="intervals">
      <div className="shell">
        <TopBar title={title} close="Close" onClose={closeSession} />

        {phase === "setup" && (
          <>
            <div className="main">
              {suggested && <p className="banner"><Icon name="info" size="s" /><span>Filled from today’s plan{planNote ? `: “${planNote}”` : "."}</span></p>}
              <section aria-labelledby="iv-presets" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <h2 id="iv-presets" className="t-ss">Presets</h2>
                <div className="chips">
                  {CARDIO_PRESETS.map((preset) => {
                    const normal = normalizePlan(preset);
                    const on = normal.work === plan.work && normal.rest === plan.rest && normal.rounds === plan.rounds && normal.warmup === plan.warmup;
                    return <button key={preset.key} type="button" className="chip" aria-pressed={on} onClick={() => setPlan(normal)}>{preset.label}</button>;
                  })}
                </div>
              </section>
              <section aria-labelledby="iv-plan" style={{ display: "flex", flexDirection: "column" }}>
                <div className="sec"><h2 id="iv-plan" className="t-ss">Plan</h2><span className="t-s c2">Total {fmtSeconds(totalPlannedSeconds(plan))}</span></div>
                <div className="rows">
                  <Stepper label="Work" value={plan.work} display={fmtSeconds(plan.work)} step={15} min={5} max={3600} onChange={v => setPlan({ ...plan, work: v })} />
                  <Stepper label="Rest" value={plan.rest} display={fmtSeconds(plan.rest)} step={15} min={0} max={3600} onChange={v => setPlan({ ...plan, rest: v })} />
                  <Stepper label="Rounds" value={plan.rounds} display={String(plan.rounds)} step={1} min={1} max={50} onChange={v => setPlan({ ...plan, rounds: v })} />
                  <Stepper label="Warm-up" value={plan.warmup} display={fmtSeconds(plan.warmup)} step={60} min={0} max={1800} onChange={v => setPlan({ ...plan, warmup: v })} />
                </div>
              </section>
            </div>
            <div className="foot"><button type="button" className="btn btn-p btn-lg btn-b" onClick={start}>Start</button></div>
          </>
        )}

        {phase === "running" && seg && (
          <>
            <div className="main" style={{ gap: 16 }}>
              {strap && onSavePulse && <WhoopWorkoutPulse key={strap.owner} ref={pulse} saved={pulseSummary} onSave={onSavePulse} />}
              <p className="n">{planLine}</p>
              <p className="sr" role="status">{paused ? "Paused." : `${KIND[seg.kind]}${seg.kind !== "warmup" ? `, round ${seg.round} of ${workRounds}` : ""}.`}</p>
              <section className="card" aria-label="Current segment" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 16px", ...(seg.kind === "work" && !paused ? { borderColor: "var(--ink)", borderWidth: 2 } : {}) }}>
                <p className="stamp" style={{ display: "flex", alignItems: "center", gap: 6 }}>{paused && <Icon name="pause" size="s" />}{paused ? "Paused" : KIND[seg.kind]}</p>
                <p role="timer" aria-label={`${fmtSeconds(remaining)} left in this segment`} style={{ font: "600 88px/88px var(--f-data)", letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums", color: paused ? "var(--ink-2)" : "var(--ink)" }}>{fmtSeconds(remaining)}</p>
                <span className="bar bar-t" aria-hidden="true" style={{ width: "100%" }}><i style={{ width: `${Math.max(0, Math.min(100, (1 - remaining / Math.max(1, seg.seconds)) * 100))}%` }} /></span>
                {seg.kind !== "warmup" && <p className="t-b">Round <span className="n">{seg.round}</span> of <span className="n">{workRounds}</span></p>}
                <div role="img" aria-label={`${segments.slice(0, segIdx).filter((s) => s.kind === "work").length} of ${workRounds} work rounds done`} style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  {segments.filter((s) => s.kind === "work").map((s) => {
                    const done = seg.kind === "warmup" ? false : s.round < seg.round || (s.round === seg.round && seg.kind === "rest");
                    const here = seg.kind === "work" && s.round === seg.round;
                    return <i key={s.round} style={{ width: 14, height: 14, borderRadius: 3, border: here ? "3px solid var(--ink)" : "1px solid var(--edge)", background: done ? "var(--ink)" : "transparent" }} />;
                  })}
                </div>
              </section>
              <div style={{ display: "flex", gap: 24 }}>
                <div className="kv grow"><span className="t-c c2">Next</span><span className="t-b">{nextSeg ? <>{KIND[nextSeg.kind]} <span className="n">{fmtSeconds(nextSeg.seconds)}</span></> : "Finish"}</span></div>
                <div className="kv grow"><span className="t-c c2">Elapsed</span><span className="n">{fmtSeconds(elapsedNow)}</span></div>
              </div>
            </div>
            <div className="foot">
              <button type="button" className="btn btn-p btn-lg btn-b" onClick={paused ? resume : pause}><Icon name={paused ? "play" : "pause"} size="s" />{paused ? "Resume" : "Pause"}</button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button type="button" className="btn btn-s" onClick={skip}>Skip segment</button>
                <button type="button" className="btn btn-s" onClick={endEarly}>End</button>
              </div>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <div className="main" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 8 }}>
              <p className="stamp">Session over</p>
              <p className="n-xl">{fmtSeconds(elapsedRef.current)}</p>
              <p className="t-s c2">{workRounds} rounds planned · {title}</p>
              {pulseSummary && <div style={{ width: "100%", textAlign: "left" }}><WorkoutPulseTimeline summary={pulseSummary} /></div>}
            </div>
            <div className="foot">
              <button type="button" className="btn btn-p btn-lg btn-b" onClick={() => { onLogTime?.(fmtSeconds(elapsedRef.current)); showToast?.("Time logged"); onClose(); }}>Log {fmtSeconds(elapsedRef.current)} to today</button>
              <button type="button" className="btn btn-s btn-b" onClick={onClose}>Close without logging</button>
            </div>
          </>
        )}
      </div>
    </Flow>
  );
}

export default CardioSession;
