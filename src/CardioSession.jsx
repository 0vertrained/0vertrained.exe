// src/CardioSession.jsx
// Cardio session runner — the interval counterpart to Session Mode.
// Three phases: setup (preset chips + work/rest/round steppers, pre-filled
// from the program's cardio notes when unambiguous), running (segment
// countdown, round counter, pause/skip), done (summary + one-tap log of the
// elapsed time through the EXISTING workout.cardio.time write path).
// Timer math is timestamp-based so backgrounded tabs don't drift.

import { useState, useEffect, useRef, useMemo } from "react";
import { useTheme } from "./theme";
import { CARDIO_PRESETS, normalizePlan, buildSegments, totalPlannedSeconds, fmtSeconds, suggestPlanFromNotes, suggestPlanFromSteps } from "./cardioSession";
import { triggerHaptic, useScreenWakeLock } from "./sessionDevice";

function Stepper({ label, value, display, onChange, step, min, max }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const btn = { width: 40, height: 40, background: "none", border: `1px solid ${C.lineBright}`, color: C.text, fontFamily: mono, fontSize: 16, cursor: "pointer" };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
      <span style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" style={btn} onClick={() => onChange(Math.max(min, value - step))} aria-label={`Decrease ${label}`}>−</button>
        <span style={{ fontFamily: C.serifFamily, fontSize: 18, color: C.text, minWidth: 52, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{display}</span>
        <button type="button" style={btn} onClick={() => onChange(Math.min(max, value + step))} aria-label={`Increase ${label}`}>+</button>
      </span>
    </div>
  );
}

export function CardioSession({ open, onClose, cardio, onLogTime, showToast, settings }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
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
  const elapsedRef = useRef(0);

  const segments = useMemo(() => buildSegments(plan), [plan]);
  const seg = segments[segIdx] || null;

  useEffect(() => {
    if (open) {
      setPhase("setup");
      setPlan(suggested || normalizePlan(CARDIO_PRESETS[0]));
      setSegIdx(0); setSegEndsAt(null); setPausedRemaining(null);
      elapsedRef.current = 0; startedAtRef.current = null;
    }
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
      setPhase("done");
    }
  }, [phase, remaining, segEndsAt, segIdx, segments, hapticsEnabled]);

  if (!open) return null;

  const start = () => {
    startedAtRef.current = Date.now();
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
      setPhase("done");
    }
  };
  const endEarly = () => {
    elapsedRef.current = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0;
    setPhase("done");
  };

  const workRounds = segments.filter(s => s.kind === "work").length;
  const currentRound = seg?.round || 0;
  const paused = phase === "running" && segEndsAt === null;
  const segTone = seg?.kind === "work" ? C.text : seg?.kind === "rest" ? C.green : C.textDim;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 350, background: C.bg, display: "flex", flexDirection: "column" }} role="dialog" aria-modal="true" aria-label="Cardio session">
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer", padding: 0 }}>← Exit</button>
        <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, fontFamily: mono }}>
          {cardio?.type || "Cardio"} · {phase === "setup" ? "setup" : phase === "done" ? "complete" : `round ${currentRound}/${workRounds}`}
        </span>
      </div>

      {phase === "setup" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {suggested && (
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.55, marginBottom: 12, padding: "9px 11px", border: `1px solid ${C.line}` }}>
              Pre-filled from today's plan: "{(cardio?.notes || "").slice(0, 80)}"
            </div>
          )}
          <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: C.textDim, fontFamily: mono, marginBottom: 8 }}>Presets</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {CARDIO_PRESETS.map(p => (
              <button key={p.key} type="button" onClick={() => setPlan(normalizePlan(p))}
                style={{ border: `1px solid ${C.lineBright}`, background: C.panel, color: C.textDim, fontSize: 11, fontFamily: mono, padding: "8px 11px", cursor: "pointer" }}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: C.textDim, fontFamily: mono, marginBottom: 4 }}>Plan</div>
          <Stepper label="Work" value={plan.work} display={fmtSeconds(plan.work)} step={15} min={5} max={3600} onChange={v => setPlan({ ...plan, work: v })} />
          <Stepper label="Rest" value={plan.rest} display={fmtSeconds(plan.rest)} step={15} min={0} max={3600} onChange={v => setPlan({ ...plan, rest: v })} />
          <Stepper label="Rounds" value={plan.rounds} display={String(plan.rounds)} step={1} min={1} max={50} onChange={v => setPlan({ ...plan, rounds: v })} />
          <Stepper label="Warm-up" value={plan.warmup} display={fmtSeconds(plan.warmup)} step={60} min={0} max={1800} onChange={v => setPlan({ ...plan, warmup: v })} />
          <div style={{ fontSize: 11, color: C.textFaint, fontFamily: mono, margin: "12px 0 16px" }}>
            Total planned · {fmtSeconds(totalPlannedSeconds(plan))}
          </div>
          <button type="button" onClick={start} style={{ width: "100%", background: C.text, color: C.bg, border: `1px solid ${C.text}`, padding: "14px", fontFamily: mono, fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, cursor: "pointer" }}>
            Start →
          </button>
        </div>
      )}

      {phase === "running" && seg && (
        <>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 16px", textAlign: "center" }}>
            <div style={{ fontSize: 11.5, letterSpacing: "0.3em", textTransform: "uppercase", color: segTone, fontFamily: mono, fontWeight: 600 }}>
              {paused ? "Paused" : seg.kind}
            </div>
            <div style={{ fontFamily: C.serifFamily, fontSize: 88, fontWeight: 500, letterSpacing: "-0.03em", color: paused ? C.textDim : C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums", margin: "10px 0" }}>
              {fmtSeconds(remaining)}
            </div>
            {seg.kind !== "warmup" && (
              <div style={{ fontSize: 11.5, color: C.textDim, fontFamily: mono, letterSpacing: "0.08em" }}>
                Round {seg.round} of {workRounds}
              </div>
            )}
            {/* Segment strip — where you are in the session */}
            <div style={{ display: "flex", gap: 3, marginTop: 22, maxWidth: 320, flexWrap: "wrap", justifyContent: "center" }}>
              {segments.map((s, i) => (
                <span key={i} style={{ width: s.kind === "warmup" ? 18 : 10, height: 4, background: i < segIdx ? C.text : i === segIdx ? (s.kind === "rest" ? C.green : C.text) : C.line, opacity: i === segIdx ? 1 : i < segIdx ? 0.6 : 1 }} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${C.line}`, background: C.panel }}>
            <button type="button" onClick={paused ? resume : pause} style={{ ...S.smallBtn, flex: 1, padding: "13px", borderColor: C.text, color: C.text }}>{paused ? "Resume" : "Pause"}</button>
            <button type="button" onClick={skip} style={{ ...S.smallBtn, flex: 1, padding: "13px" }}>Skip →</button>
            <button type="button" onClick={endEarly} style={{ ...S.smallBtn, flex: 1, padding: "13px" }}>End</button>
          </div>
        </>
      )}

      {phase === "done" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px", textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.textDim, fontFamily: mono }}>Session complete</div>
          <div style={{ fontFamily: C.serifFamily, fontSize: 56, fontWeight: 500, color: C.text, lineHeight: 1.1, margin: "8px 0", fontVariantNumeric: "tabular-nums" }}>
            {fmtSeconds(elapsedRef.current)}
          </div>
          <div style={{ fontSize: 11.5, color: C.textDim, fontFamily: mono, marginBottom: 24 }}>
            {workRounds} rounds planned · {cardio?.type || "cardio"}
          </div>
          <button
            type="button"
            onClick={() => { onLogTime?.(fmtSeconds(elapsedRef.current)); showToast?.("Time logged"); onClose(); }}
            style={{ width: "100%", maxWidth: 320, background: C.text, color: C.bg, border: `1px solid ${C.text}`, padding: "14px", fontFamily: mono, fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, cursor: "pointer", marginBottom: 10 }}
          >
            Log {fmtSeconds(elapsedRef.current)} to today →
          </button>
          <button type="button" onClick={onClose} style={{ ...S.smallBtn, width: "100%", maxWidth: 320, padding: "12px" }}>Close without logging</button>
        </div>
      )}
    </div>
  );
}
