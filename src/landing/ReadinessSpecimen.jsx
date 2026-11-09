// src/landing/ReadinessSpecimen.jsx
// Shared readiness "specimen" — the auto-cycling verdict card that
// demonstrates the real engine. Extracted from DemoPage so the logged-out
// landing (Fig. 1) and the #/demo pitch page render one and the same card
// instead of keeping two copies. Everything here runs the actual
// computeReadinessIndex, so every number shown is one the app would produce.
// computeReadinessIndex is already in the entry chunk (TodayTab imports the
// decision engine eagerly), so using it on the landing adds no bundle weight.
import { useState, useEffect, useRef } from "react";
import { computeReadinessIndex } from "../decisionEngine";

export const ORDER = ["rest", "pull_back", "moderate", "normal", "push"];
export const SHORT = { rest: "Rest", pull_back: "Pull", moderate: "Mod", normal: "Norm", push: "Push" };
export const LABEL = { push: "Push", normal: "Normal", moderate: "Moderate", pull_back: "Pull back", rest: "Rest" };

export const bandFor = (i) => (i >= 80 ? "push" : i >= 62 ? "normal" : i >= 42 ? "moderate" : i >= 25 ? "pull_back" : "rest");
export const inkFor = (C, b) => (b === "push" || b === "normal" ? C.text : b === "moderate" ? C.textDim : C.signal);
export const ruleFor = (b) => (b === "moderate" ? 1 : b === "normal" ? 1.5 : 2);
export function summaryFor(b) {
  if (b === "push") return "Recovery and load both support quality work today.";
  if (b === "normal") return "Run the plan as written and see how warm-ups feel.";
  if (b === "moderate") return "Train today, but keep intensity controlled and hold volume.";
  if (b === "pull_back") return "Your recovery and load profile argues for reducing stress today.";
  return "Low recovery plus elevated load is a bad trade. Recovery counts as training.";
}

export function ReadinessCard({ C, index, band, reason, stat, textOpacity = 1, markerIndex = index }) {
  const ink = inkFor(C, band);
  const serif = C.serifFamily, mono = C.monoFamily;
  const activeIdx = ORDER.indexOf(band);
  const fade = { opacity: textOpacity, transition: "opacity 0.35s ease" };
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderTop: `2px solid ${ink}`, padding: "20px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `1px solid ${C.textDim}`, paddingTop: 9, marginBottom: 12 }}>
        <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim }}>Fig. 0 · Readiness</span>
        <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, color: ink, ...fade }}>{stat}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
        <span style={{ fontFamily: serif, fontWeight: 500, fontSize: 76, lineHeight: 0.8, letterSpacing: "-0.05em", color: ink, fontVariantNumeric: "tabular-nums" }}>{index}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 7 }}>
          <span style={{ fontFamily: serif, fontWeight: 500, fontSize: 25, lineHeight: 1, letterSpacing: "-0.02em", color: ink, ...fade }}>{LABEL[band]}</span>
          <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textFaint }}>Readiness index / 100</span>
        </div>
      </div>
      <div style={{ height: ruleFor(band), background: ink, margin: "14px 0 11px", transition: "background 0.35s ease" }} />
      <div style={{ fontFamily: serif, fontStyle: "italic", color: C.textDim, fontSize: 15.5, lineHeight: 1.4, minHeight: "2.8em", ...fade }}>{summaryFor(band)}</div>
      {reason && (
        <div style={{ fontFamily: mono, fontSize: 13, color: C.textDim, letterSpacing: "0.02em", marginTop: 9, display: "flex", gap: 7, ...fade }}>
          <span style={{ color: ink }}>▸</span><span>{reason}</span>
        </div>
      )}
      <div style={{ marginTop: 16, position: "relative" }}>
        <div style={{ display: "flex", gap: 3 }}>
          {ORDER.map((st, i) => <div key={st} style={{ flex: 1, height: 6, background: i === activeIdx ? ink : C.line, transition: "background 0.4s ease" }} />)}
        </div>
        <div style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${markerIndex}% - 1px)`, width: 2, background: ink, transition: "left 0.6s cubic-bezier(.22,1,.36,1), background 0.35s ease" }} />
        <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
          {ORDER.map((st, i) => (
            <div key={st} style={{ flex: 1, textAlign: "center", fontFamily: mono, fontSize: 11.5, letterSpacing: "0.04em", textTransform: "uppercase", color: i === activeIdx ? ink : C.textFaint, fontWeight: i === activeIdx ? 700 : 500, transition: "color 0.4s ease" }}>{SHORT[st]}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Auto-cycling specimen — the engine visibly makes different calls on a loop.
export const HERO_SCN = [
  { r: 82, a: 1.05, reason: "Recovery's well above your 30-day baseline." },
  { r: 72, a: 1.20, reason: "Load's climbing, but still inside the optimal band." },
  { r: 70, a: 1.30, reason: "Acute load is starting to outrun your fitness." },
  { r: 58, a: 1.45, reason: "Fatigue is outpacing recovery — ease off today." },
];
export const scnIndex = (s) => { const r = computeReadinessIndex(s.r, { ratio: s.a }, null); return r ? r.index : 0; };
export const stressFromIndex = (i) => Math.max(0, Math.min(1, 1 - i / 100));

// ReadinessSpecimen, shared by the demo and the landing page. `stressRef`
// is optional: the demo passes one to drive its FlowField backdrop; the
// landing passes nothing (the `if (stressRef)` guard below covers it — no
// default value, so the hooks analyzer still classifies it as a ref).
export function ReadinessSpecimen({ C, stressRef }) {
  const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(() => scnIndex(HERO_SCN[0]));
  const [fade, setFade] = useState(false);
  const shownRef = useRef(shown);
  const rafRef = useRef(null);
  useEffect(() => { shownRef.current = shown; }, [shown]);

  const scn = HERO_SCN[step];
  const target = scnIndex(scn);
  const band = bandFor(target);
  const stat = `${LABEL[band]} · rec ${scn.r}`;

  // Advance scenarios on a loop (fade text out, swap, fade in).
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setFade(true);
      setTimeout(() => { setStep((s) => (s + 1) % HERO_SCN.length); setFade(false); }, 220);
    }, 3200);
    return () => clearInterval(id);
  }, [reduce]);

  // Count the numeral toward the active scenario's index.
  useEffect(() => {
    if (reduce) { setShown(target); return; }
    let start = null; const from = shownRef.current; const dur = 600;
    cancelAnimationFrame(rafRef.current);
    const tick = (t) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / dur); const e = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (target - from) * e));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, reduce]);

  useEffect(() => { if (stressRef) stressRef.current = stressFromIndex(target); }, [target, stressRef]);

  return <ReadinessCard C={C} index={shown} markerIndex={target} band={band} stat={stat} reason={scn.reason} textOpacity={fade ? 0 : 1} />;
}
