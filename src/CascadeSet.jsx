// src/CascadeSet.jsx
// ─────────────────────────────────────────────────────────────────────────────
// V17.4 · The Cascade, rendered. Lives directly under a set row in both
// TodayTab and Session Mode:
//   · A completed set with a weight quietly offers  + drop · + rp  — nothing
//     appears on ordinary sets before then (no clutter tax on the 95% case).
//   · Once started: a kind chip (DROP / RP), weight-stepped segment rows
//     connected by a hairline left rule (one figure, one set), "+ segment",
//     and × to unwind. Drop segments prefill at ~75% of the previous load;
//     rest-pause prefills the same load.
//   · Whitepaper vocabulary only; the chip is ink-on-paper, never color.
// The set object's own weight/reps remain the top effort; see cascade.js for
// why every downstream consumer (e1RM, volume, tonnage) is safe by
// construction.
// ─────────────────────────────────────────────────────────────────────────────
import { useTheme } from "./theme";
import { CASCADE_KINDS, startCascade, addSegment, updateSegment, removeSegment, clearCascade } from "./cascade";

// showOffer: TodayTab passes true (it has no set-type UI, so the offer rows
// are the entry point). Session Mode passes false — its V12 type-cycler on
// the set number IS the entry point there; the figure simply appears once the
// type is drop/rest-pause. One capability, one entry point per surface.
// V17.4.1 · The offer explains itself: full words + a plain hint per row
// ("what does drop + rp mean?" — a fair field report; hover tooltips don't
// exist on phones), and it appears only on the LAST set of the exercise —
// matching the programming doctrine (final-set techniques) and keeping
// ordinary sets free of clutter. Mid-exercise techniques remain available
// any time via Session Mode's cycler.
export function CascadeSet({ set, onChange, compact = false, showOffer = false, isLast = true }) {
  const { C } = useTheme();
  if (!set) return null;
  const mono = C.monoFamily || C.fontFamily;
  const eligible = set.done && parseFloat(set.weight) > 0;
  const active = !!CASCADE_KINDS[set.type];

  const chip = {
    fontFamily: mono, fontSize: 8.5, letterSpacing: "0.14em",
    border: `1px solid ${C.text}`, color: C.text, padding: "1px 5px",
  };
  const offerBtn = {
    background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
    fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", color: C.textFaint, textTransform: "lowercase",
  };
  const segInput = {
    width: compact ? 46 : 52, background: "transparent", border: "none",
    borderBottom: `1px solid ${C.line}`, color: C.text, fontFamily: mono,
    fontSize: 12, padding: "2px 2px", textAlign: "center",
  };

  if (!active) {
    if (!showOffer || !eligible || !isLast) return null;
    const offerNames = { drop: "+ drop set", rp: "+ rest-pause" };
    return (
      <div data-testid="cascade-offer" style={{ paddingLeft: compact ? 4 : 8, marginTop: 2 }}>
        {Object.values(CASCADE_KINDS).map((k) => (
          <button key={k.key} type="button"
            style={{ ...offerBtn, display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left", padding: "3px 4px" }}
            onClick={() => onChange(startCascade(set, k.key))}>
            <span style={{ color: C.textDim, whiteSpace: "nowrap" }}>{offerNames[k.key]}</span>
            <span style={{ fontSize: 8.5, letterSpacing: "0.04em", textTransform: "none", color: C.textFaint }}>{k.hint}</span>
          </button>
        ))}
      </div>
    );
  }

  const kind = CASCADE_KINDS[set.type] || CASCADE_KINDS.drop;
  return (
    <div data-testid="cascade-figure" style={{ marginTop: 4, marginLeft: compact ? 6 : 10, paddingLeft: 10, borderLeft: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <span style={chip}>{kind.label}</span>
        <span style={{ fontFamily: mono, fontSize: 9, color: C.textFaint, letterSpacing: "0.04em" }}>{kind.hint}</span>
        <button type="button" aria-label="Remove cascade" style={{ ...offerBtn, marginLeft: "auto" }} onClick={() => onChange(clearCascade(set))}>×</button>
      </div>
      {(set.segments || []).map((seg, i) => (
        <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "2px 0" }}>
          <span style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint }}>▸</span>
          <input inputMode="decimal" value={seg.weight} placeholder="lb" aria-label={`Segment ${i + 1} weight`}
            style={segInput} onChange={(e) => onChange(updateSegment(set, i, "weight", e.target.value))} />
          <span style={{ fontFamily: mono, fontSize: 10, color: C.textFaint }}>×</span>
          <input inputMode="numeric" value={seg.reps} placeholder="reps" aria-label={`Segment ${i + 1} reps`}
            style={segInput} onChange={(e) => onChange(updateSegment(set, i, "reps", e.target.value))} />
          <button type="button" aria-label={`Remove segment ${i + 1}`} style={offerBtn} onClick={() => onChange(removeSegment(set, i))}>×</button>
        </div>
      ))}
      <button type="button" style={{ ...offerBtn, paddingLeft: 0 }} onClick={() => onChange(addSegment(set))}>+ segment</button>
    </div>
  );
}

export default CascadeSet;
