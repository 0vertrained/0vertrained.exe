// src/SessionMode.jsx
// V18.2 · Adaptive Set Flow — focused logging with progression intelligence.
// Session Mode remains a lens over workout.exercises; the revamp centralizes
// completion rules, resumes intelligently, and makes the current set the hero.

import { useState, useEffect, useRef, useMemo } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { useTheme } from "./theme";
import { CurrentSetComposer } from "./workout/CurrentSetComposer";
import { lastSessionSets, buildNextGlance } from "./setGhosts";
import { getLastPerformance, calcPlateMath, suggestRestSeconds, buildWarmupRamp } from "./sessionIntelligence";
import { getRankedSubstitutions, REASON_LABELS } from "./exerciseSubstitutions";
import { buildExercisePrescription, buildProgressionDecision, formatPrescription } from "./progressionEngine";
import { buildDeloadRecommendation } from "./fatigueManagement";
import { buildSessionArbitration, buildSessionVolumeProjection } from "./trainingArbitration";
import { readExerciseNote, writeExerciseNote, readSupersetPref, writeSupersetPref } from "./liftLogPrefs";
import { playRestChirp, triggerHaptic, useScreenWakeLock } from "./sessionDevice";
import {
  completedSetCount,
  firstIncompleteExerciseIndex,
  firstIncompleteSetIndex,
  isExerciseHandled,
  isSessionHandled,
  nextIncompleteExerciseIndex,
  reconcileExerciseSets,
  validateSet,
} from "./workoutLogging";

function fmtClock(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function RestTimer({ seconds, startedAt, onClear, onAdjust, hapticsEnabled, audioEnabled, next = null }) {
  const { C } = useTheme();
  const [now, setNow] = useState(Date.now());
  const [cueActive, setCueActive] = useState(false);
  const completedTimerRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  const remaining = seconds - elapsed;
  const over = remaining <= 0;

  useEffect(() => {
    if (!startedAt || !over || completedTimerRef.current === startedAt) return;
    completedTimerRef.current = startedAt;
    triggerHaptic([200, 100, 200], hapticsEnabled);
    playRestChirp(audioEnabled);
    setCueActive(true);
    const id = setTimeout(() => setCueActive(false), 2000);
    return () => clearTimeout(id);
  }, [startedAt, over, hapticsEnabled, audioEnabled]);

  if (!startedAt) return null;
  return (
    <div style={{ padding: "9px 16px 10px", borderBottom: `1px solid ${cueActive ? C.text : C.line}`, background: cueActive ? C.text : C.block, color: cueActive ? C.bg : C.text, transition: "background 120ms ease, color 120ms ease" }} aria-live="assertive">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 9.5, letterSpacing: "0.15em", textTransform: "uppercase", color: cueActive ? C.bg : over ? C.text : C.textDim, fontFamily: C.fontFamily }}>
            {over ? "Rest done — next set" : "Rest"}
          </span>
          {next && (
            <span data-testid="rest-glance" style={{ display: "block", marginTop: 2, fontFamily: C.fontFamily, fontSize: 10, letterSpacing: "0.04em", color: cueActive ? C.bg : C.textFaint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {next.line}{next.ghost ? ` · ${next.ghost}` : ""}
            </span>
          )}
        </span>
        <span style={{ fontFamily: C.serifFamily, fontSize: 27, fontVariantNumeric: "tabular-nums", color: cueActive ? C.bg : over ? C.green : C.text, lineHeight: 1 }}>
          {over ? `+${fmtClock(-remaining)}` : fmtClock(remaining)}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
        <button type="button" onClick={() => onAdjust(-30)} style={{ border: `1px solid ${cueActive ? C.bg : C.lineBright}`, background: "none", color: cueActive ? C.bg : C.textDim, minHeight: 34, fontFamily: C.fontFamily, cursor: "pointer" }}>−30s</button>
        <button type="button" onClick={onClear} style={{ border: `1px solid ${cueActive ? C.bg : C.lineBright}`, background: "none", color: cueActive ? C.bg : C.text, minHeight: 34, fontFamily: C.fontFamily, cursor: "pointer" }}>Skip rest</button>
        <button type="button" onClick={() => onAdjust(30)} style={{ border: `1px solid ${cueActive ? C.bg : C.lineBright}`, background: "none", color: cueActive ? C.bg : C.textDim, minHeight: 34, fontFamily: C.fontFamily, cursor: "pointer" }}>+30s</button>
      </div>
    </div>
  );
}

function saveLabel({ online, saving, savePending }) {
  if (!online) return "Saved on device";
  if (savePending) return "Sync pending";
  if (saving) return "Syncing…";
  return "Saved on device";
}

export function SessionMode({
  open,
  onClose,
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
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const [idx, setIdx] = useState(0);
  const [activeSetIndex, setActiveSetIndex] = useState(0);
  const [rest, setRest] = useState(null);
  const [validationError, setValidationError] = useState("");
  const [skipAsk, setSkipAsk] = useState(false);
  const [rampOpen, setRampOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);
  const [substitutionReason, setSubstitutionReason] = useState("equipment");
  const [paired, setPaired] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const scrollRef = useRef(null);
  const hapticsEnabled = settings?.trainingCues?.haptics !== false;
  const restAudioEnabled = settings?.trainingCues?.restAudio === true;
  const activePlan = settings?.coachingSystem?.activePlan || null;
  const activeVolumeReduction = Math.max(0, Math.min(60, Number.parseFloat(activePlan?.snapshot?.trainingModifiers?.volumeReductionPct) || 0));
  const lifting = useMemo(() => (configuredLifting || []).map((item) => ({
    ...item,
    sets: activeVolumeReduction > 0
      ? Math.max(1, Math.ceil((Number.parseInt(item.sets, 10) || 1) * (1 - activeVolumeReduction / 100)))
      : item.sets,
  })), [configuredLifting, activeVolumeReduction]);
  const clinicianGuardrails = settings?.coachingSystem?.clinicianGuardrails || {};
  const hardStop = clinicianGuardrails.enabled === true && safetyFlag === true;
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
    () => progressionExercise ? buildExercisePrescription({ data: allData, exercise: progressionExercise, todayKey }) : null,
    [allData, progressionExercise, todayKey]
  );
  const nextPrescription = useMemo(
    () => progressionExercise && isExerciseHandled(exercise, exData)
      ? buildExercisePrescription({ data: allData, exercise: progressionExercise, todayKey, currentSession: { date: todayKey, sets, performedName } })
      : null,
    [allData, progressionExercise, todayKey, sets, performedName, exercise, exData]
  );
  const lastRaw = useMemo(
    () => progressionExercise ? lastSessionSets(allData, progressionExercise.name, todayKey) : null,
    [allData, progressionExercise, todayKey]
  );
  const workingWeight = Number.parseFloat(sets.find((set) => set.weight)?.weight) || prescription?.targetWeight || null;
  const plates = workingWeight ? calcPlateMath(workingWeight) : null;
  const ramp = useMemo(() => workingWeight ? buildWarmupRamp(workingWeight) : null, [workingWeight]);
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
  const pairedFromPrev = idx > 0 && lifting[idx - 1] && readSupersetPref(todayName, lifting[idx - 1].name);

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
    setValidationError("");
    setSkipAsk(false);
    setRampOpen(false);
    setSubsOpen(false);
    setSubstitutionReason("equipment");
    setPaired(canPair ? readSupersetPref(todayName, exercise.name) : false);
    setNote(readExerciseNote(exercise.name));
    setNoteOpen(false);
    scrollRef.current?.scrollTo?.(0, 0);
    // sets is deliberately excluded; banking a set controls selection directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, exercise?.name, todayName, canPair]);

  if (!open || !exercise) return null;

  const replaceSet = (setIndex, nextSet) => {
    const next = sets.map((set, index) => index === setIndex ? nextSet : set);
    onUpdate(`workout.exercises.${exercise.name}`, { ...exData, sets: next });
  };

  const goToExercise = (nextIndex) => {
    const bounded = Math.max(0, Math.min(lifting.length - 1, nextIndex));
    setIdx(bounded);
  };

  const bankSet = (setIndex) => {
    if (hardStop) {
      setValidationError("Clinician guardrail is active. Stop this session and follow your approved safety instructions.");
      triggerHaptic([100, 60, 100], hapticsEnabled);
      return;
    }
    const current = sets[setIndex];
    if (current.done) {
      const { completedAt, ...reopened } = current;
      void completedAt;
      const reopenedSets = sets.map((set, index) => index === setIndex ? { ...reopened, done: false } : set);
      onUpdate(`workout.exercises.${exercise.name}`, { ...exData, sets: reopenedSets, nextPrescription: undefined });
      setValidationError("");
      return;
    }

    const validation = validateSet(current, exercise);
    if (!validation.valid) {
      setValidationError(validation.message);
      triggerHaptic([80, 40, 80], hapticsEnabled);
      return;
    }

    const completed = { ...current, done: true, completedAt: new Date().toISOString() };
    const nextSets = sets.map((set, index) => index === setIndex ? completed : set);
    const progressionDecision = exData.progressionDecision || buildProgressionDecision(prescription, completed);
    const exerciseComplete = nextSets.every((set) => set.done && validateSet(set, exercise).valid);
    const generatedNext = exerciseComplete
      ? buildExercisePrescription({ data: allData, exercise: progressionExercise, todayKey, currentSession: { date: todayKey, sets: nextSets, performedName } })
      : undefined;
    onUpdate(`workout.exercises.${exercise.name}`, {
      ...exData,
      sets: nextSets,
      skipped: undefined,
      progressionDecision,
      ...(generatedNext ? { nextPrescription: generatedNext } : {}),
    });
    setValidationError("");
    triggerHaptic(10, hapticsEnabled);
    if (onPR && completed.weight) onPR(exercise.name, Number.parseFloat(completed.weight) || 0, Number.parseInt(completed.reps, 10) || 0);

    const nextGlance = buildNextGlance({
      sets: nextSets,
      completedIndex: setIndex,
      exerciseName: exercise.name,
      last: lastRaw,
      nextExerciseName: lifting[idx + 1]?.name,
    });

    if (paired && canPair) {
      setRest(null);
      setTimeout(() => goToExercise(idx + 1), 220);
      return;
    }

    if (pairedFromPrev) {
      setRest({ seconds: suggestRestSeconds(exercise), startedAt: Date.now(), next: nextGlance });
      const previousExercise = lifting[idx - 1];
      const previousData = workoutData?.exercises?.[previousExercise.name] || {};
      if (!isExerciseHandled(previousExercise, previousData)) {
        setTimeout(() => goToExercise(idx - 1), 220);
        return;
      }
    } else {
      setRest({ seconds: suggestRestSeconds(exercise), startedAt: Date.now(), next: nextGlance });
    }

    const nextSet = nextSets.findIndex((set) => !set.done);
    if (nextSet >= 0) setActiveSetIndex(nextSet);
  };

  const sessionDone = isSessionHandled(lifting, workoutData);
  const doneCount = completedSetCount(exercise, exData);
  const handledExercises = lifting.filter((item) => isExerciseHandled(item, workoutData?.exercises?.[item.name] || {})).length;
  const nextExerciseIndex = nextIncompleteExerciseIndex(lifting, workoutData, idx);

  const togglePair = () => {
    const next = !paired;
    setPaired(next);
    writeSupersetPref(todayName, exercise.name, next);
  };

  const chooseSubstitution = (substitution) => {
    onUpdate(`workout.exercises.${exercise.name}`, {
      ...exData,
      sets,
      performedName: substitution.name,
      substitutionReason,
    });
    setSubsOpen(false);
  };

  const toggleWarmup = (warmupIndex) => {
    const current = Array.isArray(exData.warmupSets) ? exData.warmupSets : [];
    const next = ramp.steps.map((rampStep, index) => ({
      weight: rampStep.weight,
      reps: rampStep.reps,
      done: index === warmupIndex ? !current[index]?.done : Boolean(current[index]?.done),
    }));
    onUpdate(`workout.exercises.${exercise.name}`, { ...exData, sets, warmupSets: next });
  };

  const finishSession = () => {
    const currentState = workoutData?.sessionState?.[sessionId] || {};
    onUpdate(`workout.sessionState.${sessionId}`, {
      ...currentState,
      status: sessionDone ? "complete" : "active",
      ...(sessionDone ? { completedAt: new Date().toISOString() } : {}),
    });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 350, background: C.bg, display: "flex", flexDirection: "column" }} role="dialog" aria-modal="true" aria-label={`${sessionLabel} workout session`}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer", padding: 0 }}>← Exit</button>
        <div style={{ textAlign: "center", minWidth: 0 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text, fontFamily: mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sessionLabel}</div>
          <div style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint, fontFamily: mono }}>{handledExercises}/{lifting.length} exercises</div>
        </div>
        <span role="status" style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: savePending ? C.amber : C.textDim, fontFamily: mono, whiteSpace: "nowrap" }}>
          {saveLabel({ online, saving, savePending })}
        </span>
      </div>

      {!online && (
        <div data-testid="session-offline-stamp" role="status" style={{ padding: "6px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel, fontFamily: mono, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, textAlign: "center" }}>
          Offline · every set stays on this phone and syncs later
        </div>
      )}

      <RestTimer
        seconds={rest?.seconds || 0}
        startedAt={rest?.startedAt}
        next={rest?.next}
        onClear={() => setRest(null)}
        onAdjust={(delta) => setRest((current) => current ? { ...current, seconds: Math.max(0, current.seconds + delta) } : current)}
        hapticsEnabled={hapticsEnabled}
        audioEnabled={restAudioEnabled}
      />

      {clinicianGuardrails.enabled === true && (hardStop || clinicianGuardrails.trainingRestrictions || clinicianGuardrails.exerciseHeartRateGuidance) && (
        <div data-testid="clinician-guardrail" role="status" style={{ padding: "10px 16px", borderBottom: `1px solid ${hardStop ? C.red : C.amber}`, background: C.panel }}>
          <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: hardStop ? C.red : C.amber }}>{hardStop ? "Clinician stop rule active" : "Clinician constraints active"}</div>
          <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.45, color: C.text }}>{hardStop ? clinicianGuardrails.stopRules : clinicianGuardrails.trainingRestrictions || clinicianGuardrails.exerciseHeartRateGuidance}</div>
          {hardStop && clinicianGuardrails.emergencyInstructions && <div style={{ marginTop: 4, fontFamily: mono, fontSize: 10, color: C.textDim }}>{clinicianGuardrails.emergencyInstructions}</div>}
        </div>
      )}

      {activeVolumeReduction > 0 && !hardStop && (
        <div data-testid="active-plan-modifier" role="status" style={{ padding: "7px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel, fontFamily: mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textDim }}>
          {activePlan?.label || "Active plan"} · working sets reduced {activeVolumeReduction}%
        </div>
      )}

      {(deload.status === "safety" || deload.status === "deload") && (
        <div data-testid="fatigue-intervention" role="status" style={{ padding: "10px 16px", borderBottom: `1px solid ${deload.status === "safety" ? C.red : C.amber}`, background: C.panel }}>
          <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: deload.status === "safety" ? C.red : C.amber }}>{deload.headline}</div>
          <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.45, color: C.text }}>{deload.guidance}</div>
          {deload.prescription && <div style={{ marginTop: 4, fontFamily: mono, fontSize: 10, color: C.textDim }}>Sets −{deload.prescription.volumeReductionPct}% · load ≈{deload.prescription.loadPct}% · RIR {deload.prescription.targetRir}</div>}
        </div>
      )}

      <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "340px minmax(0, 1fr) 380px", flex: 1, minHeight: 0 } : { display: "contents" }}>
        {isBroadsheet && (
          <aside data-section="session-queue" style={{ minHeight: 0, overflowY: "auto", borderRight: `1px solid ${C.line}` }}>
            <div style={{ padding: "12px 16px 6px", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim, fontFamily: mono }}>Exercise queue</div>
            {lifting.map((item, exerciseIndex) => {
              const itemData = workoutData?.exercises?.[item.name] || {};
              const handled = isExerciseHandled(item, itemData);
              return (
                <button key={`${item.name}-${exerciseIndex}`} type="button" onClick={() => goToExercise(exerciseIndex)}
                  style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", padding: "11px 16px", background: exerciseIndex === idx ? C.block : "none", border: "none", borderBottom: `1px solid ${C.line}`, borderLeft: exerciseIndex === idx ? `2px solid ${C.text}` : "2px solid transparent", color: handled ? C.textFaint : C.text, fontFamily: mono, fontSize: 12, cursor: "pointer" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{itemData.performedName || item.name}</span>
                  <span style={{ color: C.textFaint, fontSize: 10.5, whiteSpace: "nowrap" }}>{itemData.skipped ? "SKIP" : handled ? "DONE" : `${completedSetCount(item, itemData)}/${item.sets}`}</span>
                </button>
              );
            })}
          </aside>
        )}

        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.line}`, background: C.block }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.textDim, fontFamily: mono }}>
                  Exercise {idx + 1} of {lifting.length} · {doneCount}/{exercise.sets} sets
                </div>
                <div style={{ fontFamily: C.serifFamily, fontSize: 25, fontWeight: 500, letterSpacing: "-0.02em", color: C.text, marginTop: 3, lineHeight: 1.1 }}>
                  {performedName}
                </div>
                {performedName !== exercise.name && (
                  <button type="button" onClick={() => onUpdate(`workout.exercises.${exercise.name}`, { ...exData, sets, performedName: undefined, substitutionReason: undefined })} style={{ marginTop: 4, padding: 0, border: "none", background: "none", color: C.textFaint, fontFamily: mono, fontSize: 9.5, cursor: "pointer" }}>
                    Planned: {exercise.name} · undo substitution
                  </button>
                )}
              </div>
              <span style={{ fontFamily: mono, fontSize: 10, color: exData.skipped ? C.amber : isExerciseHandled(exercise, exData) ? C.green : C.textFaint }}>
                {exData.skipped ? "SKIPPED" : isExerciseHandled(exercise, exData) ? "COMPLETE" : "ACTIVE"}
              </span>
            </div>

            {last && <div style={{ fontSize: 11, color: C.textDim, marginTop: 7, fontFamily: mono }}>Last time · {last.label} <span style={{ color: C.textFaint }}>({last.date.slice(5)})</span></div>}
            {nextPrescription && (
              <div data-testid="next-session-prescription" style={{ marginTop: 8, padding: "8px 10px", border: `1px solid ${C.green}`, fontSize: 11.5, color: C.text, lineHeight: 1.45 }}>
                <span style={{ display: "block", fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.green }}>Next session</span>
                <span style={{ display: "block", marginTop: 2 }}>{formatPrescription(nextPrescription)} · {nextPrescription.rationale}</span>
              </div>
            )}
            {!isBroadsheet && arbitration.status !== "single" && arbitration.status !== "keep" && (
              <div data-testid="session-arbitration" style={{ marginTop: 8, padding: "8px 10px", border: `1px solid ${C.line}`, fontSize: 10.5, color: C.textDim, lineHeight: 1.45 }}>
                <strong style={{ color: C.text }}>{arbitration.headline}</strong> · {arbitration.guidance}
              </div>
            )}

            {pairedFromPrev && <div style={{ marginTop: 8, padding: "6px 10px", border: `1px solid ${C.text}`, fontSize: 10, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text }}>Superset B · return to {lifting[idx - 1]?.name} after rest</div>}
            {canPair && !pairedFromPrev && (
              <button type="button" onClick={togglePair} style={{ marginTop: 8, background: paired ? C.text : "none", border: `1px solid ${paired ? C.text : C.lineBright}`, color: paired ? C.bg : C.textDim, fontFamily: mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", padding: "6px 10px", cursor: "pointer" }}>
                {paired ? `⇅ Paired with ${lifting[idx + 1]?.name}` : `⇅ Superset with ${lifting[idx + 1]?.name}`}
              </button>
            )}

            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setNoteOpen((value) => !value)} aria-expanded={noteOpen} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: mono, fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase", color: note ? C.text : C.textDim }}>
                {noteOpen ? "▲" : "▾"} Setup note{note && !noteOpen ? ` · ${note.slice(0, 30)}${note.length > 30 ? "…" : ""}` : ""}
              </button>
              {noteOpen && <input type="text" value={note} placeholder="seat 4 · pin 7 · elbows tucked" maxLength={200} onChange={(event) => setNote(event.target.value)} onBlur={() => writeExerciseNote(exercise.name, note)} aria-label={`Setup note for ${exercise.name}`} style={{ ...S.cell, width: "100%", marginTop: 6, fontSize: 13.5, padding: "10px" }} />}
            </div>

            {exData.skipped ? (
              <button type="button" onClick={() => onUpdate(`workout.exercises.${exercise.name}`, { ...exData, sets, skipped: undefined })} style={{ width: "100%", marginTop: 10, padding: "11px", border: `1px solid ${C.lineBright}`, background: "none", color: C.text, fontFamily: mono, cursor: "pointer" }}>
                Skipped · {exData.skipped} · undo
              </button>
            ) : (
              <div data-testid="skip-row" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                {!skipAsk ? (
                  <button type="button" onClick={() => setSkipAsk(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: mono, fontSize: 9.5, letterSpacing: "0.08em", color: C.textFaint }}>Skip exercise…</button>
                ) : <>
                  <span style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint }}>Reason</span>
                  {["equipment", "fatigue", "time"].map((reason) => (
                    <button key={reason} type="button" onClick={() => {
                      onUpdate(`workout.exercises.${exercise.name}`, { ...exData, sets, skipped: reason });
                      setSkipAsk(false);
                      const next = nextIncompleteExerciseIndex(lifting, { ...workoutData, exercises: { ...workoutData.exercises, [exercise.name]: { ...exData, sets, skipped: reason } } }, idx);
                      if (next >= 0) setTimeout(() => goToExercise(next), 180);
                    }} style={{ background: "none", border: `1px solid ${C.line}`, cursor: "pointer", padding: "4px 9px", fontFamily: mono, fontSize: 9.5, color: C.textDim }}>{reason}</button>
                  ))}
                  <button type="button" onClick={() => setSkipAsk(false)} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}>×</button>
                </>}
              </div>
            )}

            {!isBroadsheet && plates && <div style={{ fontSize: 10.5, color: C.textFaint, marginTop: 8, fontFamily: mono }}>{workingWeight} lb → {plates.label}</div>}

            {!isBroadsheet && ramp && (
              <div style={{ marginTop: 9 }}>
                <button type="button" onClick={() => setRampOpen((value) => !value)} aria-expanded={rampOpen} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: mono, fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase", color: C.textDim }}>{rampOpen ? "▲" : "▾"} Warm-up ramp</button>
                {rampOpen && <div style={{ marginTop: 5 }}>
                  {ramp.steps.map((step, warmupIndex) => {
                    const done = Boolean(exData.warmupSets?.[warmupIndex]?.done);
                    return <button key={`${step.weight}-${warmupIndex}`} type="button" onClick={() => toggleWarmup(warmupIndex)} style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", border: "none", borderBottom: `1px solid ${C.line}`, background: "none", color: C.text, fontFamily: mono, cursor: "pointer" }}><span>{done ? "✓" : "○"} {step.weight} × {step.reps}</span><span style={{ color: C.textFaint }}>{step.label}</span></button>;
                  })}
                </div>}
              </div>
            )}

            {!isBroadsheet && subs && (
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => setSubsOpen((value) => !value)} aria-expanded={subsOpen} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: mono, fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase", color: C.textDim }}>{subsOpen ? "▲" : "▾"} Substitute exercise</button>
                {subsOpen && <div style={{ marginTop: 5 }}>
                  <div style={{ display: "flex", gap: 5, marginBottom: 5 }}>
                    {Object.entries(REASON_LABELS).map(([reason, label]) => <button key={reason} type="button" onClick={() => setSubstitutionReason(reason)} style={{ border: `1px solid ${substitutionReason === reason ? C.text : C.line}`, background: substitutionReason === reason ? C.text : "none", color: substitutionReason === reason ? C.bg : C.textDim, padding: "5px 7px", fontFamily: mono, fontSize: 8.5, cursor: "pointer" }}>{label}</button>)}
                  </div>
                  {subs.subs.map((substitution) => <button key={substitution.name} type="button" onClick={() => chooseSubstitution(substitution)} style={{ width: "100%", textAlign: "left", padding: "8px 0", border: "none", borderBottom: `1px solid ${C.line}`, background: "none", color: C.text, cursor: "pointer" }}><span style={{ display: "block", fontSize: 12.5 }}>{substitution.name}</span><span style={{ display: "block", fontSize: 10.5, color: C.textDim, marginTop: 2 }}>{substitution.note}{substitution.tags?.length ? ` · ${substitution.tags.join(" · ")}` : ""}</span></button>)}
                </div>}
              </div>
            )}
          </div>

          {!exData.skipped && (
            <CurrentSetComposer
              exercise={exercise}
              sets={sets}
              setIndex={activeSetIndex}
              onSelectSet={(setIndex) => { setActiveSetIndex(setIndex); setValidationError(""); }}
              onReplaceSet={replaceSet}
              onBankSet={bankSet}
              lastRaw={lastRaw}
              suggestedWeight={prescription?.targetWeight}
              prescription={nextPrescription ? null : prescription}
              onAcceptPrescription={(_setIndex, nextSet) => onUpdate(`workout.exercises.${exercise.name}.progressionDecision`, buildProgressionDecision(prescription, nextSet))}
              error={validationError}
            />
          )}
        </div>

        {isBroadsheet && (
          <aside data-section="session-rail" style={{ minHeight: 0, overflowY: "auto", borderLeft: `1px solid ${C.line}`, padding: "12px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim, fontFamily: mono, marginBottom: 8 }}>Intelligence</div>
            <div data-testid="desktop-arbitration" style={{ padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim }}>{arbitration.headline}</div>
              <div style={{ marginTop: 3, fontSize: 11, color: C.text, lineHeight: 1.45 }}>{arbitration.guidance}</div>
            </div>
            {deload.status === "watch" && <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.line}` }}><div style={{ fontFamily: mono, fontSize: 9.5, color: C.amber, textTransform: "uppercase", letterSpacing: "0.1em" }}>{deload.headline}</div><div style={{ marginTop: 3, fontSize: 11, color: C.textDim, lineHeight: 1.45 }}>{deload.guidance}</div></div>}
            {volumeProjection.rows.filter((row) => row.remaining > 0).slice(0, 4).length > 0 && <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim, marginBottom: 3 }}>Volume after this session</div>
              {volumeProjection.rows.filter((row) => row.remaining > 0).slice(0, 4).map((row) => <div key={row.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontFamily: mono, fontSize: 10.5 }}><span style={{ color: C.textDim }}>{row.label}</span><span style={{ color: row.classification?.status === "above_mrv" ? C.red : C.text }}>{row.current} → {row.projected} <span style={{ color: C.textFaint }}>/ {row.landmarks.mavLo}–{row.landmarks.mavHi}</span></span></div>)}
            </div>}
            {plates && <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.line}`, fontSize: 12, fontFamily: mono }}><span style={{ color: C.textDim }}>Plate math · </span><span style={{ color: C.text }}>{workingWeight} lb → {plates.label}</span></div>}
            {ramp && <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, fontFamily: mono, marginBottom: 4 }}>Warm-up ramp</div>
              {ramp.steps.map((step, warmupIndex) => {
                const done = Boolean(exData.warmupSets?.[warmupIndex]?.done);
                return <button key={`${step.weight}-${warmupIndex}`} type="button" onClick={() => toggleWarmup(warmupIndex)} style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", border: "none", borderBottom: `1px solid ${C.line}`, background: "none", color: C.text, fontSize: 11.5, fontFamily: mono, cursor: "pointer" }}><span>{done ? "✓" : "○"} {step.weight} × {step.reps}</span><span style={{ color: C.textFaint }}>{step.label}</span></button>;
              })}
            </div>}
            {subs && <div style={{ padding: "8px 0" }}>
              <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, fontFamily: mono, marginBottom: 4 }}>Substitutions</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>{Object.entries(REASON_LABELS).map(([reason, label]) => <button key={reason} type="button" onClick={() => setSubstitutionReason(reason)} style={{ border: `1px solid ${substitutionReason === reason ? C.text : C.line}`, background: substitutionReason === reason ? C.text : "none", color: substitutionReason === reason ? C.bg : C.textDim, padding: "4px 6px", fontFamily: mono, fontSize: 8, cursor: "pointer" }}>{label}</button>)}</div>
              {subs.subs.map((substitution) => <button key={substitution.name} type="button" onClick={() => chooseSubstitution(substitution)} style={{ width: "100%", textAlign: "left", padding: "6px 0", border: "none", borderBottom: `1px solid ${C.line}`, background: "none", color: C.text, fontFamily: mono, fontSize: 11.5, cursor: "pointer" }}>{substitution.name}<span style={{ display: "block", color: C.textFaint, fontSize: 9.5, marginTop: 2 }}>{substitution.note}</span></button>)}
            </div>}
          </aside>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "10px 16px calc(10px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${C.line}`, background: C.panel }}>
        <button type="button" disabled={idx === 0} onClick={() => goToExercise(idx - 1)} style={{ ...S.smallBtn, padding: "12px", opacity: idx === 0 ? 0.35 : 1 }}>← Previous</button>
        {sessionDone ? (
          <button type="button" onClick={finishSession} style={{ padding: "12px", background: C.text, color: C.bg, border: `1px solid ${C.text}`, fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontWeight: 600 }}>Finish {sessionLabel}</button>
        ) : nextExerciseIndex >= 0 ? (
          <button type="button" onClick={() => goToExercise(nextExerciseIndex)} style={{ ...S.smallBtn, padding: "12px", borderColor: C.text, color: C.text }}>Next incomplete →</button>
        ) : idx < lifting.length - 1 ? (
          <button type="button" onClick={() => goToExercise(idx + 1)} style={{ ...S.smallBtn, padding: "12px", borderColor: C.text, color: C.text }}>Next →</button>
        ) : (
          <button type="button" onClick={finishSession} style={{ ...S.smallBtn, padding: "12px", borderColor: C.text, color: C.text }}>Exit session</button>
        )}
      </div>
    </div>
  );
}

export default SessionMode;
