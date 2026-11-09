// src/whoop/WhoopRecoveryCard.jsx
// Whoop Recovery display card
//
// Compact, display-only card for the Recovery tab. Shows Whoop's recovery score
// and the biometrics behind it (HRV, RHR, SpO₂, skin temp). This card is purely
// informational — it does NOT feed the recovery algorithm, Today Coach, or any
// scoring. Missing fields render as "—" and a missing record shows a soft
// "not available yet" note rather than an error.

import { useTheme } from "../theme";

// Format a numeric value defensively: null/undefined → em dash, else rounded.
function fmt(v, unit = "", digits = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const rounded = digits > 0 ? n.toFixed(digits) : Math.round(n);
  return `${rounded}${unit}`;
}

// scored → has a recovery score; pending → connected but user still calibrating
// or score not yet computed; missing → no record for the day.
function recoveryStatus(recovery) {
  if (!recovery) return "missing";
  if (recovery.calibrating) return "pending";
  return recovery.recoveryScore === null || recovery.recoveryScore === undefined ? "pending" : "scored";
}

export function WhoopRecoveryCard({ recovery = null, date = null }) {
  const { C, S } = useTheme();
  const status = recoveryStatus(recovery);
  const annot = C.monoFamily || C.fontFamily;

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
        <span style={title}>Recovery{date ? ` · ${date}` : ""}</span>
        <span style={source}>Source: Whoop</span>
      </div>

      {status === "missing" ? (
        <div style={{ fontFamily: annot, fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>
          Recovery not available yet.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
            <span style={{ fontFamily: S.fontSerif, fontSize: 26, fontWeight: 500, color: C.text, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
              {fmt(recovery?.recoveryScore)}
            </span>
            <span style={{ fontFamily: annot, fontSize: 10, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              /100 · {status}
            </span>
          </div>
          <div style={row}><span style={rLabel}>HRV (rmssd)</span><span style={rValue}>{fmt(recovery?.hrvRmssd, " ms", 1)}</span></div>
          <div style={row}><span style={rLabel}>Resting HR</span><span style={rValue}>{fmt(recovery?.rhr, " bpm")}</span></div>
          <div style={row}><span style={rLabel}>SpO₂</span><span style={rValue}>{fmt(recovery?.spo2, "%", 1)}</span></div>
          <div style={row}><span style={rLabel}>Skin temp</span><span style={rValue}>{fmt(recovery?.skinTempC, "°C", 1)}</span></div>
        </>
      )}
    </div>
  );
}

export default WhoopRecoveryCard;
