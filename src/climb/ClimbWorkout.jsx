import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nativeHaptic, nativeKeepAwake } from "../native";
import { useConfirm } from "../ui/ConfirmDialog";
import { climbReadout, finishClimb, selectClimb, startClimb, updateClimb } from "./engine";
import { ClimbScene, clockText, distanceText, gapText, unitMeters } from "./ClimbScene";
import { SectionTerrain } from "./SectionClimbing";
import { Equipment, QualifiedIncline } from "./ClimbEquipment";
import { WorkoutBeltCapture } from "./workoutCapture";

export function Metric({ label, children }) {
  return <div className="cl-metric"><span className="lbl">{label}</span><strong>{children}</strong></div>;
}

function SplitReplay({course, run, mark, unit}) {
  const [elapsed, setElapsed] = useState(mark.elapsedSeconds);
  const [profile, setProfile] = useState(true);
  const samples = useMemo(() => (run.trace || []).filter(p => Number.isFinite(p.meters) && Number.isFinite(p.elapsedSeconds)),[run.trace]);
  if (!course?.points || !samples.length || !Number.isFinite(mark.elapsedSeconds)) return null;
  const at = Math.max(0, Math.min(mark.elapsedSeconds, elapsed));
  const index = samples.findIndex(p => p.elapsedSeconds >= at);
  const after = index < 0 ? samples.at(-1) : samples[index], before = index <= 0 ? after : samples[index-1];
  // Sparse console readings establish arrival at a landmark but cannot
  // reconstruct a runner's position in the interval between two readings.
  const reliable = !run.uncertain && after.elapsedSeconds > before.elapsedSeconds;
  const frac = reliable ? (at-before.elapsedSeconds)/(after.elapsedSeconds-before.elapsedSeconds) : at === after.elapsedSeconds ? 1 : 0;
  const meters = before.meters + frac*(after.meters-before.meters);
  const reference = climbReadout(course,{...run,status:"active",endedAt:null,lastAt:run.startedAt+at*1000,distanceMeters:meters}, run.startedAt+at*1000);
  return <div className="cl-stack cl-replay">
    <ClimbScene course={course} unit={unit} profile={profile && course.hasElevation} onProfile={setProfile} athleteMeters={meters}
      ghostMeters={reference.ghostMeters} progressLabel={run.uncertain ? "Last recorded position" : "Recorded runner"} visibleLandmark={mark.id}/>
    <label className="field"><span className="lbl">Replay to {mark.name} · {clockText(at)}</span><input aria-label="Replay elapsed time" type="range" min="0" max={mark.elapsedSeconds || 1}
      step="any" value={at} onChange={e=>setElapsed(Number(e.target.value))}/></label>
  </div>;
}

export function Debrief({ course, run, unit, onRepeat }) {
  const [shown, setShown] = useState(null);
  const marks = (run.marks || []).filter(m => m.meters > .001);
  const mark = marks.find(m => m.id === shown);
  const verifiedChanges = marks.filter(m => m.quality === "measured" && Number.isFinite(m.sectionGainSeconds));
  const largest = verifiedChanges.reduce((best, m) => !best || Math.abs(m.sectionGainSeconds) > Math.abs(best.sectionGainSeconds) ? m : best, null);
  const resultGap = marks.at(-1);
  const elapsed = (run.endedAt - run.startedAt) / 1000;
  const select = m => {
    setShown(shown === m.id ? null : m.id);
  };
  return <div className="cl-stack">
    <div className="cl-metrics">
      <Metric label="Distance">{distanceText(run.distanceMeters, unit)}</Metric><Metric label="Elapsed">{clockText(elapsed)}</Metric>
      <Metric label={run.status === "finished" ? "At the crest" : "Last split"}>{gapText(resultGap?.gapSeconds)}</Metric>
    </div>
    {largest && <p className="cl-insight">Largest split change · {largest.name} · {clockText(Math.abs(largest.sectionGainSeconds))} {largest.sectionGainSeconds >= 0 ? "gained" : "lost"}</p>}
    <p className="t-s c2">{run.reference === "recorded" ? "Outdoor recorded reference" : run.reference === "indoor" ? "Indoor recorded reference" : run.reference === "solo" ? "Solo run" : "Target pacer"}
      {run.distanceMeters > 0 && Number.isFinite(run.verifiedMeters) && " · " + Math.min(100,Math.round(100*run.verifiedMeters/run.distanceMeters)) + "% distance from console or belt"}
      {run.uncertain && " · Estimated or sparse intervals"}</p>
    {run.terrainSections?.length ? <SectionTerrain {...{course,run,unit,onRepeat}}/> : run.deckObservedMeters > 0 ? <p className="t-s c2">Measured deck over {distanceText(run.deckObservedMeters,unit)} · {Math.round(100*(run.deckMatchedMeters||0)/run.deckObservedMeters)}% within one percentage point of course grade{run.deckLimitedMeters > 0 && " · " + distanceText(run.deckLimitedMeters,unit) + " outside your cue range"}</p>
      : <p className="t-s c2">Actual deck incline was unmeasured.</p>}
    {marks.length > 0 ? <ol className="cl-splits" aria-label="Climb splits">{marks.map((m, index) =>
      <li key={m.id}><button type="button" className="cl-split" aria-expanded={shown === m.id} onClick={() => select(m)}>
        <span><strong>{m.name}</strong><small>{distanceText(m.meters, unit)} · {m.quality === "unknown" ? "Time unavailable" : clockText(m.elapsedSeconds)}</small></span>
        <span>{gapText(m.gapSeconds)}</span></button>
        {mark?.id === m.id && <div className="cl-split-info"><p className="t-s">{m.quality === "unknown" ? "The distance readings do not establish an arrival time at this landmark." :
          (m.quality === "estimated" ? "Estimated arrival" : "Recorded arrival") + (Number.isFinite(m.referenceSeconds) ? " · Reference " + clockText(m.referenceSeconds) : "")}</p>
          {Number.isFinite(m.sectionGainSeconds) && <p className="t-s">On this section · {clockText(Math.abs(m.sectionGainSeconds))} {m.sectionGainSeconds >= 0 ? "gained" : "lost"}</p>}
          {Number.isFinite(m.elapsedSeconds) && <SplitReplay key={m.id} {...{course,run,unit,mark:m}}/>}
          {onRepeat && <button type="button" className="btn btn-s btn-sm" onClick={() => onRepeat(index === 0 ? 0 : marks[index - 1].meters, m.meters)}>Repeat this section</button>}
        </div>}</li>)}</ol> : <p className="t-s c2">No landmarks reached on this attempt.</p>}
  </div>;
}

function useRaceClock(live) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    const awake = nativeKeepAwake(true);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); if (awake) nativeKeepAwake(false); };
  }, [live]);
  return now;
}

export function ClimbWorkout({ active, onUpdateActive, onSaveResult, unit, profile, onProfile, treadmill, watchReading, onConnectWatch, onSaved, onSaveCheck }) {
  const { course, run } = active;
  const phase = active.phase || "climb";
  const extra = phase === "warmup" || phase === "cooldown";
  const live = run.status === "active" && !extra;
  const collecting = (live || extra) && !active.recording?.endedAt;
  const now = useRaceClock(collecting);
  const estimateStart = Math.max(run.lastAt, active.manualEstimateStart || 0);
  const estimating = live && !active.paused && active.source === "manual" && Number.isFinite(active.manualPaceSeconds) && active.manualPaceSeconds > 0;
  const visualMeters = estimating ? Math.min(course.distanceMeters, run.distanceMeters + Math.max(0,now-estimateStart)/active.manualPaceSeconds) : run.distanceMeters;
  const reading = climbReadout(course, {...run,distanceMeters:visualMeters}, live ? Math.max(now, run.startedAt) : run.endedAt);
  const [consoleDistance, setConsoleDistance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const { confirm, confirmDialog } = useConfirm();
  const lastSample = useRef(active.lastSample || null);
  const beltCapture = useRef(null);
  const deck = useRef({connection:null, grades:[]});
  const current = useRef(active);
  useEffect(() => { current.current = active; }, [active]);
  useEffect(() => {
    const visibility = () => {
      if (beltCapture.current && current.current.run.status==="active" && (!current.current.phase || current.current.phase==="climb")) {
        beltCapture.current.interrupt(document.hidden ? "background" : "foreground", Date.now());
      }
    };
    document.addEventListener("visibilitychange",visibility);
    return () => document.removeEventListener("visibilitychange",visibility);
  }, []);
  const commit = useCallback(async payload => {
    const last = current.current;
    const recording = payload.recording || { startedAt:payload.run.startedAt, baseMeters:0, extraMeters:0 };
    const next = {...payload, recording:{...recording, distanceMeters: (recording.baseMeters || 0) + (payload.phase === "warmup" ? 0 : payload.run.distanceMeters) + (recording.extraMeters || 0)}};
    const capture = beltCapture.current;
    if (capture?.id === next.run.id && capture.startedAt === next.run.startedAt && capture.data.rows.length) {
      next.run = {...next.run,beltReplay:capture.data};
    }
    current.current = next;
    try {
      if (await onUpdateActive(next) === false) throw new Error("This device could not keep the latest reading. Free storage and try again.");
      setError("");
      if (next.run.marks.length > last.run.marks.length && next.cues !== false) nativeHaptic([150, 90, 150]);
      return true;
    } catch (e) { if (current.current === next) current.current = last; setError(e.message); return false; }
  }, [onUpdateActive, setError]);
  const source = active.source || "manual";
  const watch = watchReading?.recordingId === run.recordingId ? watchReading : null;
  const packet = useMemo(() => source === "belt" ? treadmill : source === "watch" && watch ? {
    fresh: watch.connected, connectionId: watch.recordingId, distanceMeters: watch.meters, sampleAt: watch.at, heartRate: watch.heartRate,
  } : null, [source, treadmill, watch]);
  useEffect(() => {
    if (source === "belt" && live && !active.paused && !document.hidden) {
      const currentRun=current.current.run;
      if (!beltCapture.current || beltCapture.current.startedAt !== currentRun.startedAt) beltCapture.current=new WorkoutBeltCapture(currentRun);
      beltCapture.current.record(packet);
    }
    // Deck and distance notifications may alternate. Keep each actual grade
    // timestamp until the counter interval covering it has been processed.
    if (source === "belt" && collecting && !active.paused && packet?.connectionId) {
      if (deck.current.connection !== packet.connectionId) deck.current = {connection:packet.connectionId, grades:[]};
      const {inclineAt: at, inclinePercent: percent} = packet;
      const grades = deck.current.grades;
      if (Number.isFinite(at) && Number.isFinite(percent) && at <= Date.now() &&
          (!grades.length || at > grades.at(-1).at)) {
        deck.current.grades = [...grades.filter(sample => at - sample.at <= 13000), {at, percent}].slice(-128);
      }
    }
    const hasCounter = Number.isFinite(packet?.distanceMeters);
    const packetTime = (hasCounter ? packet?.distanceAt : packet?.speedAt) ?? packet?.sampleAt;
    if (!collecting || active.paused || !packet?.fresh || !Number.isFinite(packetTime) ||
      packetTime < run.startedAt || packetTime > Date.now() || Date.now() - packetTime > 10_000) return;
    const last = lastSample.current;
    const sameConnection = last && last.source === source && last.connection === packet.connectionId;
    if (sameConnection && last.t >= packetTime) return;
    const continuity = sameConnection && packetTime - last.t <= 10_000;
    // Some treadmills only publish speed. Integrate between consecutive fresh
    // samples; reconnects and app suspension start a new baseline.
    if (!hasCounter && !Number.isFinite(packet.speedMps)) return;
    const modeChanged = last && last.hasCounter !== hasCounter;
    const meters = hasCounter ? packet.distanceMeters : (last?.meters ?? 0) + (continuity && !modeChanged ? Math.max(0, packet.speedMps) * (packetTime - last.t) / 1000 : 0);
    const previous = current.current;
    if (!previous || previous.recording?.endedAt) return;
    const rebase = !sameConnection || modeChanged || meters < last.meters;
    const sample = { t: packetTime, connection: packet.connectionId, source, meters, hasCounter };
    if (extra) {
      lastSample.current = sample;
      const delta = rebase ? 0 : Math.max(0, meters-last.meters);
      void commit({...previous, lastSample:sample, recording:{...previous.recording,extraMeters:(previous.recording?.extraMeters||0)+delta}});
    } else {
      const next = updateClimb(course, previous.run, {source, meters, now:packetTime, estimated:!hasCounter, rebase,
        discontinuity:!continuity, measuredDistanceTime:Number.isFinite(packet.distanceAt), gradeCap:previous.gradeCap ?? 12, grades:source === "belt" ? deck.current.grades : []});
      if (next !== previous.run) {
        lastSample.current = sample;
        void commit({ ...previous, run:next, lastSample:sample }).then(ok => {
          if (!ok && lastSample.current === sample) lastSample.current = last;
        });
      }
    }
  }, [collecting, extra, live, source, course, active.paused, packet, commit, run.startedAt]);
  const nextConfirmedLandmark = course.landmarks.find(m=>m.meters>run.distanceMeters+.001);
  const fresh = packet?.fresh === true && Number.isFinite(packet.sampleAt) && now - packet.sampleAt < 10000;
  const measuredInclineFresh = fresh && Number.isFinite(packet?.inclineAt) && Math.abs(now-packet.inclineAt)<10000;
  const exerciseChange = async (patch) => {
    if (beltCapture.current && live) {
      if (typeof patch.paused === "boolean") beltCapture.current.interrupt(patch.paused ? "pause" : "resume",Date.now());
      else if (patch.source && patch.source !== source) beltCapture.current.interrupt("disconnect",Date.now());
    }
    lastSample.current = null;
    deck.current = {connection:null, grades:[]};
    await commit({ ...current.current, lastSample:null, manualEstimateStart:Date.now(), ...patch });
  };
  const record = async () => {
    const distance = Number(consoleDistance) * unitMeters(unit);
    if (consoleDistance.trim() === "" || !Number.isFinite(distance) || distance <= (extra ? (active.recording?.extraMeters || 0) : run.distanceMeters) || distance > course.distanceMeters + 100000) {
      setError("Enter a cumulative console distance above your last reading."); return;
    }
    const latest = current.current;
    const change = extra ? {...latest, recording:{...latest.recording,extraMeters:distance}} : {...latest, run:updateClimb(course, latest.run,{now:Date.now(),source:"manual",meters:distance,gradeCap:latest.gradeCap ?? 12})};
    if (await commit({...change, lastSample:null, source:"manual"})) {
      lastSample.current = null;
      deck.current = {connection:null, grades:[]};
      setConsoleDistance("");
    }
  };
  const finish = async () => {
    if (await confirm({ title: "Finish this climb here?", message: "Keep the distance and splits you reached and review the partial attempt.", confirmLabel: "Finish here" })) {
      await commit({ ...current.current, run: finishClimb(course, current.current.run, Date.now()) });
    }
  };
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const endTime = phase === "cooldown" ? Date.now() : run.endedAt;
      const value = {...active, recording:{...(active.recording || {startedAt:run.startedAt,distanceMeters:run.distanceMeters}),endedAt:active.recording?.endedAt ?? endTime}};
      // Reviewing a finished climb can take hours. Only an explicit cooldown
      // keeps the physical workout clock running during review or after reload.
      if (!active.recording?.endedAt && !await commit(value)) return;
      if (!await onSaveResult(value)) throw new Error("Workout save failed. Your climb remains here to retry.");
      await onSaved(value);
    } catch (e) { setError(e.message || "Could not save this workout."); } finally { saving.current = false; setBusy(false); }
  };
  const distanceControls = <>
      <label className="field"><span className="lbl">Distance source</span><select className="input" value={source}
        onChange={e => exerciseChange({ source: e.target.value })}><option value="manual">Console readings</option>
        {(treadmill?.status === "connected" || source === "belt") && <option value="belt">Treadmill telemetry</option>}
        {(watch?.connected || source === "watch") && <option value="watch">Watch indoor distance</option>}</select></label>
      {source === "manual" ? <div>
        <label className="field"><span className="lbl">{extra ? (phase === "warmup" ? "Warm-up distance" : "Cooldown distance") : "Distance since climb start"} ({unit})</span>
          <input className="input n" inputMode="decimal" type="number" min="0" step="any" value={consoleDistance} placeholder="0.00"
            onChange={e => setConsoleDistance(e.target.value)} /></label>
        <button type="button" className="btn btn-s cl-reading" disabled={active.paused || !consoleDistance.trim()} onClick={record}>Record console reading</button>
        {live && nextConfirmedLandmark && <button type="button" className="btn btn-g" disabled={active.paused} onClick={async () => {
          const landmark=nextConfirmedLandmark;
          const latest=current.current;
          const updated=updateClimb(course,latest.run,{source:"manual",meters:landmark.meters,gradeCap:latest.gradeCap ?? 12});
          if(await commit({...latest,run:updated,lastSample:null}))setConsoleDistance("");
        }}>Mark {nextConfirmedLandmark.name} at {distanceText(nextConfirmedLandmark.meters,unit)}</button>}
      </div> : <p role="status" className="t-s c2">{active.paused ? "Distance on hold." : !fresh ? "Waiting for fresh distance. You can switch to console readings." : reading.estimated ? "Estimated from measured belt speed." : "Following live distance."}</p>}
      {onConnectWatch && !watch?.connected && <button type="button" className="btn btn-s" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { if (await onConnectWatch(active) === false) throw new Error("Open 0vertrained on the paired Watch and try again."); }
        catch (e) { setError(e.message); } finally { setBusy(false); }
      }}>Record on Watch</button>}
      {onConnectWatch && <p className="t-s c2">{watch?.connected ? "Watch recording connected" + (watch.heartRate > 0 ? " · " + Math.round(watch.heartRate) + " bpm" : "") : "Open 0vertrained on your Watch and accept the indoor recording."}</p>}
      <Equipment reading={treadmill} distanceUnit={unit} onSaveCheck={onSaveCheck} />
  </>;
  const beginClimb = async () => {
    const latest = current.current;
    const timed = startClimb(course,{owner:run.owner,id:run.id,recordingId:run.recordingId,reference:run.reference,indoorGhost:run.indoorGhost,paceSecondsPerKm:run.paceSecondsPerKm});
    setConsoleDistance("");
    await exerciseChange({phase:"climb", run:timed, paused:false, recording:{...latest.recording,baseMeters:latest.recording?.distanceMeters || 0,extraMeters:0}});
  };
  const repeatSection = async (startMeters,endMeters) => {
    try {
      const selected = selectClimb(course,{startMeters,endMeters,name:course.name+" · section"});
      const reference = run.reference === "recorded" && selected.hasRecordedGhost ? "recorded" : run.reference === "solo" ? "solo" : "pacer";
      const timed = startClimb(selected,{owner:run.owner,recordingId:run.recordingId,reference,paceSecondsPerKm:run.paceSecondsPerKm});
      const previousAttempts=[...(active.previousAttempts||[]),{course,run,dateKey:active.dateKey}];
      const baseMeters=active.recording?.distanceMeters ?? run.distanceMeters;
      await exerciseChange({course:selected,run:timed,previousAttempts,phase:"climb",paused:false,
        recording:{startedAt:active.recording?.startedAt ?? run.startedAt,baseMeters,extraMeters:0,distanceMeters:baseMeters}});
    } catch(e) {setError(e.message);}
  };
  return <section className="cl-stack" aria-label={extra ? phase === "warmup" ? "Warm-up in progress" : "Cooldown in progress" : live ? "Climb in progress" : "Review climb"}>
    <header className="cl-head"><p className="lbl">{collecting ? "Indoor run" : "Indoor result"}</p><h2>{course.name}</h2>
      <p className="t-s c2">{extra ? (phase === "warmup" ? "Warm-up" : "Cooldown") : live ? active.paused ? "At a stop · race clock continues" : "Race the Climb" : run.status === "finished" ? "Crest reached" : "Partial attempt"}</p></header>
    {extra ? <>
      <div className="cl-metrics"><Metric label="Workout elapsed">{clockText((now-(active.recording?.startedAt||run.startedAt))/1000)}</Metric>
        <Metric label="Workout distance">{distanceText(active.recording?.distanceMeters||0,unit)}</Metric><Metric label="This phase">{distanceText(active.recording?.extraMeters||0,unit)}</Metric></div>
      {!active.recording?.endedAt && distanceControls}
      {phase === "warmup" ? <div className="cl-actions"><button type="button" className="btn btn-p" onClick={beginClimb}>Start timed climb</button>
        <button type="button" className="btn btn-g" onClick={async()=>{if(await confirm({title:"Discard warm-up?",message:"End this workout without saving the warm-up.",confirmLabel:"Discard warm-up",destructive:true})) await onUpdateActive(null);}}>Discard warm-up</button></div>
        : <><button type="button" className="btn btn-p" disabled={busy} onClick={save}>Finish workout and save</button>
          <Debrief course={course} run={run} unit={unit} onRepeat={active.recording?.endedAt ? null : repeatSection}/></>}
    </> : live ? <>
      <div className="cl-metrics">
        <Metric label="Distance to crest">{distanceText(Math.max(0, course.distanceMeters - visualMeters), unit)}</Metric>
        <Metric label="Elapsed">{clockText(reading.elapsedSeconds)}</Metric><Metric label="Time gap">{gapText(reading.gapSeconds)}</Metric>
      </div>
      <ClimbScene {...{ course, unit, profile: profile && course.hasElevation, onProfile }} athleteMeters={visualMeters} progressLabel={estimating ? "Estimated position" : "You"} ghostMeters={reading.ghostMeters} visibleLandmark={reading.nextLandmark?.id} />
      {estimating && <p className="t-s c2">Estimated from your console pace. Last confirmed distance · {distanceText(run.distanceMeters,unit)}. Confirm console readings to log splits.</p>}
      <div className="cl-next"><div><span className="lbl">Next landmark</span><h3>{reading.nextLandmark?.name || "Crest"}</h3>
        {reading.nextLandmark && <p className="t-s c2">{distanceText(Math.max(0, reading.nextLandmark.meters - visualMeters), unit)} to go</p>}</div>
        <div><span className="lbl">Manual incline cue</span><strong className="n-md">{Number.isFinite(reading.gradePercent) ? Math.max(0, Math.min(active.gradeCap ?? 12, reading.gradePercent)).toFixed(1) + "%" : "—"}</strong>
          <p className="t-s c2">{Number.isFinite(reading.gradePercent) ? "Course " + reading.gradePercent.toFixed(1) + "%" : "Elevation unavailable"}</p></div></div>
      {measuredInclineFresh && Number.isFinite(packet.inclinePercent) && <p className="t-s">Measured deck incline · {packet.inclinePercent.toFixed(1)}%</p>}
      {source === "belt" && measuredInclineFresh && !active.paused && packet?.autoIncline && Number.isFinite(reading.gradePercent) &&
        <QualifiedIncline owner={run.owner} recordingId={run.recordingId} reading={packet} target={reading.gradePercent} cap={active.gradeCap ?? 12} confirm={confirm} />}
      {distanceControls}
      <div className="cl-actions"><button type="button" className="btn btn-s" onClick={() => exerciseChange({ paused: !active.paused })}>{active.paused ? "Resume distance" : "Take a stop"}</button>
        <button type="button" className="btn btn-g" onClick={finish}>Finish early</button></div>
    </> : <>
      <Debrief course={course} run={run} unit={unit} onRepeat={active.recording?.endedAt ? null : repeatSection}/>
      {!active.recording?.endedAt && <button type="button" className="btn btn-s" onClick={() => exerciseChange({phase:"cooldown",paused:false})}>Start cooldown</button>}
      <div className="cl-actions"><button type="button" className="btn btn-p" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save climb"}</button>
        <button type="button" className="btn btn-g" disabled={busy} onClick={async () => {
          if (await confirm({ title: "Discard this attempt?", message: "Remove this unsaved climb from this device.", confirmLabel: "Discard attempt", destructive: true })) {
            try { if (await onUpdateActive(null) === false) throw new Error("Could not remove the attempt."); } catch (e) { setError(e.message); }
          }
        }}>Discard attempt</button></div>
    </>}
    {error && <p role="alert" className="err">{error}</p>}{confirmDialog}
  </section>;
}
