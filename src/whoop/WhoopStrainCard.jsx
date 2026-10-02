// src/whoop/WhoopStrainCard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Whoop Strain display card (V3.0 Whoop Display Cards)
//
// Compact, display-only card for the Recovery tab. Shows Whoop day strain (from
// the cycle record), the highest workout strain of the day, and average / max
// heart rate. Display only — it does NOT feed the recovery algorithm and does
// NOT auto-complete workouts. Missing fields render as "—".
// ─────────────────────────────────────────────────────────────────────────────

import { useTheme } from "../theme";

function fmt(v, unit = "", digits = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const rounded = digits > 0 ? n.toFixed(digits) : Math.round(n);
  return `${rounded}${unit}`;
}

// Pick the workout with the highest strain (defensive over a possibly-empty or
// non-array input). Returns null when there are no scored workouts.
function topWorkout(workouts) {
  const list = Array.isArray(workouts) ? workouts.filter(Boolean) : [];
  if (list.length === 0) return null;
  return list.reduce((best, w) => {
    const s = Number(w?.strain);
    const bs = Number(best?.strain);
    if (!Number.isFinite(s)) return best;
    if (!Number.isFinite(bs)) return w;
    return s > bs ? w : best;
  }, list[0]);
}

function hasStrain(cycle, workouts) {
  const cycleHas = cycle && [cycle.strain, cycle.avgHr, cycle.maxHr].some((v) => v !== null && v !== undefined);
  const workoutHas = Array.isArray(workouts) && workouts.some(Boolean);
  return !!(cycleHas || workoutHas);
}

export function WhoopStrainCard({ cycle = null, workouts = [], date = null }) {
  const { C } = useTheme();
  const annot = C.monoFamily || C.fontFamily;
  const present = hasStrain(cycle, workouts);
  const workout = topWorkout(workouts);

  const shell = {
    border: `1px solid ${C.line}`,
    borderRadius: C.cardRadius ?? 0,
    background: C.bg,
    padding: "10px 12px",
    marginTop: 10,
  };
  const head = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8 };
  const title = { fontFamily: annot, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, fontWeight: 600 };
  const source = { fontFamily: annot, fontSize: 10, letterSpacing: "0.05em", color: C.textFaint };
  const row = { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderTop: `1px solid ${C.line}` };
  const rLabel = { fontFamily: annot, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint };
  const rValue = { fontFamily: annot, fontSize: 12, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={shell}>
      <div style={head}>
        <span style={title}>Strain{date ? ` · ${date}` : ""}</span>
        <span style={source}>Source: Whoop</span>
      </div>

      {!present ? (
        <div style={{ fontFamily: annot, fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>
          Strain not available yet.
        </div>
      ) : (
        <>
          <div style={row}><span style={rLabel}>Day strain</span><span style={rValue}>{fmt(cycle?.strain, "", 1)}</span></div>
          <div style={row}><span style={rLabel}>Workout strain</span><span style={rValue}>{fmt(workout?.strain, "", 1)}</span></div>
          <div style={row}><span style={rLabel}>Avg HR</span><span style={rValue}>{fmt(cycle?.avgHr ?? workout?.avgHr, " bpm")}</span></div>
          <div style={row}><span style={rLabel}>Max HR</span><span style={rValue}>{fmt(cycle?.maxHr ?? workout?.maxHr, " bpm")}</span></div>
        </>
      )}
    </div>
  );
}

export default WhoopStrainCard;
