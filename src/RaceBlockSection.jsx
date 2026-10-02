// src/RaceBlockSection.jsx
// V7 · Race block UI — point the block at a real race. Countdown + phase
// guidance (build / taper / race day) and editable Hyrox station benchmarks.
// Persistence is the raceBlock.js localStorage helpers (same precedent as
// periodization settings). Guidance copy only — the weekly program, decision
// engine, and load model are never modified from here.

import { useState } from "react";
import { useTheme } from "./theme";
import { HYROX_STATIONS, readRacePlan, writeRacePlan, normalizeRacePlan, buildRaceCountdown } from "./raceBlock";
import { getTodayKey } from "./constants";

export function RaceBlockSection() {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [plan, setPlan] = useState(() => readRacePlan());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => normalizeRacePlan(readRacePlan() || {}));
  const [benchOpen, setBenchOpen] = useState(false);

  const countdown = plan ? buildRaceCountdown(plan, getTodayKey()) : null;
  const phaseTone = countdown?.phase === "taper" || countdown?.phase === "race_day" ? C.red : C.text;

  const save = () => {
    writeRacePlan(draft);
    setPlan(readRacePlan());
    setEditing(false);
  };
  const saveBenchmark = (key, value) => {
    const next = { ...draft, benchmarks: { ...draft.benchmarks, [key]: value } };
    setDraft(next);
    writeRacePlan(next);
    setPlan(readRacePlan());
  };

  const inputStyle = { background: C.bg, border: `1px solid ${C.lineBright}`, color: C.text, fontFamily: mono, fontSize: 13.5, padding: "9px 10px", width: "100%", outline: "none" };

  return (
    <div style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Race block</span>
        {plan?.date && countdown && <span style={{ ...S.blockStat, color: phaseTone }}>{countdown.phase.replace("_", " ").toUpperCase()}</span>}
      </div>

      {!plan?.date && !editing && (
        <>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 10 }}>
            Point this block at a race. You get a countdown, a taper flag in the final {`10`} days, and a station benchmark ledger — guidance only, your program is never rewritten.
          </div>
          <button type="button" onClick={() => setEditing(true)} style={{ ...S.smallBtn, width: "100%", padding: "11px", fontSize: 11 }}>Set race target →</button>
        </>
      )}

      {plan?.date && !editing && countdown && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: S.fontSerif, fontSize: 20, color: phaseTone, lineHeight: 1.15 }}>{countdown.headline}</span>
            <button type="button" onClick={() => { setDraft(normalizeRacePlan(plan)); setEditing(true); }} style={{ ...S.smallBtn, padding: "4px 10px", fontSize: 9.5, flexShrink: 0 }}>Edit</button>
          </div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Race</span><span style={S.ruledValue}>{plan.name || "Unnamed"} · {plan.date}</span></div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginTop: 8 }}>{countdown.note}</div>

          <button
            type="button"
            onClick={() => setBenchOpen(o => !o)}
            aria-expanded={benchOpen}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", borderTop: `1px solid ${C.line}`, marginTop: 12, padding: "10px 0 0", cursor: "pointer", fontFamily: mono }}
          >
            <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim }}>Station benchmarks</span>
            <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>{benchOpen ? "▲ hide" : "▾ show"}</span>
          </button>
          {benchOpen && (
            <div style={{ marginTop: 6 }}>
              {HYROX_STATIONS.map(st => (
                <div key={st.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: mono }}>{st.label}</span>
                  <input
                    style={{ ...inputStyle, width: 76, textAlign: "right", padding: "6px 8px", fontSize: 13 }}
                    placeholder={st.unit}
                    value={plan.benchmarks[st.key] || ""}
                    onChange={e => saveBenchmark(st.key, e.target.value)}
                    aria-label={`${st.label} benchmark`}
                  />
                </div>
              ))}
              <div style={{ ...S.annotation, marginTop: 8, color: C.textFaint }}>best recent times — retest every 3-4 weeks in the build window</div>
            </div>
          )}
        </>
      )}

      {editing && (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <div style={{ fontSize: 9.5, color: C.textDim, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>Race name</div>
            <input style={inputStyle} value={draft.name} placeholder="e.g. Hyrox Dallas" onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.textDim, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>Race date</div>
            <input style={inputStyle} type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={save} style={{ ...S.smallBtn, flex: 1, padding: "10px", borderColor: C.text, color: C.text }}>Save</button>
            <button type="button" onClick={() => setEditing(false)} style={{ ...S.smallBtn, flex: 1, padding: "10px" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
