// src/MuscleVolumeSection.jsx
// Per-muscle weekly volume ledger for Progress → Overview. Each trained
// muscle renders a landmark bar (MEV → MAV band → MRV) with the week's set
// count positioned on it, a delta vs last week, and a status word. Balance
// ratios sit behind a disclosure. Unmapped sets are surfaced, never hidden.

import { useMemo, useState } from "react";
import { useTheme } from "./theme";
import { buildVolumeReport } from "./muscleVolume";
import { MethodLine } from "./whitepaper";

function LandmarkBar({ row, C }) {
  // Scale bar 0 → MRV×1.15 so above-MRV overflows visibly.
  const max = row.landmarks.mrv * 1.15;
  const pct = (v) => `${Math.min(100, (v / max) * 100)}%`;
  const fill = Math.min(100, (row.sets / max) * 100);
  const tone = row.tone === "warn" ? C.red : row.tone === "watch" ? C.textDim : C.text;
  const l = row.landmarks;
  // The bar is purely visual; give assistive tech a plain-language equivalent of
  // where this week's sets land relative to the MEV / MAV band / MRV landmarks.
  const barLabel = `${row.label}: ${row.sets} hard sets this week, ${classLabel(row) || "no landmark"}. Productive range ${l.mavLo}–${l.mavHi} sets (MEV ${l.mev}, MRV ${l.mrv}).`;
  return (
    <div
      role="img"
      aria-label={barLabel}
      style={{ position: "relative", height: 6, background: C.line, marginTop: 5 }}
    >
      {/* MAV band */}
      <div style={{ position: "absolute", left: pct(row.landmarks.mavLo), width: `calc(${pct(row.landmarks.mavHi)} - ${pct(row.landmarks.mavLo)})`, top: 0, bottom: 0, background: C.lineBright }} />
      {/* fill */}
      <div style={{ position: "absolute", left: 0, width: `${fill}%`, top: 0, bottom: 0, background: tone, opacity: 0.85 }} />
      {/* MEV + MRV ticks */}
      <div style={{ position: "absolute", left: pct(row.landmarks.mev), top: -2, bottom: -2, width: 1, background: C.textFaint }} />
      <div style={{ position: "absolute", left: pct(row.landmarks.mrv), top: -2, bottom: -2, width: 1, background: C.textFaint }} />
    </div>
  );
}

export function MuscleVolumeSection({ data }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const report = useMemo(() => buildVolumeReport(data), [data]);
  const [ratiosOpen, setRatiosOpen] = useState(false);
  const [showUntrained, setShowUntrained] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Muscle volume audit</span>
        {report.ready && <span style={S.blockStat}>WK OF {report.weekStart.slice(5)}</span>}
      </div>

      {!report.ready ? (
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>{report.note}</div>
      ) : (
        <>
          <div style={{ fontFamily: S.fontSerif, fontSize: 15, color: report.flagCount ? C.text : C.textDim, lineHeight: 1.35, marginBottom: 8 }}>
            {report.headline}
          </div>

          {/* Plain-language primer so a normal athlete can read the ledger below
              without knowing the jargon. Display-only — changes no report math. */}
          <div style={{ marginBottom: 10 }}>
            <button type="button" onClick={() => setGuideOpen(o => !o)} aria-expanded={guideOpen}
              aria-label={guideOpen ? "Hide how to read the muscle volume audit" : "Show how to read the muscle volume audit"}
              style={{ background: "none", border: "none", padding: "0 8px", minHeight: 44, display: "inline-flex", alignItems: "center", cursor: "pointer", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim }}>
              {guideOpen ? "▲" : "▾"} How to read this
            </button>
            {guideOpen && (
              <div style={{ marginTop: 6, borderTop: `1px solid ${C.line}`, paddingTop: 8, fontSize: 11.5, color: C.textDim, lineHeight: 1.6, fontFamily: mono }}>
                <p style={{ margin: "0 0 6px" }}>
                  <strong style={{ color: C.text }}>Hard set</strong> — one completed working set taken close to failure. Sets where a muscle is the <strong style={{ color: C.text }}>primary</strong> mover count as one; sets where it only assists (<strong style={{ color: C.text }}>secondary</strong>) count as half.
                </p>
                <p style={{ margin: "0 0 6px" }}>
                  The number beside each muscle is <strong style={{ color: C.text }}>this week&apos;s</strong> sets; the small <span style={{ color: C.textFaint }}>±</span> figure is the change vs <strong style={{ color: C.text }}>last week</strong>. On each bar, the pale marked <strong style={{ color: C.text }}>band</strong> is the productive target range — landing inside it is the goal.
                </p>
                <p style={{ margin: 0 }}>
                  <strong style={{ color: C.text }}>MEV</strong> — minimum sets to grow at all. <strong style={{ color: C.text }}>MAV</strong> — the sweet-spot range where most growth happens. <strong style={{ color: C.text }}>MRV</strong> — the most you can recover from; past it you accumulate fatigue faster than you adapt.
                </p>
              </div>
            )}
          </div>

          {(showUntrained ? report.rows : report.rows.filter(r => r.sets > 0)).map(row => (
            <div key={row.key} style={{ padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 11.5, color: C.text, fontFamily: mono, letterSpacing: "0.04em" }}>{row.label}</span>
                <span style={{ fontSize: 11, fontFamily: mono, color: row.tone === "warn" ? C.red : C.textDim, fontVariantNumeric: "tabular-nums" }}>
                  {row.sets} sets
                  {row.delta !== null && row.delta !== 0 && <span style={{ color: C.textFaint }}> · {row.delta > 0 ? "+" : ""}{row.delta}</span>}
                  {" · "}{classLabel(row)}
                </span>
              </div>
              <LandmarkBar row={row} C={C} />
            </div>
          ))}

          <button type="button" onClick={() => setShowUntrained(v => !v)} aria-expanded={showUntrained}
            style={{ background: "none", border: "none", padding: "0 8px", minHeight: 44, display: "inline-flex", alignItems: "center", cursor: "pointer", fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>
            {showUntrained ? "▲ hide untrained muscles" : "▾ show untrained muscles"}
          </button>

          {report.unmappedSets > 0 && (
            <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.5, marginTop: 8, fontFamily: mono }}>
              {report.unmappedSets} sets unmapped ({report.unmappedNames.slice(0, 3).join(", ")}{report.unmappedNames.length > 3 ? "…" : ""}) — not counted toward any muscle.
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={() => setRatiosOpen(o => !o)} aria-expanded={ratiosOpen}
              style={{ background: "none", border: "none", padding: "0 8px", minHeight: 44, display: "inline-flex", alignItems: "center", cursor: "pointer", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim }}>
              {ratiosOpen ? "▲" : "▾"} Balance ratios
            </button>
            {ratiosOpen && (
              <div style={{ marginTop: 6 }}>
                {report.ratios.map(r => (
                  <div key={r.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderBottom: `1px solid ${C.line}`, fontSize: 11.5, fontFamily: mono }}>
                    <span style={{ color: C.textDim }}>{r.label} <span style={{ color: C.textFaint }}>· {r.band}</span></span>
                    <span style={{ color: r.ok ? C.text : C.red, fontVariantNumeric: "tabular-nums" }}>{r.value ?? "—"}{r.ok ? "" : " ⚑"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <MethodLine
            testId="method-volume"
            method="hard set = completed set · secondaries count 0.5 · ranges are published landmarks, not prescriptions"
            detail={
              <>
                Each muscle's bar marks three research landmarks: <strong>MEV</strong>, the minimum weekly sets that reliably produce growth; the <strong>MAV band</strong>, where most productive training lives; and <strong>MRV</strong>, the most you can recover from — past it, more sets subtract. Your week's count sits on that scale. These are population ranges from the hypertrophy literature, so treat them as a map, not a rulebook: your recovery data above is the tiebreaker when the two disagree.
              </>
            }
          />
        </>
      )}
    </div>
  );
}

function classLabel(row) {
  switch (row.status) {
    case "below_mev": return "below MEV";
    case "productive": return "MEV–MAV";
    case "optimal": return "within MAV";
    case "high": return "MAV–MRV";
    case "above_mrv": return "above MRV";
    default: return "";
  }
}
