import { useState, useEffect, useRef } from "react";
import { useTheme } from "../theme";
import { Stamp } from "../ui/primitives";

// Count a number up to its target on mount — the one orchestrated motion moment
// on Today. Honors the OS reduced-motion preference (jumps straight to target).
function useCountUp(target, duration = 650) {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    if (reduce || from === target) { setVal(target); fromRef.current = target; return; }
    let raf, start = null;
    const tick = (t) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// Readiness state expressed WITHOUT colour — the single-ink language carries
// state via ink density, type weight, and rule thickness. The one reserved
// spot colour (C.signal) is spent only on the caution states (pull back / rest).
function stateInk(C, band) {
  switch (band) {
    case "push":      return { ink: C.text,    rule: 2,   weight: 700 };
    case "normal":    return { ink: C.text,    rule: 1.5, weight: 600 };
    case "moderate":  return { ink: C.textDim, rule: 1,   weight: 600 };
    case "pull_back": return { ink: C.signal,  rule: 1.5, weight: 700 };
    case "rest":      return { ink: C.signal,  rule: 2,   weight: 700 };
    default:          return { ink: C.text,    rule: 1,   weight: 500 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Intelligence sections — the user-facing surface of the deterministic engine.
//  Extracted from App.jsx so the readiness / adaptive / nutrition figures live
//  together and App.jsx stays a thinner shell (see Improvements §6.1).
// ─────────────────────────────────────────────────────────────────────────────

// 5-state readiness scale. Position disambiguates the call (so "Push" and
// "Normal" are no longer visually identical); the single reserved spot colour
// marks a caution state (two-ink press), plain ink marks neutral/positive.
const READINESS_ORDER = ["rest", "pull_back", "moderate", "normal", "push"];
const READINESS_SHORT = { rest: "REST", pull_back: "PULL", moderate: "MOD", normal: "NORM", push: "PUSH" };

function ReadinessScale({ active, index = null, C }) {
  const activeIdx = READINESS_ORDER.indexOf(active);
  const { ink } = stateInk(C, active);
  const hasMarker = typeof index === "number" && index >= 0 && index <= 100;
  return (
    <div style={{ marginTop: 16 }} aria-hidden="true">
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", gap: 3 }}>
          {READINESS_ORDER.map((st, i) => (
            <div key={st} style={{ flex: 1, height: 6, background: i === activeIdx ? ink : C.line }} />
          ))}
        </div>
        {hasMarker && (
          <div style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${index}% - 1px)`, width: 2, background: ink, transition: "left 600ms cubic-bezier(0.22,1,0.36,1)" }} />
        )}
      </div>
      <div style={{ display: "flex", gap: 3, marginTop: 5 }}>
        {READINESS_ORDER.map((st, i) => (
          <div key={st} style={{ flex: 1, textAlign: "center", fontFamily: C.monoFamily, fontSize: 9.5, letterSpacing: "0.05em", color: i === activeIdx ? ink : C.textFaint, fontWeight: i === activeIdx ? 700 : 500 }}>
            {READINESS_SHORT[st]}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Readiness Section (merged recommendation + recovery) ─────────────────────
export function ReadinessSection({ recommendation, recovery, C, S }) {
  // V12.1 · Hooks must run unconditionally — the early return previously sat
  // ABOVE useCountUp/useState, so a recommendation flipping between null and
  // set across renders changed the hook order and crashed React
  // ("Rendered more hooks than during the previous render"). Caught by
  // react-hooks/rules-of-hooks on ESLint's first run.
  const hasIndex = typeof recommendation?.readinessIndex === "number";
  const displayIndex = useCountUp(hasIndex ? recommendation.readinessIndex : 0);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  if (!recommendation) return null;
  const readinessLabel = {
    push: "Push",
    normal: "Normal",
    moderate: "Moderate",
    pull_back: "Pull back",
    rest: "Rest",
  }[recommendation.readiness] || recommendation.readiness;
  const st = stateInk(C, recommendation.readiness);
  const tone = st.ink;
  const reasons = (recommendation.reasons || []).slice(0, 3);
  const topReason = (recommendation.reasons || []).find(r => r.severity && r.severity !== "neutral") || (recommendation.reasons || [])[0] || null;
  const lowConfidence = String(recommendation.confidence).toLowerCase() === "low";
  const reasoningNote = recovery
    ? `Recovery ${recovery.score}/100 via ${recovery.source === "oura" ? "Oura biometrics" : "your check-in"} sets the ceiling; recent load discounts it as ACWR climbs.`
    : `No recovery logged, so this leans on load alone — confidence is limited until you check in.`;
  const disclosureRow = { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", borderTop: `1px solid ${C.line}`, padding: "13px 0 12px", minHeight: 44, cursor: "pointer", textAlign: "left" };

  return (
    <section style={{ ...S.block, paddingTop: 18, paddingBottom: 16, borderTop: `1px solid ${C.line}` }}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>Recovery readiness</span>
        <span style={{ ...S.blockStat, color: tone, fontWeight: st.weight }}>{readinessLabel}{recovery ? ` · ${recovery.score}` : ""}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
        {hasIndex ? (
          <span style={{ fontFamily: S.fontSerif, fontSize: 56, lineHeight: 0.82, fontWeight: 500, letterSpacing: "-0.05em", color: tone, fontVariantNumeric: "tabular-nums" }} aria-label={`Readiness index ${recommendation.readinessIndex} of 100`}>{displayIndex}</span>
        ) : (
          <span style={{ fontFamily: S.fontSerif, fontSize: 42, lineHeight: 0.82, fontWeight: 500, color: C.textFaint }} aria-label="Readiness index unavailable">—</span>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: tone, lineHeight: 1 }}>{readinessLabel}</span>
          <span style={{ fontSize: 10, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase" }}>{hasIndex ? "Index / 100" : "Building baseline"}</span>
        </div>
      </div>
      <div style={{ ...S.figureRule, background: C.line, height: 1, marginTop: 10, marginBottom: 8 }} />
      <div style={{ fontSize: 14, color: C.textDim, lineHeight: 1.4 }}>{recommendation.summary}</div>
      {topReason && (
        <div style={{ ...S.annotation, marginTop: 8, color: C.textDim, display: "flex", gap: 6 }}>
          <span style={{ color: st.ink }}>▸</span><span>{topReason.label} — {topReason.detail}</span>
        </div>
      )}
      <ReadinessScale active={recommendation.readiness} index={recommendation.readinessIndex} C={C} />
      {reasons.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button type="button" onClick={() => setReasonsOpen(o => !o)} aria-expanded={reasonsOpen} aria-controls="readiness-reasoning" style={disclosureRow}>
            <span style={S.blockTitle}>Reasoning</span>
            <span style={{ fontFamily: C.monoFamily, fontSize: 13.5, color: C.textDim, lineHeight: 1 }} aria-hidden="true">{reasonsOpen ? "—" : "+"}</span>
          </button>
          {reasonsOpen && (
            <div id="readiness-reasoning">
              {reasons.map((r, idx) => (
                <div key={`${r.source}-${r.label}-${idx}`} style={S.ruledRow}>
                  <span style={S.ruledLabel}>{r.label}</span>
                  <span style={{ ...S.ruledValue, maxWidth: "58%" }}>{r.detail}</span>
                </div>
              ))}
              <div style={{ ...S.annotation, color: C.textFaint, lineHeight: 1.5, paddingTop: 10 }}>{reasoningNote}</div>
            </div>
          )}
        </div>
      )}
      {lowConfidence && (
        <div style={{ ...S.annotation, marginTop: 8, color: C.textDim }}>
          lower confidence — treat this as a soft suggestion until more is logged
        </div>
      )}
      {recommendation.missingData?.length > 0 && (
        <div style={{ ...S.annotation, marginTop: 8 }}>confidence limited by missing: {recommendation.missingData.join(", ")}</div>
      )}
    </section>
  );
}

// ─── Adaptive Training Banner (compact) ─────────────────────────────────────
// V6 note: no longer rendered on Today — replaced by TrainingAdjustmentInline
// below, which renders the same content *inside* the decision block instead
// of as a second, competing decision surface. Kept exported for reuse.
export function AdaptiveTrainingBanner({ suggestion, accepted, keptOriginal, onAccept, onKeepOriginal }) {
  const { C, S } = useTheme();
  if (!suggestion) return null;
  const shouldShow = suggestion.mode !== "keep" || suggestion.title.toLowerCase().includes("quality window");
  if (!shouldShow && !accepted && !keptOriginal) return null;
  const tone = suggestion.mode === "rest" || suggestion.mode === "reduce_volume" || suggestion.mode === "swap_cardio"
    ? C.red
    : suggestion.mode === "keep"
      ? C.green
      : C.text;

  return (
    <section style={{ ...S.block, paddingTop: 12, paddingBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={S.blockTitle}>Training adjustment</span>
        <span style={{ fontSize: 10, color: tone, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: C.fontFamily }}>{suggestion.mode.replace("_", " ")}</span>
      </div>
      <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, marginBottom: 6 }}>
        {suggestion.rationale}
      </div>
      {(suggestion.changes || []).slice(0, 3).map((change, idx) => (
        <div key={`${change.type}-${idx}`} style={{ fontSize: 11, color: C.textDim, padding: "2px 0", display: "flex", gap: 6 }}>
          <span style={{ color: C.textFaint }}>▸</span>
          <span>{change.label} · {change.impact}</span>
        </div>
      ))}
      {(accepted || keptOriginal) ? (
        <div style={{ marginTop: 4, fontSize: 10, color: accepted ? C.green : C.textDim, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {accepted ? "suggestion accepted" : "original plan kept"}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button type="button" style={{ ...S.smallBtn, borderColor: C.text, color: C.text, fontSize: 10, padding: "4px 8px" }} onClick={onAccept}>Accept</button>
          <button type="button" style={{ ...S.smallBtn, fontSize: 10, padding: "4px 8px" }} onClick={onKeepOriginal}>Keep plan</button>
        </div>
      )}
    </section>
  );
}

// ─── Training adjustment, inline (V6) ────────────────────────────────────────
// The Accept / Keep-plan interaction rendered INSIDE the Today decision block.
// Identical gating and write-path callbacks to AdaptiveTrainingBanner; only
// the frame differs — a ruled sub-section of the decision, not a sibling
// block, so Today has exactly one decision surface. Display-only change.
export function TrainingAdjustmentInline({ suggestion, accepted, keptOriginal, onAccept, onKeepOriginal }) {
  const { C, S } = useTheme();
  if (!suggestion) return null;
  const shouldShow = suggestion.mode !== "keep" || suggestion.title.toLowerCase().includes("quality window");
  if (!shouldShow && !accepted && !keptOriginal) return null;
  const tone = suggestion.mode === "rest" || suggestion.mode === "reduce_volume" || suggestion.mode === "swap_cardio"
    ? C.red
    : suggestion.mode === "keep"
      ? C.green
      : C.text;

  return (
    <div style={{ margin: "0 16px", padding: "10px 0 12px", borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim, fontFamily: C.fontFamily }}>Adjustment</span>
        <span style={{ fontSize: 10, color: tone, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: C.fontFamily }}>{suggestion.mode.replace("_", " ")}</span>
      </div>
      <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, marginBottom: 6 }}>
        {suggestion.rationale}
      </div>
      {(suggestion.changes || []).slice(0, 3).map((change, idx) => (
        <div key={`${change.type}-${idx}`} style={{ fontSize: 11, color: C.textDim, padding: "2px 0", display: "flex", gap: 6 }}>
          <span style={{ color: C.textFaint }}>▸</span>
          <span>{change.label} · {change.impact}</span>
        </div>
      ))}
      {(accepted || keptOriginal) ? (
        <div style={{ marginTop: 4, fontSize: 10, color: accepted ? C.green : C.textDim, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {accepted ? "adjustment accepted" : "original plan kept"}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button type="button" style={{ ...S.smallBtn, borderColor: C.text, color: C.text, fontSize: 10, padding: "5px 10px" }} onClick={onAccept}>Accept adjustment</button>
          <button type="button" style={{ ...S.smallBtn, fontSize: 10, padding: "5px 10px" }} onClick={onKeepOriginal}>Keep plan as written</button>
        </div>
      )}
    </div>
  );
}

// ─── Dynamic Nutrition Card ──────────────────────────────────────────────────
export function DynamicNutritionCard({ recommendation, onAdd }) {
  const { C, S } = useTheme();
  if (!recommendation) return null;
  const gaps = recommendation.gaps || {};
  const tone = recommendation.priority === "done" ? C.green : recommendation.warnings?.length ? C.red : C.text;

  return (
    <section style={{ ...S.block, paddingTop: 14 }}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>Fuel plan</span>
        <span style={{ ...S.blockStat, color: tone }}>{recommendation.priority}</span>
      </div>
      <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", color: C.textDim, fontSize: 14, lineHeight: 1.35, marginBottom: 10 }}>
        {recommendation.summary}
      </div>
      <div style={{ borderTop: `1px solid ${C.line}` }}>
        {[
          ["Protein", gaps.protein, "g"],
          ["Carbs", gaps.carbs, "g"],
          ["Fats", gaps.fats, "g"],
          ["Calories", gaps.calories, "kcal"],
          ["Water", gaps.water, "oz"],
        ].filter(([, value]) => value > 0).slice(0, 4).map(([label, value, unit]) => (
          <div key={label} style={S.ruledRow}>
            <span style={S.ruledLabel}>{label}</span>
            <span style={S.ruledValue}>{value}{unit} remaining</span>
          </div>
        ))}
      </div>
      {recommendation.warnings?.[0] && (
        <div style={{ ...S.annotation, marginTop: 8 }}>{recommendation.warnings[0]}</div>
      )}
      {recommendation.quickAdds?.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {recommendation.quickAdds.map(add => (
            <button type="button" key={add.id} style={{ ...S.smallBtn, textAlign: "left", justifyContent: "space-between" }} onClick={() => onAdd(add)}>
              <span>{add.label}</span>
              <span>{add.calories || 0}kcal · {add.protein || 0}P · {add.carbs || 0}C · {add.fats || 0}F{add.water ? ` · ${add.water}oz` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Guidance list (DO / AVOID / WATCH) ─────────────────────────────────────
// Compact ruled group; only rendered by the card when it has items. The glyph
// carries the section meaning in the single-ink language (no colour spent).
function GuidanceList({ label, items, glyph, C }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: C.textDim, marginBottom: 4 }}>{label}</div>
      {items.map((item, idx) => (
        <div key={idx} style={{ fontSize: 13, color: C.textDim, lineHeight: 1.4, padding: "2px 0", display: "flex", gap: 6 }}>
          <span aria-hidden="true" style={{ color: C.textFaint }}>{glyph}</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Today Coach V2 ─────────────────────────────────────────────────────────
// Compact decision surface: one clear call, why, do/avoid/watch guidance,
// confidence + risk + source transparency, and retained response tracking.
// Falls back gracefully if handed a v1-shaped decision (no do/avoid/watch).
export function TodayDecisionCard({
  decision = null,
  currentResponse = null,
  onResponse = null,
  feedbackBrief = "",
  compact = false,
  cta = null,
}) {
  const { C, S } = useTheme();
  // V2.6: the four session-feedback buttons live under a collapsible "After
  // session" area so they stop competing with the primary Accept / Keep-Plan
  // action. Auto-open once a response has been recorded so the choice stays
  // visible. The onResponse write path is unchanged.
  const [feedbackOpen, setFeedbackOpen] = useState(Boolean(currentResponse));
  const [detailOpen, setDetailOpen] = useState(false);
  if (!decision) return null;

  const isActive = Boolean(onResponse);
  const responseButtons = [
    { value: "followed", label: "Followed" },
    { value: "modified", label: "Modified" },
    { value: "ignored", label: "Ignored" },
    { value: "skipped", label: "Skipped" },
  ];

  // V13 · the call renders as an inverted ink Stamp — no colored words. Red
  // stays reserved for failures; a cautious call is a limiter, not an error.
  const callTone = C.text;
  const STAMP_TEXT = { push: "Push", maintain: "On plan", modify: "Modify", recover: "Recover" };
  const stampText = STAMP_TEXT[decision.call] || String(decision.call).replace(/_/g, " ");
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit" });

  const doList = decision.doList || [];
  const avoidList = decision.avoidList || [];
  const watchList = decision.watchList || [];
  const hasGuidance = doList.length > 0 || avoidList.length > 0 || watchList.length > 0;
  const badges = decision.sourceBadges || [];
  const risk = decision.risk;
  const riskTone = risk === "High" ? C.red : risk === "Medium" ? C.textDim : C.text;
  const hasTransparency = badges.length > 0 || Boolean(decision.confidence) || Boolean(risk);

  // Source / confidence / risk transparency. On the compact Today surface this
  // lives INSIDE the "Coach detail" disclosure so the collapsed first screen
  // stays clean; the full card renders it inline. Rendered only when it carries
  // something — an empty conf/risk line is pure noise at the top of Today.
  const transparencyRow = hasTransparency ? (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
      {badges.map((b) => (
        <span key={b} style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim, border: `1px solid ${C.lineBright}`, padding: "2px 6px" }}>{b}</span>
      ))}
      <span style={{ flex: 1 }} />
      {decision.confidence && (
        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint }}>Conf: {decision.confidence}</span>
      )}
      {risk && (
        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: riskTone }}>Risk: {risk}</span>
      )}
    </div>
  ) : null;

  return (
    <section style={{ ...S.block, paddingTop: 18, paddingBottom: 14 }}>
      <div style={{ ...S.blockHead, alignItems: "center", marginBottom: 12 }}>
        <span style={S.blockTitle}>Today coach · {dateLabel}</span>
        <Stamp>{stampText}</Stamp>
      </div>
      <div style={{ fontFamily: S.fontSerif, fontSize: 27, fontWeight: 500, lineHeight: 1.12, letterSpacing: "-0.02em", color: C.text, marginBottom: 8 }}>
        {decision.title}
      </div>
      {decision.subtitle && (
        <div style={{ fontFamily: S.fontSerif, fontSize: 14.5, fontStyle: "italic", color: C.textDim, lineHeight: 1.45, marginBottom: 10 }}>
          {decision.subtitle}
        </div>
      )}
      {cta && cta.label && (
        <button
          type="button"
          onClick={cta.onGo}
          style={{ width: "100%", background: C.text, color: C.bg, border: `1px solid ${C.text}`, padding: "17px 12px", fontFamily: S.fontAnnot, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500, cursor: "pointer", marginTop: 4, marginBottom: 4 }}
        >
          {cta.label} →
        </button>
      )}
      {!compact && decision.primaryAction && (
        <div style={{ marginBottom: hasGuidance ? 4 : 8, paddingBottom: 8, paddingLeft: 10, borderLeft: `2px solid ${callTone}`, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.textDim, marginBottom: 3 }}>Do next</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.4 }}>
            {decision.primaryAction}
          </div>
        </div>
      )}

      {compact && (hasGuidance || decision.reasons?.length > 0 || decision.trainingAction || decision.fuelAction) && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.line}` }}>
          <button
            type="button"
            onClick={() => setDetailOpen(o => !o)}
            aria-expanded={detailOpen}
            style={{ width: "100%", minHeight: 42, display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: "10px 0", cursor: "pointer", fontFamily: C.monoFamily }}
          >
            <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim }}>Coach detail</span>
            <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>{detailOpen ? "▲ hide" : "▼ show why"}</span>
          </button>
          {detailOpen && (
            <div style={{ paddingBottom: 8 }}>
              {hasGuidance ? (
                <div style={{ paddingBottom: 8, borderBottom: `1px solid ${C.line}` }}>
                  <GuidanceList label="Do" items={doList} glyph="▸" C={C} />
                  <GuidanceList label="Avoid" items={avoidList} glyph="✕" C={C} />
                  <GuidanceList label="Watch" items={watchList} glyph="◦" C={C} />
                </div>
              ) : (
                <>
                  {decision.trainingAction && (
                    <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.4, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${C.line}` }}>
                      {decision.trainingAction}
                    </div>
                  )}
                  {decision.fuelAction && (
                    <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.4, marginBottom: 8 }}>
                      <strong>Fuel:</strong> {decision.fuelAction}
                    </div>
                  )}
                </>
              )}
              {decision.reasons && decision.reasons.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: C.textDim, marginBottom: 4 }}>Why</div>
                  {decision.reasons.slice(0, 4).map((reason, idx) => (
                    <div key={idx} style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.4, padding: "2px 0" }}>
                      ▸ {reason}
                    </div>
                  ))}
                </div>
              )}
              {transparencyRow}
            </div>
          )}
        </div>
      )}

      {!compact && (
        <>
          {/* DO / AVOID / WATCH — only sections that have items render. */}
          {hasGuidance ? (
            <div style={{ paddingBottom: 8, borderBottom: `1px solid ${C.line}` }}>
              <GuidanceList label="Do" items={doList} glyph="▸" C={C} />
              <GuidanceList label="Avoid" items={avoidList} glyph="✕" C={C} />
              <GuidanceList label="Watch" items={watchList} glyph="◦" C={C} />
            </div>
          ) : (
            <>
              {/* v1 fallback */}
              {decision.trainingAction && (
                <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.4, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${C.line}` }}>
                  {decision.trainingAction}
                </div>
              )}
              {decision.fuelAction && (
                <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.4, marginBottom: 8 }}>
                  <strong>Fuel:</strong> {decision.fuelAction}
                </div>
              )}
            </>
          )}

          {/* Why — 2-4 reasons */}
          {decision.reasons && decision.reasons.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: C.textDim, marginBottom: 4 }}>Why</div>
              {decision.reasons.slice(0, 4).map((reason, idx) => (
                <div key={idx} style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.4, padding: "2px 0" }}>
                  ▸ {reason}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Source / confidence / risk transparency row */}
      {!compact && transparencyRow}

      {feedbackBrief && (
        <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.45, paddingTop: 8, marginTop: 2, borderTop: `1px solid ${C.line}`, letterSpacing: "0.02em" }}>
          {feedbackBrief}
        </div>
      )}
      {isActive && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
          <button
            type="button"
            onClick={() => setFeedbackOpen(o => !o)}
            aria-expanded={feedbackOpen}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: C.monoFamily }}
          >
            <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim }}>
              After session{currentResponse ? ` · ${currentResponse}` : ""}
            </span>
            <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: currentResponse ? C.green : C.textFaint }}>
              {feedbackOpen ? "▲ hide" : currentResponse ? "▾ logged" : "▾ log how it went"}
            </span>
          </button>
          {feedbackOpen && (
            <>
              {decision.responsePrompt && (
                <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, marginTop: 8, marginBottom: 6 }}>
                  {decision.responsePrompt}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: decision.responsePrompt ? 0 : 8 }}>
                {responseButtons.map((btn) => (
                  <button
                    key={btn.value}
                    type="button"
                    onClick={() => onResponse(btn.value)}
                    style={{
                      ...S.smallBtn,
                      backgroundColor: currentResponse === btn.value ? C.green : "transparent",
                      color: currentResponse === btn.value ? C.bg : C.text,
                      borderColor: currentResponse === btn.value ? C.green : C.line,
                      fontSize: 11,
                      padding: "6px 8px",
                      fontWeight: currentResponse === btn.value ? 600 : 400,
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
