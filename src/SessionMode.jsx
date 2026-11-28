// src/SessionMode.jsx
// The session runner. One exercise is on screen at a time and the current set
// is its hero: the set arrives filled from the target or from last time and
// says which, so a set done as planned is one tap on Log set. Logging starts
// the rest timer, which can be paused, extended or skipped and never starts a
// set by itself. Swap, notes, warm-up, plate math, skip and the queue are one
// tap away in a sheet, never in the way.
//
// The runner remains a lens over workout.exercises: every write goes through
// onUpdate on the same paths Quick edit uses, so leaving at any point loses
// nothing.

import { useState, useEffect, useRef, useMemo } from "react";
import { useMediaQuery, BROADSHEET_QUERY, WORKOUT_PANES_QUERY } from "./ui/useMediaQuery";
import { Flow, Icon, Seg, Sheet, Switch, TopBar } from "./ui/ledger";
import { CascadeSet } from "./CascadeSet";
import { CurrentSetComposer, LoggedSets } from "./workout/CurrentSetComposer";
import { sessionPrescription } from "./customTrainingDay";
import { proposeSet } from "./workout/setFill";
import { completeSet } from "./workout/completeSet";
import { WhoopWorkoutPulse } from "./workout/WhoopWorkoutPulse";
import { useWhoopBluetooth } from "./whoop/bluetooth";
import { getTodayKey } from "./constants";
import { lastSessionSets, buildNextGlance } from "./setGhosts";
import { getLastPerformance, calcPlateMath, suggestRestSeconds, buildWarmupRamp, priorBestWeight, updateWarmup, warmupEntry } from "./sessionIntelligence";
import { usesStandardBarbell } from "./programExerciseLibrary";
import { getRankedSubstitutions } from "./exerciseSubstitutions";
import { buildExercisePrescription, buildProgressionDecision, formatPrescription, prescriptionWeightAt } from "./progressionEngine";
import { buildDeloadRecommendation } from "./fatigueManagement";
import { buildSessionArbitration, buildSessionVolumeProjection } from "./trainingArbitration";
import { readExerciseNote, writeExerciseNote, readSupersetPref, writeSupersetPref } from "./liftLogPrefs";
import { playRestChirp, triggerHaptic, useScreenWakeLock } from "./sessionDevice";
import { cancelRestAlert, hideRestTimer, scheduleRestAlert, showRestTimer } from "./native";
import { AddExerciseSheet } from "./AddExercise";
import { addToDay } from "./addedExercises";
import {
  completedSetCount,
  exerciseTargetSummary,
  firstIncompleteExerciseIndex,
  firstIncompleteSetIndex,
  isCompletedSet,
  isExerciseHandled,
  isSessionHandled,
  nextIncompleteExerciseIndex,
  reconcileExerciseSets,
  resolveTrackingMode,
  validateSet,
} from "./workoutLogging";

const NBSP = " ";

// Why a swap is being made. The ranking in exerciseSubstitutions keys on these.
const SWAP_REASONS = [
  { value: "equipment", label: "Taken", ranked: "Ranked for equipment taken: options on other equipment first." },
  { value: "joint", label: "Discomfort", ranked: "Ranked for discomfort: joint-friendly options first." },
  { value: "fatigue", label: "Fatigue", ranked: "Ranked for fatigue: lower-fatigue options first." },
];
const SKIP_REASONS = [["equipment", "Equipment"], ["fatigue", "Fatigue"], ["time", "Time"]];
// A weekly total outside the range says so in words; inside it needs no remark.
const RANGE_WORDS = { below_mev: "below range", above_mrv: "above range" };
const sentence = (text) => String(text || "").replace(/^./, (first) => first.toUpperCase());

function fmtClock(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// A duration as it is read aloud: "1 minute 30 seconds".
function spokenClock(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return [
    minutes ? `${minutes} minute${minutes === 1 ? "" : "s"}` : null,
    rest || !minutes ? `${rest} second${rest === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" ");
}

// Where the sets are. Shown beside the title so it is never a guess.
function syncStatus({ online, saving, savePending }) {
  if (!online) return { key: "offline", label: "Offline", sr: "Offline. Every set stays on this phone and syncs later." };
  if (savePending) return { key: "pending", label: "Saved on device", sr: "Saved on this device. Sync is pending." };
  if (saving) return { key: "saving", label: "Saving", sr: "Saving" };
  return { key: "synced", label: "Saved", sr: "Saved" };
}

function dayMonth(dateKey) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }).replace(" ", NBSP);
}

// The rest timer. It shows the time left, takes Pause, +15 s and +30 s, and
// counts up once it has run out. It is a timer, not a live region: the start
// and the end are announced by the runner, never every tick.
function RestCard({ rest, remaining, over, onPause, onAdd }) {
  const paused = Boolean(rest.pausedAt);
  const elapsed = rest.seconds - remaining;
  const percent = over ? 100 : Math.max(0, Math.min(100, (elapsed / Math.max(1, rest.seconds)) * 100));
  return (
    <section className="card" aria-labelledby="rest-title" data-testid="rest-card" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, ...(over ? { borderColor: "var(--ink)" } : {}) }}>
      <div className="sec"><h3 id="rest-title" className="stamp">{over ? "Rest over" : paused ? "Rest paused" : "Rest"}</h3><span className="t-s c2">of {fmtClock(rest.seconds)}</span></div>
      <p className="n-xl" role="timer" aria-label={over ? `Rest over by ${spokenClock(-remaining)}` : `Rest, ${spokenClock(remaining)} left`} style={{ textAlign: "center" }}>
        {over ? `+${fmtClock(-remaining)}` : fmtClock(remaining)}
      </p>
      <span className="bar bar-t" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
      <div className="seg" style={{ marginTop: 4 }}>
        <button type="button" onClick={() => !over && onPause()} aria-disabled={over || undefined} style={{ minHeight: 56 }}><Icon name={paused ? "play" : "pause"} size="s" />{paused ? "Resume" : "Pause"}</button>
        <button type="button" className="n" aria-label="Add 15 seconds" onClick={() => onAdd(15)} style={{ minHeight: 56 }}>+15{NBSP}s</button>
        <button type="button" className="n" aria-label="Add 30 seconds" onClick={() => onAdd(30)} style={{ minHeight: 56 }}>+30{NBSP}s</button>
      </div>
    </section>
  );
}

// The exercises of the session, in order. The current one is marked; a row
// jumps to its exercise.
function Queue({ lifting, workoutData, current, onGo }) {
  return (
    <ol className="rows" data-testid="session-queue-list">
      {lifting.map((item, index) => {
        const data = workoutData?.exercises?.[item.name] || {};
        const done = completedSetCount(item, data);
        const state = data.skipped ? `Skipped: ${data.skipped}` : done >= item.sets ? "Done" : `${done} of ${item.sets} sets`;
        const here = index === current;
        return (
          <li key={`${item.name}-${index}`}>
            <button type="button" className="row" aria-current={here ? "step" : undefined} onClick={() => onGo(index)}>
              <span className="n-s c2" style={{ width: 16, flex: "none" }}>{index + 1}</span>
              <span className="kv grow"><span className={here ? "t-bs" : "t-b"} style={here ? undefined : { fontWeight: 400 }}>{data.performedName || item.name}</span><span className="t-s c2">{state}</span></span>
              {here ? <span className="tag tag-f">Now</span> : <Icon name={data.skipped || done >= item.sets ? "done" : "next"} size="s" className="c2" />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// Weekly sets per muscle once this session is finished, for muscles it still adds to.
function VolumeAfter({ projection }) {
  const rows = (projection?.rows || []).filter((row) => row.remaining > 0).slice(0, 4);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="volume-after" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h3 id="volume-after" className="t-ss">Sets this week, after this session</h3>
      <ul className="rows">
        {rows.map((row) => (
          <li key={row.key} className="row" style={{ minHeight: 40 }}>
            <span className="kv grow"><span className="t-bs">{row.label}</span><span className="t-s c2">{row.current} so far this week. Your range is {row.landmarks.mev} to {row.landmarks.mrv}.</span></span>
            <span className="n-s">{row.projected}{RANGE_WORDS[row.classification?.status] ? ` · ${RANGE_WORDS[row.classification.status]}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SessionMode({
  open,
  onClose: closeRunner,
  onFinish = null,
  lifting: configuredLifting,
  workoutData,
  onUpdate,
  todayKey,
  allData,
  onPR,
  todayName,
  settings,
  sessionId = "main",
  sessionLabel = "Session",
  saving = false,
  savePending = false,
  appOnline = true,
  programDay = null,
  bodyData = {},
  safetyFlag = false,
}) {
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const mediumPanes = useMediaQuery(WORKOUT_PANES_QUERY);
  const dockQueue = isBroadsheet || mediumPanes;
  const [idx, setIdx] = useState(0);
  const [activeSetIndex, setActiveSetIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(null);
  const [rest, setRest] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [validationError, setValidationError] = useState("");
  const [sheet, setSheet] = useState(null);
  const [skipAsk, setSkipAsk] = useState(false);
  const [substitutionReason, setSubstitutionReason] = useState("equipment");
  const [paired, setPaired] = useState(false);
  const [note, setNote] = useState("");
  const cuedRef = useRef(null);
  const pulse = useRef(null);
  const strap = useWhoopBluetooth();
  const onClose = () => {
    pulse.current?.flush();
    closeRunner();
  };
  const hapticsEnabled = settings?.trainingCues?.haptics !== false;
  const restAudioEnabled = settings?.trainingCues?.restAudio === true;
  const lifting = useMemo(() => configuredLifting || [], [configuredLifting]);
  const clinicianGuardrails = settings?.coachingSystem?.clinicianGuardrails || {};
  const guardrailsOn = clinicianGuardrails.enabled === true;
  // A pain flag on any set of this session is the safety flag the guardrails
  // act on. It is cleared from the stop screen if it was a mistake.
  let painSet = null;
  for (const item of lifting) {
    const data = workoutData?.exercises?.[item.name];
    const index = (data?.sets || []).findIndex((set) => set?.pain);
    if (index >= 0) { painSet = { name: data.performedName || item.name, index }; break; }
  }
  const hardStop = guardrailsOn && (safetyFlag === true || Boolean(painSet));
  const [browserOnline, setBrowserOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const online = appOnline !== false && browserOnline;

  useEffect(() => {
    const up = () => setBrowserOnline(true);
    const down = () => setBrowserOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  useScreenWakeLock(open);

  // The rest clock ticks only while a rest is running.
  const restRunning = Boolean(rest && !rest.pausedAt);
  useEffect(() => {
    if (!restRunning) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [restRunning]);
  const restRemaining = rest ? rest.seconds - ((rest.pausedAt || Math.max(now, rest.startedAt)) - rest.startedAt) / 1000 : 0;
  const restOver = Boolean(rest) && restRemaining <= 0;
  useEffect(() => {
    if (!rest || !restOver || cuedRef.current === rest.startedAt) return;
    cuedRef.current = rest.startedAt;
    triggerHaptic([200, 100, 200], hapticsEnabled);
    playRestChirp(restAudioEnabled);
  }, [rest, restOver, hapticsEnabled, restAudioEnabled]);
  // In the iPhone app a notification marks the end of the rest too, because
  // this timer stops when the phone locks. It follows the same cue settings
  // and is withdrawn when the rest is paused, skipped or left.
  const restEndsAt = rest && !rest.pausedAt ? rest.startedAt + rest.seconds * 1000 : null;
  const restAlertText = rest?.next?.line || null;
  useEffect(() => {
    if (!restEndsAt || !(hapticsEnabled || restAudioEnabled)) return undefined;
    scheduleRestAlert((restEndsAt - Date.now()) / 1000, restAlertText ? { body: restAlertText } : undefined);
    return () => { cancelRestAlert(); };
  }, [restEndsAt, restAlertText, hapticsEnabled, restAudioEnabled]);
  // And a timer on the Lock Screen, whatever the cue settings: moved on when
  // the rest changes, gone when it's paused or cleared and when the runner
  // closes. A rest that runs out stays up as "Rest over" until then.
  useEffect(() => {
    if (restEndsAt) showRestTimer((restEndsAt - Date.now()) / 1000, restAlertText || "");
    else hideRestTimer();
  }, [restEndsAt, restAlertText]);
  useEffect(() => () => { hideRestTimer(); }, []);

  const exercise = lifting?.[idx] || null;
  const exData = exercise ? (workoutData?.exercises?.[exercise.name] || {}) : {};
  const sets = exercise ? reconcileExerciseSets(exercise, exData.sets || []) : [];
  const performedName = exData.performedName || exercise?.name || "";

  const progressionExercise = useMemo(
    () => exercise ? { ...exercise, name: performedName } : null,
    [exercise, performedName]
  );
  const last = useMemo(
    () => progressionExercise ? getLastPerformance(allData, progressionExercise.name, todayKey) : null,
    [allData, progressionExercise, todayKey]
  );
  const prescription = useMemo(
    () => exercise ? sessionPrescription({ data: allData, exercise, performedName, dateKey: todayKey }) : null,
    [allData, exercise, performedName, todayKey]
  );
  const nextPrescription = useMemo(
    () => progressionExercise && !exercise.adaptivePrescription && isExerciseHandled(exercise, exData)
      ? buildExercisePrescription({ data: allData, exercise: progressionExercise, todayKey, currentSession: { date: todayKey, sets, performedName } })
      : null,
    [allData, progressionExercise, todayKey, sets, performedName, exercise, exData]
  );
  const lastRaw = useMemo(
    () => progressionExercise ? lastSessionSets(allData, progressionExercise.name, todayKey) : null,
    [allData, progressionExercise, todayKey]
  );
  const bestBefore = useMemo(
    () => priorBestWeight(allData, performedName, todayKey),
    [allData, performedName, todayKey]
  );
  const latestWarmup = Array.isArray(exData.warmupSets) ? exData.warmupSets.reduce((latest, entry) =>
    entry?.at && (!latest || entry.at > latest.at) ? entry : latest, null) : null;
  const workingWeight = Number.parseFloat(sets[activeSetIndex]?.weight) || prescriptionWeightAt(prescription, activeSetIndex)
    || latestWarmup?.workingWeight || null;
  const barbell = usesStandardBarbell(performedName);
  const plates = barbell && workingWeight ? calcPlateMath(workingWeight) : null;
  const ramp = useMemo(() => barbell && workingWeight ? buildWarmupRamp(workingWeight) : null, [barbell, workingWeight]);
  const subs = useMemo(() => exercise ? getRankedSubstitutions(exercise.name, { reason: substitutionReason }) : null, [exercise, substitutionReason]);
  const deload = useMemo(
    () => buildDeloadRecommendation({ data: allData, todayKey, body: bodyData, workout: workoutData, safetyFlag }),
    [allData, todayKey, bodyData, workoutData, safetyFlag]
  );
  const arbitration = useMemo(
    () => buildSessionArbitration({ programDay, workoutData, sessionId }),
    [programDay, workoutData, sessionId]
  );
  const volumeProjection = useMemo(
    () => buildSessionVolumeProjection({ data: allData, todayKey, lifting, workoutData }),
    [allData, todayKey, lifting, workoutData]
  );
  const canPair = idx < (lifting?.length || 0) - 1;
  const previous = lifting?.[idx - 1];
  const pairedFromPrev = previous && (workoutData?.exercises?.[previous.name]?.pairNext ?? readSupersetPref(todayName, previous.name));

  useEffect(() => {
    if (!open || !lifting?.length) return;
    const resumeIndex = firstIncompleteExerciseIndex(lifting, workoutData);
    setIdx(resumeIndex);
    const resumeExercise = lifting[resumeIndex];
    const resumeData = workoutData?.exercises?.[resumeExercise.name] || {};
    setActiveSetIndex(firstIncompleteSetIndex(reconcileExerciseSets(resumeExercise, resumeData.sets || []), resumeExercise));
    setRest(null);
    setValidationError("");
    const existing = workoutData?.sessionState?.[sessionId];
    if (!existing?.startedAt) {
      onUpdate(`workout.sessionState.${sessionId}`, { ...existing, status: "active", startedAt: new Date().toISOString() });
    }
    // onUpdate is intentionally excluded: opening the overlay is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  useEffect(() => {
    if (!exercise) return;
    setActiveSetIndex(firstIncompleteSetIndex(sets, exercise));
    setEditing(false);
    setChoice(null);
    setValidationError("");
    setSheet(null);
    setSkipAsk(false);
    setSubstitutionReason("equipment");
    setPaired(canPair && (exData.pairNext ?? readSupersetPref(todayName, exercise.name)));
    setNote(readExerciseNote(exercise.name));
    // sets is deliberately excluded; logging a set controls selection directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, exercise?.name, todayName, canPair, exData.pairNext]);

  if (!open || !exercise) return null;

  const saveExercise = (next) => onUpdate(`workout.exercises.${exercise.name}`, next);

  const replaceSet = (setIndex, nextSet) => {
    const next = sets.map((set, index) => index === setIndex ? { ...nextSet, watchEventID: undefined } : set);
    saveExercise({ ...exData, sets: next });
    if (validationError) setValidationError("");
  };

  const goToExercise = (nextIndex) => {
    const bounded = Math.max(0, Math.min(lifting.length - 1, nextIndex));
    setIdx(bounded);
  };

  const clearRest = () => {
    pulse.current?.endRest();
    setRest(null);
  };

  const reopenSet = (setIndex) => {
    const { completedAt, watchEventID, ...reopened } = sets[setIndex];
    void completedAt; void watchEventID;
    const reopenedSets = sets.map((set, index) => index === setIndex ? { ...reopened, done: false } : set);
    saveExercise({ ...exData, sets: reopenedSets, nextPrescription: undefined });
    setValidationError("");
    setEditing(false);
    clearRest();
    setActiveSetIndex(setIndex);
  };

  const bankSet = (setIndex) => {
    if (hardStop) {
      setValidationError("A clinician stop rule is active. End this session and follow your approved safety instructions.");
      triggerHaptic([100, 60, 100], hapticsEnabled);
      return;
    }
    if (sets[setIndex].done) { reopenSet(setIndex); return; }

    // What is on screen is what gets logged: an untouched set takes the
    // source it shows (the target, the set before, or last time).
    const { set: current, source } = proposeSet({ set: sets[setIndex], setIndex, sets, exercise, prescription, lastRaw, choice });
    const validation = validateSet(current, exercise);
    if (!validation.valid) {
      setValidationError(validation.message);
      triggerHaptic([80, 40, 80], hapticsEnabled);
      return;
    }

    const { completed, nextSets, exerciseComplete, exData: logged } = completeSet({
      exData, sets, setIndex, set: current, exercise, progressionExercise, prescription,
      data: allData, todayKey, performedName, selectedSource: choice || source?.key || "manual",
    });
    pulse.current?.logSet({ name: exercise.name, index: setIndex, completedAt: completed.completedAt, mode: resolveTrackingMode(progressionExercise) });
    saveExercise(logged);
    setValidationError("");
    setChoice(null);
    triggerHaptic(10, hapticsEnabled);
    if (onPR && completed.weight) onPR(performedName, Number.parseFloat(completed.weight) || 0, Number.parseInt(completed.reps, 10) || 0);

    const nextGlance = buildNextGlance({
      sets: nextSets,
      completedIndex: setIndex,
      exerciseName: exercise.name,
      last: lastRaw,
      nextExerciseName: lifting[idx + 1]?.name,
    });
    const startRest = () => {
      pulse.current?.startRest(completed.completedAt);
      cuedRef.current = null;
      setRest({ seconds: suggestRestSeconds(exercise), startedAt: Date.now(), pausedAt: null, next: nextGlance, setIndex, exerciseIdx: idx });
    };

    if (paired && canPair) {
      clearRest();
      setTimeout(() => goToExercise(idx + 1), 220);
      return;
    }

    if (pairedFromPrev) {
      startRest();
      const previousExercise = lifting[idx - 1];
      const previousData = workoutData?.exercises?.[previousExercise.name] || {};
      if (!isExerciseHandled(previousExercise, previousData)) {
        setTimeout(() => goToExercise(idx - 1), 220);
        return;
      }
    } else {
      // Nothing follows the session's last set, so nothing to rest for.
      const othersHandled = lifting.every((item, index) => index === idx || isExerciseHandled(item, workoutData?.exercises?.[item.name] || {}));
      if (exerciseComplete && othersHandled) clearRest();
      else startRest();
    }

    const nextSet = nextSets.findIndex((set) => !set.done);
    if (nextSet >= 0) setActiveSetIndex(nextSet);
  };

  const sessionDone = isSessionHandled(lifting, workoutData);
  const exerciseDone = isExerciseHandled(exercise, exData);
  const handledExercises = lifting.filter((item) => isExerciseHandled(item, workoutData?.exercises?.[item.name] || {})).length;
  // The next exercise still open: the next one down the list, else the first
  // one left behind by jumping ahead in the queue.
  const laterIndex = nextIncompleteExerciseIndex(lifting, workoutData, idx);
  const nextExerciseIndex = laterIndex >= 0 ? laterIndex
    : lifting.findIndex((item, index) => index !== idx && !isExerciseHandled(item, workoutData?.exercises?.[item.name] || {}));
  const nextSetIndex = sets.findIndex((set) => !isCompletedSet(set, exercise));
  const leftAfterThis = lifting.filter((item, index) => index !== idx && !isExerciseHandled(item, workoutData?.exercises?.[item.name] || {}));

  // The heaviest logged set today, when it beats every earlier day.
  let recordIndex = -1;
  if (bestBefore > 0) {
    let top = bestBefore;
    sets.forEach((set, index) => {
      const weight = Number.parseFloat(set.weight) || 0;
      if (set.done && weight > top) { top = weight; recordIndex = index; }
    });
  }

  const togglePair = () => {
    const next = !paired;
    setPaired(next);
    writeSupersetPref(todayName, exercise.name, next);
    saveExercise({ ...exData, pairNext: next });
  };

  const liftLogged = sets.some(set => set.done);
  const swapNote = "Reopen the logged sets before changing which exercise they belong to.";
  const chooseSubstitution = (substitution) => {
    if (liftLogged) return;
    saveExercise({ ...exData, sets, progressionDecision: undefined, nextPrescription: undefined,
      warmupSets: [], watchSwapAt: new Date().toISOString(), performedName: substitution?.name, substitutionReason: substitution ? substitutionReason : undefined });
    setSheet(null);
  };

  const skipExercise = (reason) => {
    saveExercise({ ...exData, sets, skipped: reason });
    setSkipAsk(false);
    setSheet(null);
    clearRest();
  };

  const toggleWarmup = (warmupIndex) => {
    const step = ramp.steps[warmupIndex];
    const done = !warmupEntry(exData.warmupSets, step)?.done;
    saveExercise({ ...exData, sets, warmupSets: updateWarmup(exData.warmupSets, step, done, new Date().toISOString(), workingWeight) });
  };

  const clearPainFlags = () => {
    for (const item of lifting) {
      const data = workoutData?.exercises?.[item.name];
      if (!data?.sets?.some((set) => set?.pain)) continue;
      onUpdate(`workout.exercises.${item.name}`, { ...data, sets: data.sets.map((set) => set?.pain ? { ...set, pain: false } : set) });
    }
  };

  const finishSession = () => {
    const currentState = workoutData?.sessionState?.[sessionId] || {};
    onUpdate(`workout.sessionState.${sessionId}`, {
      ...currentState,
      status: sessionDone ? "complete" : "active",
      ...(sessionDone ? { completedAt: new Date().toISOString() } : {}),
    });
    if (sessionDone) onFinish?.();
    onClose();
  };

  const pauseRest = () => {
    const at = Date.now();
    setNow(at);
    setRest((current) => {
      if (!current) return current;
      return current.pausedAt
        ? { ...current, startedAt: current.startedAt + (at - current.pausedAt), pausedAt: null }
        : { ...current, pausedAt: at };
    });
  };
  const addRest = (seconds) => {
    cuedRef.current = null;
    setRest((current) => current ? { ...current, seconds: current.seconds + seconds } : current);
  };
  const startNextSet = () => {
    clearRest();
    setEditing(false);
    if (nextSetIndex >= 0) setActiveSetIndex(nextSetIndex);
  };
  const goNextExercise = () => {
    clearRest();
    setEditing(false);
    if (nextExerciseIndex >= 0) goToExercise(nextExerciseIndex);
  };
  const openSetForEdit = (setIndex) => { setActiveSetIndex(setIndex); setEditing(true); setValidationError(""); };
  const closeEdit = () => {
    setEditing(false);
    if (nextSetIndex >= 0) setActiveSetIndex(nextSetIndex);
  };

  // One state at a time decides what the screen and its primary button are.
  const view = hardStop ? "stop"
    : exData.skipped ? "skipped"
    : editing ? "edit"
    : rest ? "rest"
    : exerciseDone ? "done"
    : "set";

  const nextName = nextExerciseIndex >= 0 ? (workoutData?.exercises?.[lifting[nextExerciseIndex].name]?.performedName || lifting[nextExerciseIndex].name) : null;
  const onward = sessionDone ? { label: "Finish session", onClick: finishSession }
    : nextName ? { label: `Next exercise: ${nextName}`, onClick: goNextExercise }
    : { label: "Exit session", onClick: onClose };
  // The set in the composer: the one opened for edit, else the first still open.
  const currentIndex = view === "set" && sets[activeSetIndex]?.done && nextSetIndex >= 0 ? nextSetIndex : activeSetIndex;
  const primary = view === "set" ? { label: "Log set", onClick: () => bankSet(currentIndex) }
    : view === "edit" ? { label: "Done editing", onClick: closeEdit }
    : view === "rest" ? (nextSetIndex >= 0
      ? { label: restOver ? `Start set ${nextSetIndex + 1}` : `Skip rest, start set ${nextSetIndex + 1}`, onClick: startNextSet }
      : restOver ? onward : { ...onward, label: sessionDone ? "Skip rest, finish session" : nextName ? "Skip rest, next exercise" : onward.label })
    : onward;
  const footHint = view === "set" ? (
      paired && canPair ? `Then straight to ${lifting[idx + 1].name}.`
      : pairedFromPrev ? `Then rest, then back to ${lifting[idx - 1].name}.`
      : `Rest starts when you log: ${fmtClock(suggestRestSeconds(exercise))}`
    )
    : view === "rest" ? "The timer never starts a set for you."
    : view === "edit" && rest ? (restOver ? "Rest is over." : `Rest: ${fmtClock(restRemaining)} left`)
    : null;

  const lastLoads = last?.weights.some(weight => weight !== last.weight)
    ? last.weights.map((weight, index) => `${weight}${NBSP}lb × ${last.reps[index]}`).join(", ")
    : last && `${last.weight}${NBSP}lb${NBSP}×${NBSP}${last.reps.join(", ")}`;
  const lastLine = last ? `Last time, ${dayMonth(last.date)}: ${lastLoads}.` : null;
  const restGlance = rest && rest.exerciseIdx === idx && rest.next
    ? [rest.next.line, rest.next.ghost].filter(Boolean).join(" · ")
    : nextSetIndex >= 0 ? `Next: set ${nextSetIndex + 1} of ${sets.length}` : null;
  const restStatus = !rest ? "" : restOver ? "Rest is over." : rest.pausedAt ? "Rest paused." : `Rest: ${spokenClock(rest.seconds)}.`;
  const showArbitration = arbitration.status !== "single" && arbitration.status !== "keep";
  const fatigueFlag = deload.status === "safety" || deload.status === "deload";
  const swapReason = SWAP_REASONS.find((entry) => entry.value === substitutionReason) || SWAP_REASONS[0];
  const justLogged = rest && rest.exerciseIdx === idx ? rest.setIndex : -1;

  const railCard = (title, children, testId) => (
    <section data-testid={testId} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <h3 className="t-ss">{title}</h3>
      {children}
    </section>
  );

  const warmupList = ramp && (
    <ul className="rows" data-testid="warmup-ramp">
      {ramp.steps.map((rampStep, index) => {
        const done = Boolean(warmupEntry(exData.warmupSets, rampStep)?.done);
        return (
          <li key={`${rampStep.weight}-${rampStep.reps}`}>
            <button type="button" className="row" aria-pressed={done} onClick={() => toggleWarmup(index)}>
              <Icon name={done ? "done" : "open"} className={done ? "good" : "c2"} />
              <span className="n grow">{rampStep.weight}{NBSP}lb{NBSP}×{NBSP}{rampStep.reps}</span>
              <span className="t-s c2">{rampStep.label}</span>
            </button>
          </li>
        );
      })}
      <li className="row" style={{ minHeight: 40 }}><span className="t-s c2">Then your working sets at {workingWeight}{NBSP}lb.</span></li>
    </ul>
  );

  const swapList = subs && (liftLogged ? <p className="t-s c2">{swapNote}</p> : (
    <>
      <Seg label="Why are you swapping?" options={SWAP_REASONS.map(({ value, label }) => ({ value, label }))} value={substitutionReason} onChange={setSubstitutionReason} />
      <p className="t-s c2">{swapReason.ranked}</p>
      <ol className="rows">
        {subs.subs.map((substitution, index) => (
          <li key={substitution.name} className="row" style={{ minHeight: 56 }}>
            <span className="n-s c2" style={{ width: 16, flex: "none" }}>{index + 1}</span>
            <span className="kv grow"><span className="t-bs">{substitution.name}</span><span className="t-s c2">{sentence([substitution.note, ...(substitution.tags || [])].filter(Boolean).join(" · "))}</span></span>
            <button type="button" className="btn btn-s btn-sm" aria-label={`Use ${substitution.name}`} onClick={() => chooseSubstitution(substitution)}>Use</button>
          </li>
        ))}
      </ol>
    </>
  ));

  return (
    <Flow label={`${sessionLabel} workout session`} onClose={onClose} data-screen="session">
      <div className="shell session-shell" style={isBroadsheet ? { maxWidth: "none" } : undefined}>
        <TopBar title={sessionLabel} close="Exit" onClose={onClose} status={syncStatus({ online, saving, savePending })}>
          <span className="t-s c2" style={{ flex: "none" }} aria-label={`Exercise ${idx + 1} of ${lifting.length}`}>{idx + 1} of {lifting.length}</span>
        </TopBar>
        <p className="sr" role="status">{restStatus}</p>
        {todayKey === getTodayKey() && strap && (
          <WhoopWorkoutPulse key={strap.owner + todayKey + sessionId} ref={pulse} saved={workoutData?.whoopHeartRate?.[sessionId]}
            workout={workoutData} data={allData} dateKey={todayKey}
            onSave={summary => onUpdate(`workout.whoopHeartRate.${sessionId}`, { ...summary, label: sessionLabel })} />
        )}

        {!online && (
          <p className="banner" data-testid="session-offline-stamp" role="status" style={{ margin: "8px 16px 0" }}>
            <Icon name="offline" size="s" /><span>Offline. Every set stays on this phone and syncs later.</span>
          </p>
        )}

        <div className="session-layout" style={isBroadsheet ? { display: "grid", gridTemplateColumns: "340px minmax(0, 1fr) 380px", flex: "1 1 auto", minHeight: 0 } : undefined}>
          {dockQueue && (
            <aside data-section="session-queue" aria-label="Session queue" className="session-queue">
              <div className="sec"><h2 className="t-title">Queue</h2><span className="t-s c2">{handledExercises} of {lifting.length} done</span></div>
              <Queue lifting={lifting} workoutData={workoutData} current={idx} onGo={(index) => { clearRest(); goToExercise(index); }} />
              <button type="button" className="btn btn-s btn-b" onClick={() => setSheet("add")}><Icon name="plus" size="s" />Add an exercise</button>
            </aside>
          )}

          <div className="session-workspace" style={isBroadsheet ? { display: "flex", flexDirection: "column", minWidth: 0 } : undefined}>
          <div className="main" style={isBroadsheet ? { maxWidth: 560, width: "100%", margin: "0 auto" } : undefined}>
            {view === "stop" ? (
              <>
                <section role="alert" data-testid="clinician-guardrail" style={{ display: "flex", flexDirection: "column", gap: 10, border: "2px solid var(--stop)", borderRadius: "var(--r)", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon name="warn" className="stop" /><h2 style={{ font: "700 22px/28px var(--f-ui)" }}>Stop here.</h2></div>
                  <p className="t-b">A safety rule you entered from your clinician has been met. Logging is paused until you end the session or clear the flag.</p>
                  {painSet && <p className="t-s c2">Raised by: pain flagged on set {painSet.index + 1} of {painSet.name}.</p>}
                </section>
                {clinicianGuardrails.stopRules && (
                  <section aria-labelledby="stop-rules" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <h3 id="stop-rules" className="t-h">Your stop rules</h3>
                    <p className="t-b">{clinicianGuardrails.stopRules}</p>
                  </section>
                )}
                {clinicianGuardrails.emergencyInstructions && (
                  <section className="card" aria-labelledby="stop-emergency" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <h3 id="stop-emergency" className="t-h">Your emergency instructions</h3>
                    <p className="t-b">{clinicianGuardrails.emergencyInstructions}</p>
                  </section>
                )}
                <p className="t-s c2">You wrote these rules with your clinician. The app does not change them.</p>
              </>
            ) : (
              <>
                {guardrailsOn && (clinicianGuardrails.trainingRestrictions || clinicianGuardrails.exerciseHeartRateGuidance) && (
                  <div className="banner" data-testid="clinician-guardrail">
                    <Icon name="info" size="s" />
                    <span><span className="t-ss">Clinician constraints</span><br />{clinicianGuardrails.trainingRestrictions || clinicianGuardrails.exerciseHeartRateGuidance}</span>
                  </div>
                )}
                {fatigueFlag && (
                  <div className="banner" data-testid="fatigue-intervention" style={deload.status === "safety" ? { borderColor: "var(--stop)" } : undefined}>
                    <Icon name="warn" size="s" className={deload.status === "safety" ? "stop" : "caution"} />
                    <span>
                      <span className="t-ss">{deload.headline}.</span> {deload.guidance}
                      {deload.prescription && <><br /><span className="n-s">Sets −{deload.prescription.volumeReductionPct}% · load about {deload.prescription.loadPct}% · RIR {deload.prescription.targetRir}</span></>}
                    </span>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="kv grow">
                    <h2 style={{ font: "600 22px/28px var(--f-ui)" }}>{performedName}</h2>
                    {performedName !== exercise.name && <p className="t-s c2">In place of {exercise.name} today.</p>}
                    <p className="t-s c2">{exerciseTargetSummary(exercise)}</p>
                    {lastLine && <p className="t-s c2">{lastLine}</p>}
                  </div>
                  <button type="button" className="ibtn ibtn-o" aria-haspopup="dialog" aria-label="Exercise options: swap, notes, warm-up, plate math, skip" onClick={() => { setSkipAsk(false); setSheet("options"); }}><Icon name="more" /></button>
                </div>

                {!isBroadsheet && showArbitration && (
                  <div className="banner" data-testid="session-arbitration"><Icon name="info" size="s" /><span><span className="t-ss">{arbitration.headline}.</span> {arbitration.guidance}</span></div>
                )}
                {paired && canPair && (
                  <div className="row" style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", minHeight: 56 }}>
                    <span className="kv grow"><span id="superset-on" className="t-bs">Superset with {lifting[idx + 1].name}</span><span className="t-s c2">Remembered for {todayName}</span></span>
                    <Switch checked onChange={togglePair} labelledBy="superset-on" />
                  </div>
                )}
                {pairedFromPrev && <p className="t-s c2">Second half of a superset with {lifting[idx - 1].name}. Rest comes after this set.</p>}

                {view === "skipped" ? (
                  <div className="banner" style={{ alignItems: "center" }}>
                    <span className="grow"><span className="t-ss">Skipped today.</span> Reason: {exData.skipped}.</span>
                    <button type="button" className="btn btn-s btn-sm" onClick={() => saveExercise({ ...exData, sets, skipped: undefined })}>Undo skip</button>
                  </div>
                ) : (
                  <LoggedSets exercise={exercise} sets={sets} activeIndex={view === "edit" ? currentIndex : -1} freshIndex={view === "rest" ? justLogged : -1} recordIndex={recordIndex} onSelect={openSetForEdit} />
                )}

                {view === "rest" && (
                  <>
                    {justLogged >= 0 && <CascadeSet set={sets[justLogged]} showOffer isLast compact offerLabel={`Add to set ${justLogged + 1}`} onChange={(nextSet) => replaceSet(justLogged, nextSet)} />}
                    <RestCard rest={rest} remaining={restRemaining} over={restOver} onPause={pauseRest} onAdd={addRest} />
                    {restGlance && <p className="t-s c2" data-testid="rest-glance">{restGlance}</p>}
                  </>
                )}

                {(view === "set" || view === "edit") && (
                  <CurrentSetComposer
                    key={`${exercise.name}-${currentIndex}`}
                    exercise={exercise}
                    sets={sets}
                    setIndex={currentIndex}
                    onReplaceSet={replaceSet}
                    onReopenSet={reopenSet}
                    lastRaw={lastRaw}
                    error={validationError}
                    prescription={nextPrescription ? null : prescription}
                    choice={choice}
                    onChoice={setChoice}
                    onAcceptPrescription={(setIndex, nextSet) => {
                      if (!exData.progressionDecision) {
                        onUpdate(`workout.exercises.${exercise.name}.progressionDecision`, buildProgressionDecision(prescription, nextSet, { setIndex, selectedSource: "target" }));
                      }
                    }}
                  />
                )}

                {(view === "done" || view === "skipped") && nextPrescription && (
                  <section className="card" data-testid="next-session-prescription" aria-labelledby="next-session" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <h3 id="next-session" className="t-ss">Next session</h3>
                    <p className="n">{formatPrescription(nextPrescription)}</p>
                    <p className="t-s c2">{nextPrescription.rationale}</p>
                  </section>
                )}

                {!dockQueue && (
                  <button type="button" className="row" aria-haspopup="dialog" onClick={() => setSheet("queue")} style={{ borderTop: "1px solid var(--line)" }}>
                    <span className="kv grow">
                      <span className="t-bs">Queue</span>
                      <span className="t-s c2 clip">{leftAfterThis.length ? `${leftAfterThis.length} exercise${leftAfterThis.length === 1 ? "" : "s"} left: ${leftAfterThis.map((item) => item.name).join(", ")}` : "Nothing left after this"}</span>
                    </span>
                    <Icon name="next" size="s" className="c2" />
                  </button>
                )}
              </>
            )}
          </div>
          <div className="foot" style={isBroadsheet ? { maxWidth: 560, width: "100%", margin: "0 auto" } : undefined}>
            {view === "stop" ? (
              <>
                <button type="button" className="btn btn-p btn-lg btn-b" onClick={finishSession}>End session and save</button>
                {painSet && safetyFlag !== true && <button type="button" className="btn btn-s btn-b" onClick={clearPainFlags}>That flag was a mistake</button>}
              </>
            ) : (
              <>
                <button type="button" className="btn btn-p btn-lg btn-b" onClick={primary.onClick}>{primary.label}</button>
                {footHint && <p className="t-s c2" style={{ textAlign: "center" }}>{footHint}</p>}
              </>
            )}
          </div>
          </div>

          {isBroadsheet && (
            <aside data-section="session-rail" aria-label="Session detail" style={{ borderLeft: "1px solid var(--line)", padding: "8px 24px 16px", display: "flex", flexDirection: "column" }}>
              {showArbitration && railCard(arbitration.headline, <p className="t-s c2">{arbitration.guidance}</p>, "session-arbitration")}
              {railCard("Fatigue watch", <p className="t-s c2"><span className="t-bs" style={{ color: "var(--ink)" }}>{deload.headline}.</span> {deload.guidance}</p>)}
              <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}><VolumeAfter projection={volumeProjection} /></div>
              {plates && railCard("Plate math", <p className="n-s">{workingWeight}{NBSP}lb: {plates.label}</p>)}
              {ramp && railCard("Warm-up ramp", warmupList)}
              {subs && railCard(`Swap ${exercise.name}`, swapList)}
            </aside>
          )}
        </div>

      </div>

      <Sheet open={sheet === "options"} title={performedName} onClose={() => setSheet(null)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {exData.performedName && exData.performedName !== exercise.name ? (
            <div className="row" style={{ minHeight: 56 }}>
              <span className="kv grow"><span className="t-bs">Swapped in today</span><span className="t-s c2">{liftLogged ? swapNote : `Your program keeps ${exercise.name}.`}</span></span>
              <button type="button" className="btn btn-s btn-sm" disabled={liftLogged} onClick={() => chooseSubstitution(null)}>Undo swap</button>
            </div>
          ) : subs && (
            <button type="button" className="row" disabled={liftLogged} onClick={() => setSheet("swap")}>
              <span className="kv grow"><span className="t-bs">Swap exercise</span><span className="t-s c2">{liftLogged ? swapNote : `${subs.subs.length} alternatives for today`}</span></span>
              <Icon name="next" size="s" className="c2" />
            </button>
          )}
          {canPair && (
            <div className="row" style={{ minHeight: 56 }}>
              <span className="kv grow"><span id="superset-toggle" className="t-bs">Superset with {lifting[idx + 1].name}</span><span className="t-s c2">No rest between the two. Remembered for {todayName}.</span></span>
              <Switch checked={paired} onChange={togglePair} labelledBy="superset-toggle" />
            </div>
          )}
          <label className="field">
            <span className="lbl">Setup note</span>
            <span className="hint">Seat, pin, grip. Kept for this exercise.</span>
            <input className="input" type="text" autoComplete="off" maxLength={140} value={note} onChange={(event) => { setNote(event.target.value); writeExerciseNote(exercise.name, event.target.value); }} />
          </label>
          {plates && (
            <div className="kv"><span className="t-ss">Plate math</span><span className="n-s">{workingWeight}{NBSP}lb: {plates.label}</span></div>
          )}
          {ramp && !isBroadsheet && (
            <section aria-labelledby="ramp-title" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h3 id="ramp-title" className="t-ss">Warm-up ramp</h3>
              {warmupList}
            </section>
          )}
          <div data-testid="skip-row" style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            {exData.skipped ? (
              <button type="button" className="btn btn-s" onClick={() => { saveExercise({ ...exData, sets, skipped: undefined }); setSheet(null); }}>Undo skip</button>
            ) : skipAsk ? (
              <>
                <span id="skip-why" className="lbl">Why are you skipping it?</span>
                <div className="chips" role="group" aria-labelledby="skip-why">
                  {SKIP_REASONS.map(([reason, label]) => <button key={reason} type="button" className="chip" onClick={() => skipExercise(reason)}>{label}</button>)}
                  <button type="button" className="btn btn-g btn-sm" onClick={() => setSkipAsk(false)}>Cancel</button>
                </div>
              </>
            ) : (
              <button type="button" className="btn btn-g" onClick={() => setSkipAsk(true)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>Skip this exercise</button>
            )}
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === "swap"} title={`Swap ${exercise.name}`} onClose={() => setSheet(null)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {swapList}
          <p className="t-s c2">A swap is for today. Your program keeps {exercise.name}.</p>
          <button type="button" className="btn btn-g" onClick={() => { setSkipAsk(true); setSheet("options"); }} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>Skip this exercise instead</button>
        </div>
      </Sheet>

      <Sheet open={sheet === "queue"} title="Queue" onClose={() => setSheet(null)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="t-s c2">{handledExercises} of {lifting.length} exercises done. Choose one to go to it.</p>
          <Queue lifting={lifting} workoutData={workoutData} current={idx} onGo={(index) => { setSheet(null); clearRest(); goToExercise(index); }} />
          <button type="button" className="btn btn-s btn-b" onClick={() => setSheet("add")}><Icon name="plus" size="s" />Add an exercise</button>
          <VolumeAfter projection={volumeProjection} />
        </div>
      </Sheet>

      {/* For today only; it joins the end of the queue. */}
      <AddExerciseSheet
        open={sheet === "add"}
        onClose={() => setSheet(dockQueue ? null : "queue")}
        allData={allData}
        todayKey={todayKey}
        existing={lifting.map((item) => item.name)}
        onAdd={(item) => {
          onUpdate("workout.added", addToDay(workoutData, { ...item, session: sessionId }));
          setSheet(dockQueue ? null : "queue");
        }}
      />
    </Flow>
  );
}

export default SessionMode;
