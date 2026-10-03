// The session runner: one exercise at a time, two steppers, the set dots, a
// rest bar after each banked set, and one sticky primary that always says
// what comes next. Every write is a pure mutation from sessionModel applied
// through updateDay.
import { useEffect, useMemo, useState } from "react";
import { triggerHaptic, useWakeLock } from "../../app/device";
import { useToast } from "../../app/ToastProvider";
import { useHashRoute } from "../../app/useHashRoute";
import { Button } from "../../design/Button";
import { IconButton } from "../../design/IconButton";
import { Icon } from "../../design/Icon";
import { Notice } from "../../design/Notice";
import { Panel } from "../../design/Panel";
import { RestTimerBar } from "../../design/RestTimerBar";
import { SetDots } from "../../design/SetDots";
import { Stepper } from "../../design/Stepper";
import { mmss } from "../../design/time";
import type { DateKey } from "../../domain/dates";
import type { DayMap, DayV2, ExerciseLog, PlannedExercise, QuestSnapshot, SkipReason } from "../../domain/day/schema";
import type { ExerciseMeta } from "../../domain/exercise";
import type { TrialSpec } from "../../domain/game/types";
import type { EquipmentMode, ProgramDay } from "../../domain/program/types";
import type { SetValues } from "../../domain/training/ghosts";
import { detectRecords } from "../../domain/training/records";
import { validateSet } from "../../domain/training/sets";
import { fromDisplayWeight, loadIncrement, toDisplayWeight, weightUnit, type UnitSystem } from "../../domain/units";
import styles from "./SessionRunner.module.css";
import { addExtraSet, finishSession, flagPain, judgeTrialOnDay, logSet, nextExerciseIndex, sessionView, skipExercise, swapExercise, unlogSet, unskipExercise, type SessionExercise } from "./sessionModel";
import { ExerciseListSheet, MoreSheet, PlateSheet, SkipSheet, SwapSheet, UnwellDialog, type MoreAction } from "./SessionSheets";
import type { RestTimer } from "./useRestTimer";

export interface SessionRunnerProps {
  todayKey: DateKey;
  day: DayV2;
  quest: QuestSnapshot;
  planned: ProgramDay | null;
  days: DayMap;
  units: UnitSystem;
  equipment: EquipmentMode;
  metaFor: (log: ExerciseLog) => ExerciseMeta;
  trial: TrialSpec | null;
  rest: RestTimer;
  restSeconds: number;
  haptics: boolean;
  historyComplete: boolean;
  updateDay: (fn: (day: DayV2) => DayV2) => void;
  onExit: () => void;
  onFinished: () => void;
  onUnwell: () => void;
}

const INDEX_KEY = "ovt-v20-session-index";

function readIndex(): number | null {
  try {
    const raw = window.sessionStorage.getItem(INDEX_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

const EMPTY: SetValues = { weightKg: null, reps: null, seconds: null, distanceM: null, assistanceKg: null };

function plannedOf(e: SessionExercise): PlannedExercise {
  return { id: e.id, name: e.name, sets: e.plannedSets, reps: e.reps, trackingMode: e.mode, ...(e.libraryId && !e.swapped ? { libraryId: e.libraryId } : {}) };
}

export function SessionRunner(p: SessionRunnerProps) {
  const { sheet, openSheet, closeSheet } = useHashRoute();
  const toast = useToast();
  const [currentIndex, setCurrentIndex] = useState<number | null>(readIndex);
  const view = useMemo(() => sessionView({ day: p.day, quest: p.quest, planned: p.planned, days: p.days, todayKey: p.todayKey, units: p.units, metaFor: p.metaFor, currentIndex, trial: p.trial }), [p.day, p.quest, p.planned, p.days, p.todayKey, p.units, p.metaFor, currentIndex, p.trial]);
  const current = view.current;
  const setKey = current ? `${current.id}:${current.currentSetIndex}` : "";
  const [values, setValues] = useState<SetValues>(view.initial);
  const [valuesFor, setValuesFor] = useState(setKey);
  if (valuesFor !== setKey) {
    setValuesFor(setKey);
    setValues(view.initial);
  }
  useWakeLock(true);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(INDEX_KEY, String(view.currentIndex));
    } catch {
      // nicety
    }
  }, [view.currentIndex]);

  if (!current) return null;
  const planned = plannedOf(current);
  const unit = weightUnit(p.units);
  const step = loadIncrement(p.units);
  const candidate = { id: "x", done: true, weightKg: values.weightKg ?? null, reps: values.reps ?? null, ...(values.seconds != null ? { seconds: values.seconds } : {}), ...(values.assistanceKg != null ? { assistanceKg: values.assistanceKg } : {}), ...(values.distanceM != null ? { distanceM: values.distanceM } : {}) };
  const validation = validateSet(candidate, current.mode) as { valid: boolean; message?: string };
  const banking = view.primary.key === "set" || view.primary.key === "extra";
  const isTrialSet = current.isTrial && current.currentSetIndex === 0 && p.trial !== null;

  const complete = () => {
    const index = current.currentSetIndex;
    const at = new Date().toISOString();
    let banked: DayV2 | null = null;
    p.updateDay((d) => {
      let next = logSet(d, planned, index, values, at, { trial: isTrialSet });
      if (isTrialSet && p.trial) next = judgeTrialOnDay(next, p.trial);
      banked = next;
      return next;
    });
    triggerHaptic("set", p.haptics);
    p.rest.start(p.restSeconds || current.restSeconds);
    const after = banked as DayV2 | null;
    if (after && p.historyComplete) {
      const record = detectRecords({ dateKey: p.todayKey, day: after, history: p.days, metaFor: p.metaFor, units: p.units }).find((r) => r.exerciseId === current.id);
      if (record?.isRecord && !record.baseline && !record.fromExtraWork) toast.show({ tag: "RECORD", text: `${record.name} ${record.label}.` });
    }
    if (isTrialSet && after?.quest?.trial) toast.show({ tag: "RANK TRIAL", text: after.quest.trial.passed ? "Trial passed. Claim your rewards when the session is done." : "Not this time. The trial comes back in a week." });
  };

  const primary = () => {
    switch (view.primary.key) {
      case "set":
      case "extra":
        complete();
        return;
      case "next":
        setCurrentIndex(nextExerciseIndex(view, view.currentIndex));
        return;
      case "finish":
        p.updateDay((d) => finishSession(d, new Date().toISOString()));
        p.rest.skip();
        p.onFinished();
        return;
    }
  };

  const onMore = (a: MoreAction) => {
    closeSheet();
    if (a === "pain") {
      p.updateDay((d) => flagPain(d, planned, Math.max(0, current.currentSetIndex)));
      return;
    }
    // The next sheet opens once the menu's history entry has popped.
    window.setTimeout(() => openSheet(a), 0);
  };

  const steppers = (() => {
    const load = <Stepper key="load" label="Load" unit={unit} value={Math.round(toDisplayWeight(values.weightKg ?? 0, p.units) * 2) / 2} step={step} min={0} max={1000} onChange={(v) => setValues((s) => ({ ...s, weightKg: v > 0 ? fromDisplayWeight(v, p.units) : null }))} />;
    const added = <Stepper key="added" label="Added load" unit={unit} value={Math.round(toDisplayWeight(values.weightKg ?? 0, p.units) * 2) / 2} step={step} min={0} max={500} onChange={(v) => setValues((s) => ({ ...s, weightKg: v > 0 ? fromDisplayWeight(v, p.units) : null }))} />;
    const reps = <Stepper key="reps" label="Reps" value={values.reps ?? 0} step={1} min={0} max={100} onChange={(v) => setValues((s) => ({ ...s, reps: v > 0 ? v : null }))} />;
    const seconds = <Stepper key="seconds" label="Hold" unit="sec" value={values.seconds ?? 0} step={5} min={0} max={1800} format={(v) => mmss(v).replace(/^0/, "")} onChange={(v) => setValues((s) => ({ ...s, seconds: v > 0 ? v : null }))} />;
    const assist = <Stepper key="assist" label="Assist" unit={unit} value={Math.round(toDisplayWeight(values.assistanceKg ?? 0, p.units) * 2) / 2} step={step} min={0} max={200} onChange={(v) => setValues((s) => ({ ...s, assistanceKg: v > 0 ? fromDisplayWeight(v, p.units) : null }))} />;
    const distance = <Stepper key="distance" label="Distance" unit={p.units === "imperial" ? "yd" : "m"} value={Math.round(values.distanceM ?? 0)} step={5} min={0} max={1000} onChange={(v) => setValues((s) => ({ ...s, distanceM: v > 0 ? v : null }))} />;
    switch (current.mode) {
      case "loaded_reps": return [load, reps];
      case "bodyweight_reps": return [reps, added];
      case "assisted_reps": return [reps, assist];
      case "timed_hold": return [seconds, added];
      case "carry": return [load, distance];
    }
  })();

  const meta = p.metaFor({ name: current.performedName, sets: [], ...(current.libraryId && !current.swapped ? { libraryId: current.libraryId } : {}) });

  return (
    <div className={styles.screen}>
      <header className="ot-runner-head">
        <IconButton name="exit" label="Exit session" onClick={p.onExit} />
        <h1 className="ot-title ot-m0">{view.title}</h1>
        <Button variant="secondary" size="sm" aria-label={`Exercise ${view.currentIndex + 1} of ${view.exercises.length}. Open exercise list`} onClick={() => openSheet("exercises")}>
          Exercise {view.currentIndex + 1}/{view.exercises.length}
          <Icon name="chevron" size={16} rotate={90} />
        </Button>
        <span className="ot-strip-sync" role="status" aria-label="Saved"><span className="ot-sync-dot" data-sync="synced" /></span>
      </header>

      <main className={styles.body}>
        {isTrialSet && p.trial ? <Notice tag="RANK TRIAL">{p.trial.spec}</Notice> : null}
        {current.skipped ? <Notice tag="QUEST" tone="muted" action={{ label: "Undo", onClick: () => p.updateDay((d) => unskipExercise(d, planned)) }}>Skipped: {current.skipped}.</Notice> : null}
        <div className={styles.exHead}>
          <div>
            <h2 className={`ot-heading ${styles.exTitle}`}>{current.performedName}</h2>
            {current.swapped ? <p className={`ot-small ot-ink-2 ${styles.cue}`}>Swapped for {current.name}.</p> : null}
            {current.cue ? <p className={`ot-small ot-ink-2 ${styles.cue}`}>{current.cue}</p> : null}
          </div>
          <IconButton name="more" label="More: swap, skip, flag pain, unwell, plate math" onClick={() => openSheet("more")} />
        </div>

        <div className={styles.target}>
          <span className="ot-numeral-sm">{view.target?.line}</span>
          {view.target?.ghost ? <Button variant="ghost" size="sm" onClick={() => setValues({ ...EMPTY, ...view.target?.ghost?.values })}>Use</Button> : null}
        </div>

        <Panel as="section" aria-label={banking ? view.primary.label : current.performedName}>
          <div className="ot-stepper-stack">{steppers}</div>
          <div className={styles.dotsRow}>
            <SetDots sets={current.dots.map((d) => ({ state: d.state, ...(d.done !== undefined ? { done: d.done } : {}) }))} onEdit={(i) => p.updateDay((d) => unlogSet(d, planned, i))} />
            <Button variant="ghost" size="sm" onClick={() => p.updateDay((d) => addExtraSet(d, planned))}>+ Add set</Button>
          </div>
          {banking && !validation.valid ? <p className={`ot-small ot-ink-2 ${styles.hint}`}>{validation.message ?? "Enter the set before banking it."}</p> : null}
        </Panel>
      </main>

      {p.rest.active ? <RestTimerBar total={p.rest.total} remaining={p.rest.remaining} onMinus={() => p.rest.adjust(-30)} onPlus={() => p.rest.adjust(30)} onSkip={p.rest.skip} /> : null}

      <div className="ot-sticky-foot">
        <Button variant="primary" size="lg" full disabled={banking && !validation.valid} onClick={primary}>{view.primary.label}</Button>
      </div>

      {sheet === "exercises" ? <ExerciseListSheet exercises={view.exercises} currentIndex={view.currentIndex} onPick={(i) => { setCurrentIndex(i); closeSheet(); }} onClose={closeSheet} /> : null}
      {sheet === "more" ? <MoreSheet exercise={current} canPlates={current.mode === "loaded_reps" && meta.isBarbell} onAction={onMore} onClose={closeSheet} /> : null}
      {sheet === "swap" ? <SwapSheet exercise={current} equipment={p.equipment} onSwap={(name) => { p.updateDay((d) => swapExercise(d, planned, name)); closeSheet(); }} onClose={closeSheet} /> : null}
      {sheet === "skip" ? <SkipSheet exercise={current} onSkip={(reason: SkipReason) => { p.updateDay((d) => skipExercise(d, planned, reason)); closeSheet(); }} onClose={closeSheet} /> : null}
      {sheet === "plates" ? <PlateSheet exercise={current} loadKg={values.weightKg ?? null} units={p.units} onClose={closeSheet} /> : null}
      {sheet === "unwell" ? <UnwellDialog onConfirm={() => { closeSheet(); p.onUnwell(); }} onCancel={closeSheet} /> : null}
    </div>
  );
}
