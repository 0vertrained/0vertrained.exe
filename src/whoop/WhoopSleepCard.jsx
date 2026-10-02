// src/whoop/WhoopSleepCard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Whoop Sleep display card (V3.0 Whoop Display Cards)
//
// Compact, display-only card for the Recovery tab. Shows Whoop's nightly sleep:
// asleep / in-bed duration, efficiency, and respiratory rate. Display only — it
// does NOT feed the recovery algorithm. Missing fields render as "—" and a
// missing record shows a soft "not available yet" note rather than an error.
// ─────────────────────────────────────────────────────────────────────────────

import { useTheme } from "../theme";

function fmt(v, unit = "", digits = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const rounded = digits > 0 ? n.toFixed(digits) : Math.round(n);
  return `${rounded}${unit}`;
}

// Format minutes as "Hh Mm"; null → em dash.
function fmtDuration(min) {
  if (min === null || min === undefined || Number.isNaN(Number(min))) return "—";
  const total = Math.round(Number(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// A sleep record is "present" if it carries any usable duration/quality field.
function hasSleep(sleep) {
  if (!sleep) return false;
  return [sleep.asleepMin, sleep.inBedMin, sleep.efficiencyPct, sleep.respiratoryRate]
    .some((v) => v !== null && v !== undefined);
}

export function WhoopSleepCard({ sleep = null, date = null }) {
  const { C } = useTheme();
  const annot = C.monoFamily || C.fontFamily;
  const present = hasSleep(sleep);

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
        <span style={title}>Sleep{date ? ` · ${date}` : ""}</span>
        <span style={source}>Source: Whoop</span>
      </div>

      {!present ? (
        <div style={{ fontFamily: annot, fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>
          Sleep not available yet.
        </div>
      ) : (
        <>
          <div style={row}><span style={rLabel}>Asleep</span><span style={rValue}>{fmtDuration(sleep?.asleepMin)}</span></div>
          <div style={row}><span style={rLabel}>In bed</span><span style={rValue}>{fmtDuration(sleep?.inBedMin)}</span></div>
          <div style={row}><span style={rLabel}>Efficiency</span><span style={rValue}>{fmt(sleep?.efficiencyPct, "%", 1)}</span></div>
          <div style={row}><span style={rLabel}>Respiratory rate</span><span style={rValue}>{fmt(sleep?.respiratoryRate, " br/min", 1)}</span></div>
        </>
      )}
    </div>
  );
}

export default WhoopSleepCard;
