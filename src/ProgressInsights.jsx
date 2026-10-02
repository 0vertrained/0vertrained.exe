// src/ProgressInsights.jsx
// V7 · Two display-only Progress Overview sections:
//   1. CalibrationReport — did following the daily call actually precede
//      better next-day recovery? (coachCalibration.js)
//   2. CorrelationExplorer — scatter any two logged metrics, optional 1-day
//      lag, Pearson r with honest annotations. (correlationExplorer.js)
// Neither writes anything; both read the already-persisted entries object.

import { useMemo, useState } from "react";
import { useTheme } from "./theme";
import { buildCalibrationReport } from "./coachCalibration";
import { buildCoachingCalibrationProfile } from "./coachingCalibration";
import { CORRELATION_METRICS, buildCorrelationPairs, pearson, describeCorrelation } from "./correlationExplorer";

// ─── Calibration report ───────────────────────────────────────────────────────
export function CalibrationReport({ data, wearableTrends = null }) {
  const { C, S } = useTheme();
  const report = useMemo(() => buildCalibrationReport(data), [data]);
  const profile = useMemo(() => buildCoachingCalibrationProfile({ data, wearableTrends }), [data, wearableTrends]);
  const authorityColor = profile.authority === "calibrated" ? C.green : profile.authority === "suggest" ? C.text : C.textDim;

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Coach calibration</span>
        <span style={{ ...S.blockStat, color: authorityColor }}>{profile.authority.toUpperCase()}</span>
      </div>

      <div style={{ fontFamily: S.fontSerif, fontSize: 17, color: C.text, lineHeight: 1.35, marginBottom: 5 }}>
        {profile.summary}
      </div>
      <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>{profile.sourceCoverage.note}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: C.lineBright, border: `1px solid ${C.lineBright}`, marginTop: 10 }}>
        {[
          ["Daily samples", report.sampleCount || 0],
          ["Weekly outcomes", profile.weekly.followedCount],
          ["Favorable", profile.weekly.successRate == null ? "—" : `${profile.weekly.successRate}%`],
        ].map(([label, value]) => (
          <div key={label} style={{ background: C.bg, textAlign: "center", padding: "8px 4px" }}>
            <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{value}</div>
            <div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {report.ready ? (
        <div style={{ marginTop: 10 }}>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Follow rate</span><span style={S.ruledValue}>{report.followRate}% · {report.followedN}/{report.sampleCount} daily calls</span></div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Next-day association</span><span style={S.ruledValue}>{report.delta == null ? "building" : `${report.delta > 0 ? "+" : ""}${report.delta} recovery points`}</span></div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Weekly responses</span><span style={S.ruledValue}>{profile.weekly.approved} approved · {profile.weekly.modified} modified · {profile.weekly.rejected} held</span></div>
        </div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>{report.note}</div>
      )}

      <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 9 }}>
        <div style={{ fontSize: 10, color: C.text, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>False-positive guard</div>
        <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>{profile.falsePositiveGuard.note}</div>
        <div style={{ fontSize: 10, color: C.textFaint, marginTop: 5 }}>{profile.falsePositiveGuard.minStallDays} stall days · {profile.falsePositiveGuard.minRecoverySignals} recovery signals · second-week confirmation</div>
      </div>

      <div style={{ ...S.annotation, marginTop: 10, color: C.textFaint, lineHeight: 1.5 }}>
        Association, not proof. Oura, Whoop, and manual inputs resolve independently; no source is required and sources are never averaged.
      </div>
    </div>
  );
}

// ─── Correlation explorer ─────────────────────────────────────────────────────
function Scatter({ pairs, width = 300, height = 130 }) {
  const { C } = useTheme();
  if (pairs.length < 3) return null;
  const pad = 8;
  const xs = pairs.map(p => p.x);
  const ys = pairs.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const px = v => pad + ((v - xMin) / ((xMax - xMin) || 1)) * (width - pad * 2);
  const py = v => height - pad - ((v - yMin) / ((yMax - yMin) || 1)) * (height - pad * 2);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Scatter plot of the two selected metrics" style={{ display: "block" }}>
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke={C.line} strokeWidth="1" />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke={C.line} strokeWidth="1" />
      {pairs.map((p, i) => (
        <circle key={i} cx={px(p.x).toFixed(1)} cy={py(p.y).toFixed(1)} r="2.5" fill={C.text} fillOpacity="0.55" />
      ))}
    </svg>
  );
}

const selStyle = (C) => ({
  background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`,
  fontFamily: C.fontFamily, fontSize: 11.5, padding: "8px 6px", flex: 1, minWidth: 0,
});

export function CorrelationExplorer({ data }) {
  const { C, S } = useTheme();
  const [open, setOpen] = useState(false);
  const [xKey, setXKey] = useState("sleep");
  const [yKey, setYKey] = useState("energy");
  const [lag, setLag] = useState(1);

  const pairs = useMemo(
    () => open ? buildCorrelationPairs(data, xKey, yKey, { lag }) : [],
    [open, data, xKey, yKey, lag]
  );
  const r = useMemo(() => pearson(pairs), [pairs]);

  return (
    <div style={S.block}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: C.fontFamily }}
      >
        <span style={S.blockTitle}>{"> "}Correlation explorer</span>
        <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>{open ? "▲ hide" : "▾ show"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select value={xKey} onChange={e => setXKey(e.target.value)} aria-label="X metric" style={selStyle(C)}>
              {CORRELATION_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <span style={{ fontSize: 11, color: C.textFaint }}>→</span>
            <select value={yKey} onChange={e => setYKey(e.target.value)} aria-label="Y metric" style={selStyle(C)}>
              {CORRELATION_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {[["0", "Same day"], ["1", "Next day"]].map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setLag(parseInt(v, 10))}
                style={{ border: `1px solid ${String(lag) === v ? C.text : C.lineBright}`, background: "none", color: String(lag) === v ? C.text : C.textDim, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: C.fontFamily, padding: "5px 10px", cursor: "pointer" }}
              >{label}</button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            {pairs.length >= 3 ? (
              <>
                <Scatter pairs={pairs} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
                  <span style={{ fontFamily: S.fontSerif, fontSize: 20, color: C.text }}>r = {r ?? "—"}</span>
                  <span style={{ fontSize: 11, color: C.textDim }}>{describeCorrelation(r, pairs.length)}</span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11.5, color: C.textFaint, letterSpacing: "0.06em" }}>
                {pairs.length}/3 overlapping days — log both metrics on more days to chart this.
              </div>
            )}
            <div style={{ ...S.annotation, marginTop: 8, color: C.textFaint, lineHeight: 1.5 }}>
              Association, not causation — your own logged days, nothing pooled or modeled.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
