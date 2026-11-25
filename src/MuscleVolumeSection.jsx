// src/MuscleVolumeSection.jsx
// Sets this week, by muscle, on Progress › Strength. Each trained muscle gets
// a mark on its own range: the band runs from the fewest weekly sets that
// grow it to the most you recover from, and the mark is this week's count.
// The same numbers sit behind "Show as table"; balance ratios sit behind a
// row of their own. Sets that map to no muscle are counted out loud.

import { useMemo, useState } from "react";
import { buildVolumeReport } from "./muscleVolume";
import { Icon, Method } from "./ui/ledger";
import { DataTable } from "./sections/charts";

const STATUS = {
  below_mev: "below range",
  productive: "in range",
  optimal: "in range, productive band",
  high: "in range, near the top",
  above_mrv: "above range",
};
const signed = (value) => `${value > 0 ? "+" : "−"}${Math.abs(value)}`;

function RangeMark({ row }) {
  const { mev, mavLo, mavHi, mrv } = row.landmarks;
  const max = Math.max(mrv * 1.15, row.sets * 1.05);
  const x = (value) => Math.round((Math.max(0, value) / max) * 150);
  return (
    <svg
      className="ch"
      viewBox="0 0 150 20"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${row.label}: ${row.sets} hard sets this week, ${STATUS[row.status] || "no range"}. Your range is ${mev} to ${mrv} sets, most productive from ${mavLo} to ${mavHi}.`}
      style={{ flex: "1 1 60px", width: 60, maxWidth: 150, height: 20 }}
    >
      <rect className="band" x={x(mev)} y="5" width={Math.max(2, x(mrv) - x(mev))} height="10" rx="2" />
      <path d="M0 10.5h150" style={{ stroke: "var(--edge)", strokeWidth: 1 }} />
      <rect x={Math.min(147, x(row.sets))} y="0" width="3" height="20" style={{ fill: "var(--ink)" }} />
    </svg>
  );
}

export function MuscleVolumeSection({ data }) {
  const report = useMemo(() => buildVolumeReport(data), [data]);
  const [ratiosOpen, setRatiosOpen] = useState(false);
  const [showUntrained, setShowUntrained] = useState(false);

  if (!report.ready) {
    return (
      <section aria-labelledby="volume-title" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 id="volume-title" className="t-h">Sets this week</h2>
        <p className="t-s c2">Log a week of lifting, six completed sets or more, and each muscle appears here against its range.</p>
      </section>
    );
  }

  const rows = showUntrained ? report.rows : report.rows.filter((row) => row.sets > 0);
  const below = report.rows.filter((row) => row.sets > 0 && row.status === "below_mev").map((row) => row.label);
  const above = report.rows.filter((row) => row.status === "above_mrv").map((row) => row.label);
  const headline = [below.length ? `Below range: ${below.join(", ")}.` : "", above.length ? `Above range: ${above.join(", ")}.` : ""].filter(Boolean).join(" ")
    || "Every muscle you trained is inside its range.";

  return (
    <section aria-labelledby="volume-title" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="sec"><h2 id="volume-title" className="t-h">Sets this week</h2><span className="t-s c2">Week of {new Date(`${report.weekStart}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
      <p className="t-bs">{headline}</p>
      <p className="t-s c2">Each muscle has a range: the fewest sets that grow it and the most you recover from. The mark is where you are.</p>

      <ul style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((row) => {
          const flagged = row.status === "below_mev" ? "Below range" : row.status === "above_mrv" ? "Above range" : "";
          return (
            <li key={row.key} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40 }}>
              <span className="t-bs" style={{ width: 86, flex: "none" }}>{row.label}</span>
              <RangeMark row={row} />
              <span className="kv" style={{ alignItems: "flex-end", gap: 0, whiteSpace: "nowrap", flex: "none", width: 108, marginLeft: "auto" }}>
                <span className="n-s">{row.sets} sets</span>
                {flagged
                  ? <span className="t-c stop">{flagged}</span>
                  : row.delta ? <span className="t-c c2">{signed(row.delta)} on last week</span> : null}
              </span>
            </li>
          );
        })}
      </ul>

      <DataTable
        caption="Sets this week by muscle"
        head={["Muscle", "Sets", "Change", "Range"]}
        rows={rows.map((row) => [`${row.label}: ${STATUS[row.status] || "no range"}`, row.sets, row.delta ? signed(row.delta) : "0", `${row.landmarks.mev} to ${row.landmarks.mrv}`])}
      />

      <button type="button" className="btn btn-g btn-sm" aria-expanded={showUntrained} onClick={() => setShowUntrained((value) => !value)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
        {showUntrained ? "Hide muscles with no sets this week" : "Show muscles with no sets this week"}
      </button>

      {report.unmappedSets > 0 && (
        <p className="t-s c2">
          {report.unmappedSets} sets were not counted toward any muscle: {report.unmappedNames.slice(0, 3).join(", ")}{report.unmappedNames.length > 3 ? " and others" : ""}.
        </p>
      )}

      <button type="button" className="row" aria-expanded={ratiosOpen} onClick={() => setRatiosOpen((value) => !value)} style={{ borderTop: "1px solid var(--line)", borderBottom: ratiosOpen ? "none" : "1px solid var(--line)" }}>
        <span className="kv grow"><span className="t-bs">Balance ratios</span><span className="t-s c2">Push against pull, front against back</span></span>
        <Icon name={ratiosOpen ? "up" : "down"} size="s" className="c2" />
      </button>
      {ratiosOpen && (
        <ul className="rows">
          {report.ratios.map((ratio) => (
            <li key={ratio.key} className="row" style={{ minHeight: 48 }}>
              <span className="kv grow"><span className="t-bs">{ratio.label}</span><span className="t-s c2">Usual band {ratio.band}</span></span>
              <span className="kv" style={{ alignItems: "flex-end", gap: 0 }}>
                <span className="n">{ratio.value ?? "—"}</span>
                {!ratio.ok && <span className="t-c stop">Outside the band</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Method
        testId="method-volume"
        label="How to read sets this week"
        method="A hard set is a completed set. Supporting muscles count half. The ranges are published landmarks, not prescriptions."
        detail={
          <>
            <p><strong>Hard set</strong>: one completed working set taken close to failure. A set counts as one for the muscle doing the main work and as half for a muscle that only assists.</p>
            <p>The band on each line runs between two research landmarks. Its low end is <strong>MEV</strong>, the minimum weekly sets that reliably produce growth. Its high end is <strong>MRV</strong>, the most you can recover from: past it, more sets subtract. Between them sits the <strong>MAV</strong> band, where most productive training lives. The table shows this week’s count and its change on last week.</p>
            <p>These are population ranges from the hypertrophy literature, so treat them as a map, not a rulebook: your recovery data is the tiebreaker when the two disagree.</p>
          </>
        }
      />
    </section>
  );
}
