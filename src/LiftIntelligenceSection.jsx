// src/LiftIntelligenceSection.jsx
// V12 · Two Progress → Overview sections:
//   1. LiftIntelligenceSection — per-lift RIR-effective e1RM sparkline with
//      a progressing / stalled / regressing verdict and a concrete stall
//      suggestion (e1rmTrend.js).
//   2. MuscleRecencyMap — days since each muscle was last trained, answering
//      "what's actually fresh today?" (muscleVolume.buildMuscleRecency).
// Both display-only.

import { useMemo, useState } from "react";
import { useTheme } from "./theme";
import { buildLiftIntelligence } from "./e1rmTrend";
import { buildMuscleRecency } from "./muscleVolume";
import { getTodayKey } from "./constants";

function Spark({ series, C, width = 90, height = 22 }) {
  if (!series || series.length < 2) return null;
  const vals = series.map(p => p.e1rm);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const pts = series.map((p, i) =>
    `${(2 + (i / (series.length - 1)) * (width - 4)).toFixed(1)},${(height - 3 - ((p.e1rm - min) / span) * (height - 6)).toFixed(1)}`
  ).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={C.text} strokeWidth="1.3" />
    </svg>
  );
}

const VERDICT_LABEL = { progressing: "↑ progressing", stalled: "→ stalled", regressing: "↓ regressing", building: "· building" };

export function LiftIntelligenceSection({ data }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const report = useMemo(() => buildLiftIntelligence(data), [data]);
  const [openLift, setOpenLift] = useState(null);

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Lift intelligence</span>
        {report.ready && <span style={S.blockStat}>e1RM · RIR-adjusted</span>}
      </div>
      {!report.ready ? (
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
          Log a few sessions per lift to unlock e1RM trends and stall detection.
        </div>
      ) : (
        <>
          {report.lifts.map(l => {
            const tone = l.verdict.status === "regressing" ? C.red : l.verdict.status === "stalled" ? C.textDim : C.text;
            const isOpen = openLift === l.name;
            return (
              <div key={l.name} style={{ padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
                <button type="button" onClick={() => setOpenLift(isOpen ? null : l.name)} aria-expanded={isOpen}
                  style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12, color: C.text, fontFamily: mono, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                    <span style={{ fontSize: 10.5, color: tone, fontFamily: mono, letterSpacing: "0.06em" }}>{VERDICT_LABEL[l.verdict.status]}</span>
                  </span>
                  <Spark series={l.series} C={C} />
                  <span style={{ fontFamily: S.fontSerif, fontSize: 16, color: C.text, fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 44, textAlign: "right" }}>
                    {l.current}
                    {l.delta30 !== null && l.delta30 !== 0 && (
                      <span style={{ fontSize: 10.5, color: l.delta30 > 0 ? C.textDim : C.red, fontFamily: mono, display: "block" }}>{l.delta30 > 0 ? "+" : ""}{l.delta30} · 30d</span>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.55, marginTop: 6, padding: "7px 10px", border: `1px solid ${l.verdict.status === "stalled" || l.verdict.status === "regressing" ? C.text : C.line}` }}>
                    {l.verdict.note}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ ...S.annotation, marginTop: 8, color: C.textFaint, lineHeight: 1.5 }}>
            e1RM = Epley on best straight set, RIR-adjusted when logged · technique sets excluded · estimates, not maxes
          </div>
        </>
      )}
    </div>
  );
}

// ─── Muscle recency map ───────────────────────────────────────────────────────
const RECENCY_TONE = (status, C) => status === "worked" ? C.textFaint : status === "ready" ? C.text : status === "fresh" ? C.green : C.textFaint;

export function MuscleRecencyMap({ data }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const recency = useMemo(() => buildMuscleRecency(data, getTodayKey()), [data]);
  if (!recency) return null;
  const trained = recency.filter(r => r.status !== "untrained");
  if (trained.length === 0) return null;

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Recovery map</span>
        <span style={S.blockStat}>DAYS SINCE TRAINED</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
        {trained.sort((a, b) => (b.daysSinceAny ?? 99) - (a.daysSinceAny ?? 99)).map(r => (
          <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 11, color: C.textDim, fontFamily: mono, letterSpacing: "0.04em" }}>{r.label}</span>
            <span style={{ fontSize: 11.5, fontFamily: mono, color: RECENCY_TONE(r.status, C), fontVariantNumeric: "tabular-nums" }}>
              {r.daysSinceAny}d {r.status === "worked" ? "· just hit" : r.status === "fresh" ? "· fresh" : ""}
            </span>
          </div>
        ))}
      </div>
      <div style={{ ...S.annotation, marginTop: 8, color: C.textFaint, lineHeight: 1.5 }}>
        last primary or secondary involvement in 21 days · 0-1d just hit · 2-3d ready · 4d+ fresh
      </div>
    </div>
  );
}
