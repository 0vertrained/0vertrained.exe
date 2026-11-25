import { useTheme } from "../theme";

// Training adjustment, inline
// The Accept / Keep-plan interaction rendered INSIDE the Today decision block,
// a ruled sub-section of the decision rather than a sibling block, so Today
// has exactly one decision surface.
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
