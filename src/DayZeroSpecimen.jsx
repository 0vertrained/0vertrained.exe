// src/DayZeroSpecimen.jsx
// ─────────────────────────────────────────────────────────────────────────────
// V17.0 · Day Zero Edition — the specimen plate.
//
// What a cold visitor sees instead of an empty tab: a hand-curated sample of
// this surface at its best, unmistakably stamped SPECIMEN, followed by
// exactly ONE action and an honest line about what happens next and when.
//
// Design rules (enforced by tests):
//   · One primary action per plate — choice paralysis is the enemy of the
//     first minute. Progress has none; it shows its unlock countdown instead.
//   · The specimen is visibly fake: stamp in the masthead, caption under the
//     plate. Never mixable with real data (the detector guarantees it only
//     renders on true zero states).
//   · Whitepaper vocabulary throughout; red stays error-only; the primary
//     button is the ONE full-ink element on the page.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { useTheme } from "./theme";
import { Sparkline } from "./whitepaper";
import { perfMark } from "./perf";
import { logFunnelEvent } from "./funnel";
import specimen from "./fixtures/specimenWeek.json";

const ACTIONS = {
  Today:    { label: "Pick your program",  next: "Takes about two minutes. Your split, your days — the first session is ready the moment you choose." },
  Recovery: { label: "Connect Oura",       next: "Connecting takes about a minute. Your first verdict lands after tonight's sleep — and the trend unlocks after a week of mornings." },
  Fuel:     { label: "Set your targets",   next: "Two numbers to start — calories and protein. The app learns your true burn from intake vs. weight trend within two weeks." },
};

export function DayZeroSpecimen({ tab, onAction = null, progressInfo = null }) {
  const { C, S } = useTheme();

  useEffect(() => {
    perfMark("dayzero", `seen-${tab}`);
    logFunnelEvent(`dayzero_seen_${String(tab).toLowerCase()}`);
  }, [tab]);

  const annot = { fontFamily: S.fontAnnot, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint };
  const rule = `1px solid ${C.line}`;
  const action = ACTIONS[tab] || null;

  const masthead = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <span style={annot}>{tab} · your first week</span>
      <span data-testid="specimen-stamp" style={{ ...annot, color: C.textDim, border: rule, padding: "2px 8px" }}>SPECIMEN</span>
    </div>
  );

  const caption = (
    <div style={{ ...annot, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "none", marginTop: 10, marginBottom: action ? 16 : 0 }}>
      Sample week — yours replaces this the moment real data exists.
    </div>
  );

  let plate = null;
  if (tab === "Today") {
    const t = specimen.today;
    plate = (
      <div>
        <div style={{ fontFamily: C.monoFamily, fontSize: 12, letterSpacing: "0.16em", color: C.text, marginBottom: 10 }}>{t.dayLabel}</div>
        {t.exercises.map((ex) => (
          <div key={ex.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "7px 0", borderBottom: rule }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: S.fontSerif, fontSize: 14.5, color: ex.done ? C.textDim : C.text, textDecoration: ex.done ? "line-through" : "none" }}>{ex.name}</div>
              <div style={{ ...annot, fontSize: 10, letterSpacing: "0.06em", textTransform: "none", marginTop: 2 }}>Last time · {ex.last}</div>
            </div>
            <span style={{ fontFamily: C.monoFamily, fontSize: 11.5, color: C.textDim, whiteSpace: "nowrap" }}>{ex.target}</span>
          </div>
        ))}
        <div style={{ ...annot, textTransform: "none", letterSpacing: "0.04em", marginTop: 8 }}>{t.footer}</div>
      </div>
    );
  } else if (tab === "Recovery") {
    const r = specimen.recovery;
    plate = (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: C.monoFamily, fontSize: 13, fontWeight: 500, letterSpacing: "0.16em", color: C.text }}>{r.state}</span>
          <span style={{ fontFamily: C.monoFamily, fontSize: 12, color: C.textDim }}>{r.score} {r.delta}</span>
        </div>
        <div style={{ fontFamily: S.fontSerif, fontSize: 24, fontWeight: 500, lineHeight: 1.14, letterSpacing: "-0.02em", color: C.text, marginBottom: 8 }}>{r.headline}</div>
        <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 13.5, color: C.textDim, lineHeight: 1.45, marginBottom: 8 }}>{r.evidence}</div>
        <div style={{ ...annot, fontSize: 11, letterSpacing: "0.02em", textTransform: "none", marginBottom: 12 }}>{r.context}</div>
        <Sparkline points={r.spark.map((v, i) => ({ date: `2026-07-0${i + 1}`, value: v }))} width={240} height={40} label="7-day trend" />
      </div>
    );
  } else if (tab === "Fuel") {
    const f = specimen.fuel;
    plate = (
      <div>
        {f.rows.map((row) => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "7px 0", borderBottom: rule }}>
            <span style={{ ...annot, letterSpacing: "0.1em" }}>{row.label}</span>
            <span style={{ textAlign: "right" }}>
              <span style={{ fontFamily: C.monoFamily, fontSize: 13, color: C.text }}>{row.value}</span>
              {row.note && <span style={{ ...annot, fontSize: 10, letterSpacing: "0.04em", textTransform: "none", display: "block", marginTop: 1 }}>{row.note}</span>}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 10 }}>
          {f.meals.map((m) => (
            <div key={m} style={{ fontFamily: C.monoFamily, fontSize: 11, color: C.textDim, padding: "2px 0" }}>{m}</div>
          ))}
        </div>
        <div style={{ ...annot, textTransform: "none", letterSpacing: "0.04em", marginTop: 8 }}>{f.footer}</div>
      </div>
    );
  } else if (tab === "Progress") {
    const p = specimen.progress;
    plate = (
      <div>
        <div style={{ fontFamily: S.fontSerif, fontSize: 20, fontWeight: 500, letterSpacing: "-0.01em", color: C.text, marginBottom: 10 }}>{p.headline}</div>
        <Sparkline points={p.spark.map((v, i) => ({ date: `2026-07-0${i + 1}`, value: v }))} width={240} height={40} label="weight trend" />
        <div style={{ marginTop: 10 }}>
          {p.rows.map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: rule }}>
              <span style={{ ...annot, letterSpacing: "0.1em" }}>{row.label}</span>
              <span style={{ fontFamily: C.monoFamily, fontSize: 12, color: C.textDim }}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section data-testid={`dayzero-${String(tab).toLowerCase()}`} style={{ ...S.block, paddingTop: 18, paddingBottom: 18 }}>
      {masthead}
      {plate}
      {caption}
      {action && onAction && (
        <>
          <button
            type="button"
            data-testid="dayzero-action"
            onClick={() => { perfMark("dayzero", `action-${tab}`); logFunnelEvent(`dayzero_action_${String(tab).toLowerCase()}`); onAction(); }}
            style={{
              width: "100%", padding: "13px 12px", cursor: "pointer", borderRadius: 0,
              border: `1px solid ${C.text}`, background: C.text, color: C.panel,
              fontFamily: S.fontAnnot, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600,
            }}
          >
            {action.label}
          </button>
          <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 12.5, color: C.textDim, lineHeight: 1.5, marginTop: 8 }}>
            {action.next}
          </div>
        </>
      )}
      {tab === "Progress" && progressInfo && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontFamily: C.monoFamily, fontSize: 12, letterSpacing: "0.1em", color: C.text }}>
            UNLOCKS AFTER {String(progressInfo.daysHave + progressInfo.daysNeeded)} LOGGED DAYS — {progressInfo.daysNeeded === 0 ? "READY" : `${progressInfo.daysNeeded} TO GO`}
          </div>
          <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 12.5, color: C.textDim, lineHeight: 1.5, marginTop: 6 }}>
            Trends need a baseline of you first. Log anything — a session, a meal, a weigh-in — and each day counts.
          </div>
        </div>
      )}
    </section>
  );
}

export default DayZeroSpecimen;
