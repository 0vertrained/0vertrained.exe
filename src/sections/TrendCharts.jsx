import { useTheme } from "../theme";
import { calcRecoveryScore } from "../recovery";
import { computeSessionLoad } from "../loadModel";
import { LineFigure } from "./Figure";

// ─────────────────────────────────────────────────────────────────────────────
//  Recovery vs Load — a correlation figure (Improvements §4).
//  Plots daily recovery against that day's training load over the trailing
//  window and derives a plain-language takeaway, turning logged data into
//  self-knowledge rather than another isolated number.
//  Self-contained and defensive: shows an instructive empty state until there
//  is enough signal to be honest.
// ─────────────────────────────────────────────────────────────────────────────

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function RecoveryLoadFigure({ data, days = 21 }) {
  const { C, S } = useTheme();

  // Build the trailing series of days that have a usable recovery score.
  const allDates = Object.keys(data || {}).sort();
  const series = [];
  for (const date of allDates.slice(-days)) {
    let rec = null;
    try { const r = calcRecoveryScore(data[date], data, date); if (r && typeof r.score === "number") rec = r.score; } catch {}
    if (rec === null) continue;
    let load = 0;
    try { load = computeSessionLoad(data[date]).load || 0; } catch {}
    series.push({ date, recovery: rec, load });
  }

  if (series.length < 5) {
    return (
      <section style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Recovery vs Load</span>
          <span style={S.blockStat}>21d</span>
        </div>
        <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.6 }}>
          Once you've logged about a week of training and recovery, this figure plots how your
          recovery tracks against daily load — and flags whether you're stacking hard days.
        </div>
        <div style={{ ...S.annotation, marginTop: 8 }}>need ≥ 5 logged days · {series.length} so far</div>
      </section>
    );
  }

  const recVals = series.map(p => p.recovery);
  const loadVals = series.map(p => p.load);

  // Peak-load annotation (event marker)
  let peakI = 0;
  for (let i = 1; i < series.length; i++) if (series[i].load > series[peakI].load) peakI = i;

  const r = pearson(loadVals, recVals);
  let takeaway;
  if (r === null) takeaway = "Not enough variation yet to read a relationship.";
  else if (r <= -0.35) takeaway = "Higher-load days are landing on lower-recovery days — be careful stacking hard sessions.";
  else if (r >= 0.35) takeaway = "Your harder days are falling on better-recovered days — good sequencing.";
  else takeaway = "No strong link between load and recovery in this window.";

  const fmtDate = (d) => (d || "").slice(5);

  return (
    <section style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Recovery vs Load</span>
        <span style={S.blockStat}>{series.length}d{r !== null ? ` · r=${r.toFixed(2)}` : ""}</span>
      </div>

      <LineFigure
        width={320}
        height={96}
        normalize="each"
        series={[
          { values: loadVals, stroke: C.textDim, dash: true, marker: false },
          { values: recVals, stroke: C.text },
        ]}
        vmarkers={[{ index: peakI }]}
        legend={[
          { label: "Recovery", stroke: C.text },
          { label: "Load", stroke: C.textDim, dash: true },
        ]}
        xLabels={{ left: fmtDate(series[0].date), mid: `peak load · ${fmtDate(series[peakI].date)}`, right: fmtDate(series[series.length - 1].date) }}
        ariaLabel={`Recovery versus training load over the last ${series.length} days. ${takeaway}`}
      />

      <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", color: C.textDim, fontSize: 14, lineHeight: 1.4, marginTop: 10 }}>
        {takeaway}
      </div>
      <div style={{ ...S.annotation, marginTop: 6 }}>derived · daily recovery score against same-day session load</div>
    </section>
  );
}
