// src/SessionComplete.jsx
// The Box Score: the session's story, printed once it is finished.
//
// It is the peak of the loop, so it is built to feel earned and to stay
// honest. Reading order: the headline → any record, with the set that made it
// → tonnage against the last session of the same name → every lift, sets and
// which way strength moved → sets banked this week against your range → what
// is still open today. Every comparison names its basis, an estimate is
// called an estimate, and a skipped lift is listed as skipped.
//
// The sheet prints in once (see .mo-print); with reduced motion it is simply
// there. Brass marks a record and nothing else.

import { Flow, Icon, TopBar } from "./ui/ledger";

const NBSP = " ";
const fmt = (value) => Math.round(value).toLocaleString("en-US");

const TREND = {
  pr: { label: "Up · PR", className: "tag tag-e" },
  up: { label: "Up", className: "tag" },
  steady: { label: "Steady", className: "tag tag-f" },
  down: { label: "Down", className: "tag" },
};

function dayLabel(dateKey) {
  if (!dateKey) return "";
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function shortDay(dateKey) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A total tallied like an adding machine. The real number is beside it for
// screen readers; totals under 1,000 are simply shown.
function Tally({ value, delay }) {
  const rounded = Math.round(value);
  if (rounded < 1000 || rounded > 999999) return <>{fmt(rounded)}</>;
  return (
    <>
      <span className="mo-count" aria-hidden="true" style={{ "--ot-k": Math.floor(rounded / 1000), "--ot-n": rounded % 1000, "--d": delay }} />
      <span className="sr">{fmt(rounded)}</span>
    </>
  );
}

// Where this week's sets for a muscle sit against its range.
function RangeMark({ label, sets, range }) {
  const max = Math.max(range.max * 1.2, sets * 1.1, 1);
  const x = (value) => Math.round((Math.max(0, value) / max) * 300) + 10;
  const where = sets < range.min ? "below" : sets > range.max ? "above" : "inside";
  return (
    <svg viewBox="0 0 320 40" width="100%" height="40" role="img" aria-label={`${label}: ${sets} sets this week, ${where} your range of ${range.min} to ${range.max}.`} style={{ display: "block" }}>
      <line x1="10" y1="14" x2="310" y2="14" stroke="var(--edge)" strokeWidth="1" />
      <rect x={x(range.min)} y="8" width={Math.max(2, x(range.max) - x(range.min))} height="12" rx="3" fill="var(--press)" stroke="var(--edge)" />
      <circle cx={x(sets)} cy="14" r="6" fill="var(--ink)" stroke="var(--bg)" strokeWidth="2" />
      <text x={x(range.min)} y="36" fontSize="12" textAnchor="middle" fill="var(--ink-2)">{range.min}</text>
      <text x={x(range.max)} y="36" fontSize="12" textAnchor="middle" fill="var(--ink-2)">{range.max}</text>
    </svg>
  );
}

export function SessionComplete({ boxScore, finisher, onDismiss, dateKey = "", sessionName = "" }) {
  const b = boxScore || {};
  const lifts = b.lifts || [];
  const compare = b.tonnageCompare || null;
  const top = Math.max(b.tonnage || 0, compare?.priorTonnage || 0, 1);
  const banked = (b.banked || []).filter((muscle) => muscle.weekSets != null && muscle.range);
  const lead = banked[0] || null;
  const tonnageNote = !compare ? null
    : compare.deltaPct > 0 ? `Up ${compare.deltaPct}% on your last ${sessionName || "session"}`
    : compare.deltaPct < 0 ? `Down ${Math.abs(compare.deltaPct)}% on your last ${sessionName || "session"}`
    : `Level with your last ${sessionName || "session"}`;

  return (
    <Flow label="The Box Score" onClose={onDismiss} data-testid="session-complete">
      <div className="shell">
        <TopBar title="The Box Score" close="Close" onClose={onDismiss} />
        <div className="main" style={{ gap: 20 }}>
          <div className="mo-print" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <header style={{ borderTop: "3px solid var(--ink)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {(dateKey || sessionName) && <p className="t-s c2">{[dayLabel(dateKey), sessionName].filter(Boolean).join(" · ")}</p>}
              <h2 className="t-xl">{b.headline || "Session logged."}</h2>
              {lifts.length > 0 && <p className="t-s c2">{b.liftsDone} of {lifts.length}{NBSP}exercises done.</p>}
            </header>

            {(b.prs || []).map((pr, index) => (
              <section key={pr.name} className="card" aria-label={`Personal record: ${pr.name}`} style={{ border: "2px solid var(--earned)", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="tag tag-e mo-stamp mo-foil" style={{ "--d": `${1050 + index * 120}ms` }}>PR</span>
                  <h3 className="t-h">{pr.name}</h3>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 28px" }}>
                  <div className="kv"><span className="n-lg">{pr.e1rm}{NBSP}lb</span><span className="t-s c2">estimated one-rep max</span></div>
                  {pr.set && <div className="kv" style={{ justifyContent: "flex-end" }}><span className="n-md">{pr.set.weight}{NBSP}lb{NBSP}×{NBSP}{pr.set.reps}</span><span className="t-s c2">best set today</span></div>}
                </div>
                <p className="t-s">Up {pr.e1rm - pr.priorBest}{NBSP}lb from {pr.priorBest}{NBSP}lb. An estimate from your best set, not a tested max.</p>
              </section>
            ))}

            {b.tonnage > 0 && (
              <section aria-labelledby="box-tonnage" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="kv"><h3 id="box-tonnage" className="t-h">Tonnage</h3>{tonnageNote && <p className="t-s c2">{tonnageNote}.</p>}</div>
                <div className="kv" style={{ gap: 4 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span className="t-bs">Today</span><span className="n"><Tally value={b.tonnage} delay="520ms" />{NBSP}lb</span></span>
                  <span className="bar" aria-hidden="true"><i className="mo-grow" style={{ width: `${(b.tonnage / top) * 100}%`, "--d": "480ms" }} /></span>
                </div>
                {compare ? (
                  <div className="kv" style={{ gap: 4 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span className="t-bs c2">Last time, {shortDay(compare.priorDate)}</span><span className="n c2">{fmt(compare.priorTonnage)}{NBSP}lb</span></span>
                    <span className="bar" aria-hidden="true"><i className="mo-grow" style={{ width: `${(compare.priorTonnage / top) * 100}%`, background: "var(--ink-3)", "--d": "560ms" }} /></span>
                  </div>
                ) : (
                  <p className="t-s c2">No earlier {sessionName || "session of this name"} to compare with. This one sets the baseline.</p>
                )}
              </section>
            )}

            {lifts.length > 0 && (
              <table className="tbl">
                <caption className="t-h" style={{ textAlign: "left", paddingBottom: 4 }}>Lift by lift</caption>
                <thead><tr><th scope="col">Lift</th><th scope="col">Sets</th><th scope="col" style={{ paddingRight: 0 }}>Strength</th></tr></thead>
                <tbody>
                  {lifts.map((lift) => (
                    <tr key={lift.name}>
                      <th scope="row">{lift.name}</th>
                      <td className="n-s">{lift.trend === "skipped" ? "—" : lift.sets}</td>
                      <td style={{ paddingRight: 0 }}>
                        {lift.trend === "skipped" ? <span className="t-s c2">Skipped{lift.reason ? `: ${lift.reason}` : ""}</span>
                          : TREND[lift.trend] ? <span className={TREND[lift.trend].className}>{TREND[lift.trend].label}</span>
                          : <span className="t-s c2">No earlier session</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {banked.length > 0 && (
              <section aria-labelledby="box-week" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h3 id="box-week" className="t-h">Sets banked this week</h3>
                <p className="t-s"><b>{lead.label} {lead.weekSets}{NBSP}sets.</b> Your range is {lead.range.min} to {lead.range.max}.</p>
                <RangeMark label={lead.label} sets={lead.weekSets} range={lead.range} />
                {banked.length > 1 && (
                  <p className="t-s c2">{banked.slice(1).map((muscle) => `${muscle.label} ${muscle.weekSets} of ${muscle.range.min} to ${muscle.range.max}.`).join(" ")}</p>
                )}
              </section>
            )}

            {finisher && (
              <div className="banner" style={{ alignItems: "center" }}>
                <span className="grow"><span className="t-ss">Still open today</span><br /><span className="t-s">{finisher.label}</span></span>
                <button type="button" className="btn btn-s btn-sm" data-testid="finisher-log" onClick={finisher.onLog}>Log as done</button>
              </div>
            )}

            {b.method && <p className="t-s c2" data-testid="method-box-score" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><Icon name="info" size="s" /><span>{b.method}</span></p>}
          </div>
        </div>
        <div className="foot"><button type="button" className="btn btn-p btn-b" onClick={onDismiss}>Close</button></div>
      </div>
    </Flow>
  );
}

export default SessionComplete;
