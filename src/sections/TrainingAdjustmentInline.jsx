// src/sections/TrainingAdjustmentInline.jsx
// A suggested change to today's session, shown inside Today's call so the
// call stays the one decision on the screen. Accept or keep the plan; either
// answer is recorded and the buttons give way to a line saying which.
const MODE_LABEL = {
  rest: "Rest instead",
  reduce_volume: "Less volume",
  reduce_intensity: "Less intensity",
  swap_cardio: "Easier cardio",
  keep: "As planned",
};

export function TrainingAdjustmentInline({ suggestion, accepted, keptOriginal, onAccept, onKeepOriginal }) {
  if (!suggestion) return null;
  const shouldShow = suggestion.mode !== "keep" || suggestion.title.toLowerCase().includes("quality window");
  if (!shouldShow && !accepted && !keptOriginal) return null;
  const changes = (suggestion.changes || []).slice(0, 3);
  return (
    <section aria-labelledby="adjustment-title" style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 id="adjustment-title" className="t-ss grow">Suggested change</h3>
        <span className="tag tag-f">{MODE_LABEL[suggestion.mode] || suggestion.mode}</span>
      </div>
      <p className="t-bs">{suggestion.title}</p>
      <p className="t-s c2">{suggestion.rationale}</p>
      {changes.length > 0 && (
        <ul className="lst" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {changes.map((change, idx) => <li key={`${change.type}-${idx}`}>{change.label} <span className="c2">({change.impact})</span></li>)}
        </ul>
      )}
      {accepted || keptOriginal ? (
        <p className="t-s c2" role="status">{accepted ? "Change accepted." : "Plan kept as written."}</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn btn-s btn-sm" onClick={onAccept}>Accept the change</button>
          <button type="button" className="btn btn-g btn-sm" onClick={onKeepOriginal}>Keep the plan</button>
        </div>
      )}
    </section>
  );
}
