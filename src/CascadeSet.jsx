// src/CascadeSet.jsx
// The cascade, rendered. It sits directly under a set row in Today's Quick
// edit and in the session runner:
//   · A completed set with a weight offers a drop set or a rest-pause.
//     Nothing appears on ordinary sets before then.
//   · Once started: the technique's name, one row per segment (load × reps)
//     hung off the set by a rule, "Add segment", and Remove to unwind. Drop
//     segments prefill at about 75% of the previous load; rest-pause
//     prefills the same load.
// The set object's own weight/reps remain the top effort; see cascade.js for
// why every downstream consumer (e1RM, volume, tonnage) is safe by
// construction.
import { Icon } from "./ui/ledger";
import { CASCADE_KINDS, startCascade, addSegment, updateSegment, removeSegment, clearCascade } from "./cascade";

const OFFER_NAMES = { drop: "Add a drop set", rp: "Add a rest-pause" };
const KIND_NAMES = { drop: "Drop set", rp: "Rest-pause" };

// showOffer: Today's Quick edit passes true (it has no set-type control, so
// the offer rows are the entry point). The session runner passes false: its
// set-type control is the entry point there, and the figure appears once the
// type is drop or rest-pause. One capability, one entry point per surface.
// The offer explains itself in words (a hint beside each action), and it
// appears only on the last set of the exercise, matching the programming
// doctrine (final-set techniques) and keeping ordinary sets free of clutter.
// compact: the runner's rest view, where the timer is the subject. The offer
// is one row there and the hint shows once the technique is started.
export function CascadeSet({ set, onChange, showOffer = false, isLast = true, compact = false, offerLabel = "Add to this set" }) {
  if (!set) return null;
  const eligible = set.done && parseFloat(set.weight) > 0;
  const active = !!CASCADE_KINDS[set.type];

  if (!active) {
    if (!showOffer || !eligible || !isLast) return null;
    // Compact: one row beside the rest timer, the hints left for the figure.
    if (compact) {
      return (
        <div className="row" data-testid="cascade-offer" style={{ minHeight: 44, gap: 8 }}>
          <span className="t-s c2 grow">{offerLabel}</span>
          {Object.values(CASCADE_KINDS).map((k) => (
            <button key={k.key} type="button" className="btn btn-s btn-sm" aria-label={OFFER_NAMES[k.key] || k.label} onClick={() => onChange(startCascade(set, k.key))}>{KIND_NAMES[k.key] || k.label}</button>
          ))}
        </div>
      );
    }
    return (
      <div className="casc" data-testid="cascade-offer">
        {Object.values(CASCADE_KINDS).map((k) => (
          <div key={k.key} className="row" style={{ minHeight: 44 }}>
            <span className="t-s c2 grow">{k.hint}</span>
            <button type="button" className="btn btn-s btn-sm" onClick={() => onChange(startCascade(set, k.key))}>{OFFER_NAMES[k.key] || k.label}</button>
          </div>
        ))}
      </div>
    );
  }

  const kind = CASCADE_KINDS[set.type] || CASCADE_KINDS.drop;
  const kindName = KIND_NAMES[kind.key] || kind.label;
  return (
    <div className="casc" data-testid="cascade-figure" role="group" aria-label={kindName}>
      <div className="row" style={{ minHeight: 44 }}>
        <span className="kv grow"><span className="t-ss">{kindName}</span><span className="t-s c2">{kind.hint}</span></span>
        <button type="button" className="btn btn-g btn-sm" aria-label={`Remove ${kindName.toLowerCase()}`} onClick={() => onChange(clearCascade(set))}>Remove</button>
      </div>
      {(set.segments || []).map((seg, i) => (
        <div key={i} className="casc-r">
          <input className="input n" inputMode="decimal" autoComplete="off" value={seg.weight} placeholder="lb" aria-label={`Segment ${i + 1} weight`} onChange={(e) => onChange(updateSegment(set, i, "weight", e.target.value))} />
          <span className="t-s c2" aria-hidden="true">×</span>
          <input className="input n" inputMode="numeric" autoComplete="off" value={seg.reps} placeholder="reps" aria-label={`Segment ${i + 1} reps`} onChange={(e) => onChange(updateSegment(set, i, "reps", e.target.value))} />
          <button type="button" className="ibtn" aria-label={`Remove segment ${i + 1}`} onClick={() => onChange(removeSegment(set, i))}><Icon name="close" size="s" /></button>
        </div>
      ))}
      <button type="button" className="btn btn-s btn-sm" onClick={() => onChange(addSegment(set))} style={{ alignSelf: "flex-start" }}>Add segment</button>
    </div>
  );
}

export default CascadeSet;
