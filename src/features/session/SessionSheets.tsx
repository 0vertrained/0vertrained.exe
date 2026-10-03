// The runner's sheets: the exercise list (work out of order), the overflow
// menu, swap, skip, plate math, and the "I'm unwell" confirm.
import { useState } from "react";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { Icon } from "../../design/Icon";
import { SegmentedControl } from "../../design/SegmentedControl";
import { Sheet } from "../../design/Sheet";
import { TextInput } from "../../design/TextInput";
import { SKIP_REASONS, type SkipReason } from "../../domain/day/schema";
import type { EquipmentMode } from "../../domain/program/types";
import { substitutesFor } from "../../domain/program/substitutions";
import { plateMath } from "../../domain/training/liftMath";
import { formatWeight, type UnitSystem } from "../../domain/units";
import type { SessionExercise } from "./sessionModel";
import styles from "./SessionRunner.module.css";

export function ExerciseListSheet({ exercises, currentIndex, onPick, onClose }: { exercises: SessionExercise[]; currentIndex: number; onPick: (index: number) => void; onClose: () => void }) {
  return (
    <Sheet id="exercises" title="Exercises" onClose={onClose}>
      <ol className={styles.menu} aria-label="Exercises">
        {exercises.map((e, i) => (
          <li key={e.id}>
            <button type="button" className={styles.menuBtn} aria-current={i === currentIndex ? "true" : undefined} onClick={() => onPick(i)}>
              <span>
                <span className="ot-body-strong ot-block">{e.performedName}{e.swapped ? <span className="ot-small ot-ink-2"> (for {e.name})</span> : null}</span>
                <span className={`ot-small ${styles.menuSub}`}>{e.skipped ? `Skipped · ${e.skipped}` : `${e.done} of ${e.plannedSets} sets`}</span>
              </span>
              {e.handled ? <Icon name="check" size={20} /> : <span className="ot-numeral-sm ot-ink-2">{i + 1}</span>}
            </button>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

export type MoreAction = "swap" | "skip" | "pain" | "unwell" | "plates";

export function MoreSheet({ exercise, canPlates, onAction, onClose }: { exercise: SessionExercise; canPlates: boolean; onAction: (a: MoreAction) => void; onClose: () => void }) {
  const items: { key: MoreAction; label: string; sub: string }[] = [
    { key: "swap", label: "Swap exercise", sub: "Same pattern, different movement. The slot keeps its sets." },
    { key: "skip", label: "Skip exercise", sub: "Say why; the day is still judged on the rest." },
    { key: "pain", label: "Flag pain", sub: exercise.currentSetIndex > 0 ? "Banked sets count in full for this lift." : "Ends this exercise. Nothing is lost." },
    { key: "unwell", label: "I'm unwell", sub: "Ends the session. Today is protected." },
    ...(canPlates ? [{ key: "plates" as const, label: "Plate math", sub: "Plates per side for the load in hand." }] : []),
  ];
  return (
    <Sheet id="more" title={exercise.performedName} onClose={onClose}>
      <ul className={styles.menu}>
        {items.map((it) => (
          <li key={it.key}>
            <button type="button" className={styles.menuBtn} onClick={() => onAction(it.key)}>
              <span>
                <span className="ot-body-strong ot-block">{it.label}</span>
                <span className={`ot-small ${styles.menuSub}`}>{it.sub}</span>
              </span>
              <Icon name="chevron" size={20} />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function SwapSheet({ exercise, equipment, onSwap, onClose }: { exercise: SessionExercise; equipment: EquipmentMode; onSwap: (name: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  const options = substitutesFor(exercise.libraryId ?? exercise.name, { equipment, limit: 6 });
  return (
    <Sheet id="swap" title={`Swap ${exercise.name}`} onClose={onClose} footer={<Button variant="primary" full disabled={custom.trim().length < 2} onClick={() => onSwap(custom)}>Use this movement</Button>}>
      <ul className={styles.menu} aria-label="Suggested swaps">
        {options.map((o) => (
          <li key={o.id}>
            <button type="button" className={styles.menuBtn} onClick={() => onSwap(o.name)}>
              <span className="ot-body-strong">{o.name}</span>
              <span className="ot-caption ot-ink-2">{o.equipment}</span>
            </button>
          </li>
        ))}
        {options.length === 0 ? <li className="ot-small ot-ink-2">No catalogue swap for this movement. Type one below.</li> : null}
      </ul>
      <div className={styles.swapInput}>
        <TextInput label="Or another movement" placeholder="e.g. Leg Press" value={custom} onChange={setCustom} />
      </div>
    </Sheet>
  );
}

const REASON_LABELS: Record<SkipReason, string> = { equipment: "No equipment", time: "Out of time", fatigue: "Too tired", pain: "Pain" };

export function SkipSheet({ exercise, onSkip, onClose }: { exercise: SessionExercise; onSkip: (reason: SkipReason) => void; onClose: () => void }) {
  const [reason, setReason] = useState<SkipReason>("time");
  return (
    <Sheet id="skip" title={`Skip ${exercise.performedName}?`} onClose={onClose} footer={<Button variant="primary" full onClick={() => onSkip(reason)}>Skip exercise</Button>}>
      <p className="ot-body ot-ink-2 ot-m0">The rest of the session is judged as planned. Pain also keeps any banked set&rsquo;s credit.</p>
      <div className="ot-stack">
        <SegmentedControl label="Reason" options={SKIP_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] }))} value={reason} onChange={(v) => setReason(v as SkipReason)} />
      </div>
    </Sheet>
  );
}

export function PlateSheet({ exercise, loadKg, units, onClose }: { exercise: SessionExercise; loadKg: number | null; units: UnitSystem; onClose: () => void }) {
  const math = loadKg !== null ? plateMath(loadKg, units, true) : null;
  return (
    <Sheet id="plates" title="Plate math" onClose={onClose}>
      <p className="ot-body ot-ink-2 ot-m0">{exercise.performedName} at {loadKg !== null ? formatWeight(loadKg, units) : "no load"}.</p>
      {math ? (
        <div className={styles.plates}>
          <div className={styles.plateRow}><span className="ot-body-strong">Per side</span><span className="ot-numeral">{math.perSide.length ? math.perSide.join(" + ") : "empty bar"} {math.unit}</span></div>
          <div className={styles.plateRow}><span className="ot-body-strong">Bar</span><span className="ot-numeral">{math.bar} {math.unit}</span></div>
          {math.remainder > 0 ? <div className={styles.plateRow}><span className="ot-body-strong">Short</span><span className="ot-numeral">{math.remainder} {math.unit}</span></div> : null}
        </div>
      ) : (
        <p className="ot-small ot-ink-2">Below the bar&rsquo;s weight, or no load entered.</p>
      )}
    </Sheet>
  );
}

export function UnwellDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return <Dialog id="unwell" title="End the session?" body="Today becomes a protected day: the streak is kept and the check-in XP stays. Nothing banked is lost." confirmLabel="End session" onConfirm={onConfirm} onCancel={onCancel} />;
}
