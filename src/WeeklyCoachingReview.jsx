import { useMemo, useState } from "react";
import { useTheme } from "./theme";
import { buildWeeklyReviewResponse } from "./weeklyCoachReview";
import { buildPlanVersion } from "./coachingOutcomeLoop";

const MODIFICATION_OPTIONS = [
  { id: "continue", label: "Keep plan unchanged" },
  { id: "calories", label: "Reduce calories by 125" },
  { id: "activity", label: "Add 1,000 daily steps" },
  { id: "recovery", label: "Reduce optional volume/cardio" },
  { id: "diet_break", label: "Use a 7-day maintenance break" },
];

function toneFor(kind) {
  if (kind === "recovery" || kind === "diet_break") return "caution";
  if (kind === "calories" || kind === "activity") return "action";
  if (kind === "collect_data" || kind === "adherence") return "neutral";
  return "good";
}

function Metric({ label, value, sub, tone = "neutral" }) {
  const { C } = useTheme();
  const color = tone === "good" ? C.green : tone === "caution" ? C.amber : tone === "bad" ? C.red : C.text;
  return (
    <div style={{ background: C.bg, padding: "9px 7px", minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 9.5, color: C.textDim, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function WeeklyCoachingReview({ review, data, settings = {}, updateEntryAtDate, showToast, onSaveCoachingSettings }) {
  const { C, S } = useTheme();
  const [editing, setEditing] = useState(false);
  const [modifiedKind, setModifiedKind] = useState("continue");
  const [reason, setReason] = useState("");
  const [waist, setWaist] = useState("");
  const persisted = data?.[review.weekEndKey]?.intelligence?.weeklyCoachReviewResponse || null;
  const tone = toneFor(review.recommendation.kind);
  const recommendationColor = tone === "good" ? C.green : tone === "caution" ? C.amber : tone === "action" ? C.text : C.textDim;

  const metrics = useMemo(() => {
    const weight = review.trend.weightDelta == null ? "—" : `${review.trend.weightDelta > 0 ? "+" : ""}${review.trend.weightDelta} lb`;
    const waistDelta = review.trend.waistDelta == null ? "—" : `${review.trend.waistDelta > 0 ? "+" : ""}${review.trend.waistDelta} in`;
    const strength = review.strength?.status === "stable" ? "Stable" : review.strength?.status === "action" ? "Action" : review.strength?.status === "watch" ? "Watch" : "Building";
    const recovery = review.recoveryTrend?.status || "stable";
    return [
      { label: "Weight trend", value: weight, sub: `${review.currentWindow.weightCount} weigh-ins`, tone: review.trend.weightDelta != null && review.trend.weightDelta < 0 ? "good" : "neutral" },
      { label: "Waist", value: waistDelta, sub: review.trend.waistCurrent ? `${review.trend.waistCurrent} in latest` : "Add weekly", tone: review.trend.waistDelta != null && review.trend.waistDelta < 0 ? "good" : "neutral" },
      { label: "Training", value: `${review.adherence.training}%`, sub: `${review.metrics.workoutDays} sessions`, tone: review.adherence.training >= 80 ? "good" : "neutral" },
      { label: "Protein", value: `${review.adherence.protein}%`, sub: `${review.metrics.avgProtein}g avg`, tone: review.adherence.protein >= 80 ? "good" : "neutral" },
      { label: "Strength", value: strength, sub: `${review.strength?.comparisons?.length || 0} lifts`, tone: strength === "Stable" ? "good" : strength === "Action" ? "bad" : "neutral" },
      { label: "Recovery", value: recovery, sub: `${review.metrics.avgSleep || 0}h sleep`, tone: recovery === "improving" ? "good" : recovery === "strained" ? "bad" : recovery === "watch" ? "caution" : "neutral" },
    ];
  }, [review]);

  const persist = (response, options = {}) => {
    if (!updateEntryAtDate) return;
    const shouldActivate = response === "approved" || response === "modified";
    const previousPlan = settings?.coachingSystem?.activePlan || null;
    const planVersion = shouldActivate
      ? buildPlanVersion({ review, response, modifiedKind: options.modifiedKind, settings, previousPlan })
      : null;
    const payload = buildWeeklyReviewResponse(review, response, { ...options, planVersion });
    updateEntryAtDate(review.weekEndKey, "intelligence.weeklyCoachReviewResponse", payload);
    if (planVersion && onSaveCoachingSettings) {
      const existingHistory = settings?.coachingSystem?.planHistory || [];
      onSaveCoachingSettings({
        ...settings,
        goals: { ...(settings.goals || {}), ...(planVersion.snapshot?.goals || {}) },
        coachingPhase: { ...(settings.coachingPhase || {}), phase: planVersion.snapshot?.phase || review.phase },
        coachingSystem: {
          ...(settings.coachingSystem || {}),
          activePlan: planVersion,
          planHistory: [...existingHistory.filter((item) => item?.id !== planVersion.id), planVersion].slice(-16),
        },
      });
    }
    setEditing(false);
    showToast?.(response === "approved" ? "Next week approved and activated" : response === "modified" ? "Modified plan activated" : "Recommendation held");
  };

  const saveWaist = () => {
    const value = Number.parseFloat(waist);
    if (!Number.isFinite(value) || value <= 0) {
      showToast?.("Enter a valid waist measurement");
      return;
    }
    updateEntryAtDate?.(review.weekEndKey, "body.waist", String(value));
    setWaist("");
    showToast?.("Waist measurement saved");
  };

  return (
    <div style={{ padding: 16, borderBottom: `1px solid ${C.line}`, background: C.block }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.16em", textTransform: "uppercase" }}>Weekly coaching review</div>
          <div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 4 }}>
            {review.phase.replace(/_/g, " ")} · {review.observationMode ? "Observation mode" : `${review.calibration?.authority || "suggest"} authority`}
          </div>
        </div>
        <span style={{ fontSize: 10, color: recommendationColor, letterSpacing: "0.1em", textTransform: "uppercase" }}>{review.confidence} confidence</span>
      </div>

      <div style={{ fontFamily: S.fontSerif, fontSize: 23, fontWeight: 600, color: recommendationColor, lineHeight: 1.15, marginTop: 10 }}>
        {review.recommendation.title}
      </div>
      <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.55, marginTop: 8 }}>{review.recommendation.summary}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: C.lineBright, border: `1px solid ${C.lineBright}`, marginTop: 13 }}>
        {metrics.map((metric) => <Metric key={metric.label} {...metric} />)}
      </div>

      <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: C.text, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>Evidence</div>
        {(review.recommendation.evidence || []).slice(0, 4).map((item, index) => (
          <div key={`${item}-${index}`} style={{ display: "flex", gap: 7, fontSize: 11.5, color: C.textDim, lineHeight: 1.45, padding: "2px 0" }}><span style={{ color: C.textFaint }}>◇</span><span>{item}</span></div>
        ))}
        {(review.recommendation.blockers || []).slice(0, 2).map((item, index) => (
          <div key={`${item}-${index}`} style={{ display: "flex", gap: 7, fontSize: 11, color: C.textFaint, lineHeight: 1.45, padding: "2px 0" }}><span>—</span><span>{item}</span></div>
        ))}
      </div>

      {!review.trend.waistCurrent && (
        <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Waist in"
            value={waist}
            onChange={(event) => setWaist(event.target.value)}
            style={{ flex: 1, minWidth: 0, background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`, padding: "9px 10px", fontFamily: C.fontFamily, fontSize: 12 }}
          />
          <button type="button" onClick={saveWaist} style={{ ...S.smallBtn, padding: "9px 12px" }}>Save waist</button>
        </div>
      )}

      {persisted ? (
        <div style={{ marginTop: 12, border: `1px solid ${C.lineBright}`, padding: "10px 12px", background: C.bg }}>
          <div style={{ fontSize: 10, color: C.green, letterSpacing: "0.12em", textTransform: "uppercase" }}>Decision recorded · {persisted.response}</div>
          <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 5, lineHeight: 1.45 }}>
            {persisted.response === "modified" ? `Modified to ${String(persisted.modifiedKind || "custom").replace(/_/g, " ")}.` : persisted.reason || "This response will be used to calibrate future recommendations."}
          </div>
        </div>
      ) : !editing ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 7, marginTop: 14 }}>
          <button type="button" onClick={() => persist("approved")} style={{ padding: "11px 12px", background: C.text, color: C.bg, border: `1px solid ${C.text}`, fontFamily: C.fontFamily, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
            Approve next week
          </button>
          <button type="button" onClick={() => setEditing(true)} style={{ ...S.smallBtn, padding: "10px 12px" }}>Modify</button>
          <button type="button" onClick={() => persist("rejected", { reason: "Held for more data" })} style={{ ...S.smallBtn, padding: "10px 12px" }}>Hold</button>
        </div>
      ) : (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: C.text, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 7 }}>Modify next week</div>
          <select value={modifiedKind} onChange={(event) => setModifiedKind(event.target.value)} style={{ width: "100%", background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`, padding: "9px 10px", fontFamily: C.fontFamily, fontSize: 12 }}>
            {MODIFICATION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional reason" style={{ width: "100%", boxSizing: "border-box", marginTop: 7, background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`, padding: "9px 10px", fontFamily: C.fontFamily, fontSize: 12 }} />
          <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
            <button type="button" onClick={() => persist("modified", { modifiedKind, reason })} style={{ flex: 1, padding: "10px 12px", background: C.text, color: C.bg, border: `1px solid ${C.text}`, fontFamily: C.fontFamily, fontSize: 11, cursor: "pointer" }}>Save modification</button>
            <button type="button" onClick={() => setEditing(false)} style={{ ...S.smallBtn, padding: "9px 12px" }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.annotation, marginTop: 10 }}>
        Suggest-only. No calorie, training, cardio, or recovery target changes until you approve or modify the recommendation.
      </div>
    </div>
  );
}

export default WeeklyCoachingReview;
