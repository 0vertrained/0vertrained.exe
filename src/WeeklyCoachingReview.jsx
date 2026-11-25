import { useMemo, useState } from "react";
import { useTheme } from "./theme";

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

export function WeeklyCoachingReview({ review, updateEntryAtDate, showToast }) {
  const { C, S } = useTheme();
  const [waist, setWaist] = useState("");
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


      <div style={{ ...S.annotation, marginTop: 10 }}>
        A read on the week, not a change: targets move only when you edit them in Settings.
      </div>
    </div>
  );
}

export default WeeklyCoachingReview;
