// src/ProgressInsights.jsx
// Insights on Progress › Recovery, both display only:
//   1. CalibrationReport: did following the daily call go with better
//      recovery the next day? (coachCalibration.js, coachingCalibration.js)
//   2. CorrelationExplorer: any two things you log against each other, same
//      day or next day, with the correlation said in words. Closed by default.
//      (correlationExplorer.js)
// Neither writes anything; both read the entries already saved.

import { useMemo, useState } from "react";
import { buildCalibrationReport } from "./coachCalibration";
import { buildCoachingCalibrationProfile } from "./coachingCalibration";
import { CORRELATION_METRICS, buildCorrelationPairs, pearson, describeCorrelation } from "./correlationExplorer";
import { Icon, Seg, Method } from "./ui/ledger";

const AUTHORITY = { calibrated: "Calibrated", suggest: "Suggesting", observe: "Observing" };
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const sentence = (text) => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "");

// Calibration report
export function CalibrationReport({ data, wearableTrends = null }) {
  const report = useMemo(() => buildCalibrationReport(data), [data]);
  const profile = useMemo(() => buildCoachingCalibrationProfile({ data, wearableTrends }), [data, wearableTrends]);
  const figures = [
    ["Daily samples", report.sampleCount || 0],
    ["Measured weekly outcomes", profile.weekly.evaluatedCount],
    ["Favorable", profile.weekly.successRate == null ? "—" : `${profile.weekly.successRate}%`],
  ];

  return (
    <div style={column(8)}>
      <div className="sec"><h3 className="t-ss">How the calls have held up</h3><span className="tag tag-f">{AUTHORITY[profile.authority] || sentence(profile.authority)}</span></div>
      <p className="t-b">{profile.summary}</p>
      {profile.weekly.followedCount > 0 && <p className="t-s c2">{profile.weekly.followedCount} confirmed followed · {profile.weekly.evaluatedCount} with enough measurements in the following seven days.</p>}
      <p className="t-s c2">{profile.sourceCoverage.note}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        {figures.map(([label, value]) => <span key={label} className="kv"><span className="t-c c2">{label}</span><span className="n-md">{value}</span></span>)}
      </div>
      {report.ready ? (
        <ul className="rows">
          <li className="row"><span className="t-bs grow">Calls followed</span><span className="n-s">{report.followRate}% · {report.followedN} of {report.sampleCount}</span></li>
          <li className="row"><span className="t-bs grow">Recovery the next day</span><span className="n-s">{report.delta == null ? "Still building" : `${report.delta > 0 ? "+" : "−"}${Math.abs(report.delta)} points`}</span></li>
          <li className="row"><span className="t-bs grow">Weekly suggestions</span><span className="n-s">{profile.weekly.approved} approved · {profile.weekly.modified} changed · {profile.weekly.rejected} held</span></li>
        </ul>
      ) : (
        <p className="t-s c2">{report.note}</p>
      )}
      <Method
        testId="method-calibration"
        method="Association, not proof."
        detail={
          <>
            <p>{profile.falsePositiveGuard.note}</p>
            <p>The guard asks for {profile.falsePositiveGuard.minStallDays} stalled days, {profile.falsePositiveGuard.minRecoverySignals} recovery signals and a second week that confirms the first.</p>
            <p>Oura, Whoop and manual inputs are each read on their own. No source is required and sources are never averaged.</p>
          </>
        }
      />
    </div>
  );
}

// Correlation explorer
function Scatter({ pairs, label }) {
  if (pairs.length < 3) return null;
  const width = 358, height = 150, pad = 10;
  const xs = pairs.map((pair) => pair.x);
  const ys = pairs.map((pair) => pair.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const px = (value) => pad + ((value - xMin) / ((xMax - xMin) || 1)) * (width - pad * 2);
  const py = (value) => height - pad - ((value - yMin) / ((yMax - yMin) || 1)) * (height - pad * 2);
  return (
    <svg className="ch" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path className="ax" d={`M${pad} ${height - pad + 0.5}H${width - pad}M${pad + 0.5} ${pad}V${height - pad}`} />
      {pairs.map((pair, index) => <circle key={index} className="pt" cx={px(pair.x).toFixed(1)} cy={py(pair.y).toFixed(1)} r="3.5" />)}
    </svg>
  );
}

export function CorrelationExplorer({ data }) {
  const [open, setOpen] = useState(false);
  const [xKey, setXKey] = useState("sleep");
  const [yKey, setYKey] = useState("energy");
  const [lag, setLag] = useState(1);

  const pairs = useMemo(
    () => open ? buildCorrelationPairs(data, xKey, yKey, { lag }) : [],
    [open, data, xKey, yKey, lag]
  );
  const r = useMemo(() => pearson(pairs), [pairs]);
  const name = (key) => CORRELATION_METRICS.find((metric) => metric.key === key)?.label || key;
  const options = CORRELATION_METRICS.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>);

  return (
    <div style={column(10)}>
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ borderTop: "1px solid var(--line)", borderBottom: open ? "none" : "1px solid var(--line)" }}>
        <span className="kv grow"><span className="t-bs">Explore your own patterns</span><span className="t-s c2">Compare any two things you log</span></span>
        <Icon name={open ? "up" : "down"} size="s" className="c2" />
      </button>
      {open && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <label className="field"><span className="lbl">Compare</span><select className="input" value={xKey} onChange={(event) => setXKey(event.target.value)}>{options}</select></label>
            <label className="field"><span className="lbl">With</span><select className="input" value={yKey} onChange={(event) => setYKey(event.target.value)}>{options}</select></label>
          </div>
          <Seg label="Timing" options={[{ value: 0, label: "Same day" }, { value: 1, label: "Next day" }]} value={lag} onChange={setLag} />
          {pairs.length >= 3 ? (
            <>
              <Scatter pairs={pairs} label={`Scatter plot of ${name(xKey)} across, against ${name(yKey)} up, over ${pairs.length} days: ${describeCorrelation(r, pairs.length)}.`} />
              <p className="t-c c2" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>Across: {name(xKey)}</span><span>Up: {name(yKey)}{lag ? ", next day" : ""}</span></p>
              <p className="t-b">{sentence(describeCorrelation(r, pairs.length))}. <span className="n-s c2">r = {r ?? "—"}</span></p>
            </>
          ) : (
            <p className="t-s c2">{pairs.length} of 3 overlapping days. Log both on more days to chart this.</p>
          )}
          <p className="t-s c2">Association, not causation: your own logged days, nothing pooled or modeled.</p>
        </>
      )}
    </div>
  );
}
