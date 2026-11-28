import { useEffect, useRef, useState } from "react";
import { getTodayKey } from "../constants";
import { buildCourse, validCourseDate } from "./course";
import { rehearsalAttempt } from "./attempts";
import { formatDuration } from "../runPaces";
import { useConfirm } from "../ui/ConfirmDialog";
import { nativeKeepAwake } from "../native";
import CourseMap from "./CourseMap";

const time = seconds => formatDuration(Math.max(0, seconds)) || "0:00";
const distance = meters => (meters / 1000).toFixed(2) + " km";
const station = kind => ["water", "fuel", "aid"].includes(kind);
const elapsed = (at, startedAt) => Math.max(0, Math.floor((new Date(at) - new Date(startedAt)) / 1000));
const difference = (actual, target) => {
  const delta = Math.round(actual - target);
  return delta === 0 ? "On target" : time(Math.abs(delta)) + (delta > 0 ? " behind" : " ahead");
};

function checkpointSplits(marks) {
  let previous = null;
  return marks.map(mark => {
    if (mark.status === "skipped") return { mark };
    const split = Math.max(0, mark.elapsedSeconds - (previous?.elapsedSeconds || 0));
    const previousTarget = previous ? previous.targetSeconds : 0;
    const segmentTarget = mark.targetSeconds > 0 && previousTarget != null ? mark.targetSeconds - previousTarget : null;
    previous = mark;
    return { mark, split, segmentTarget };
  });
}

export function AttemptBreakdown({ attempt }) {
  const duration = elapsed(attempt.endedAt, attempt.startedAt);
  const stopped = attempt.marks.reduce((sum, mark) => sum + (mark.departedSeconds == null ? 0 : Math.max(0, mark.departedSeconds - mark.elapsedSeconds)), 0);
  return <div className="rr-stack">
    <p className="n-s">{distance(attempt.distanceMeters || 0)} · {time(duration)} elapsed · {time(stopped)} stopped</p>
    <ol className="rows" aria-label="Checkpoint splits">{checkpointSplits(attempt.marks).map(({ mark, split, segmentTarget }) => {
      if (mark.status === "skipped") return <li key={mark.checkpointId} className="row"><span className="grow">{mark.name}</span><span className="t-s c2">Skipped</span></li>;
      return <li key={mark.checkpointId} className="rr-split">
        <div className="sec"><strong>{mark.name}</strong><span className="n">{time(mark.elapsedSeconds)}</span></div>
        <p className="t-s c2">{distance(mark.meters)} · Split {time(split)}{segmentTarget > 0 && ` / target ${time(segmentTarget)}`}</p>
        {mark.targetSeconds > 0 && <p className="t-s">{difference(mark.elapsedSeconds, mark.targetSeconds)} at checkpoint · target {time(mark.targetSeconds)}</p>}
        {mark.departedSeconds != null && <p className="t-s c2">Station stop {time(mark.departedSeconds - mark.elapsedSeconds)}</p>}
      </li>;
    })}</ol>
  </div>;
}

function ActiveTimer({ session, onUpdate, onSaveAttempt, onSaved }) {
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const { confirm, confirmDialog } = useConfirm();
  const { course, attempt } = session;
  const next = course.checkpoints[attempt.marks.length];
  const last = attempt.marks.at(-1);
  const atStation = !attempt.endedAt && last?.status === "taken" && station(last.kind) && last.departedSeconds == null;
  useEffect(() => {
    if (attempt.endedAt) return;
    const awake = nativeKeepAwake(true);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); if (awake) nativeKeepAwake(false); };
  }, [attempt.endedAt]);
  const record = (marks, at, done) => {
    const taken = marks.filter(mark => mark.status === "taken");
    onUpdate({ ...session, attempt: { ...attempt, marks, distanceMeters: taken.at(-1)?.meters || 0, endedAt: done ? at : null } });
    setNow(new Date(at).getTime());
  };
  const markNext = status => {
    if (!next || atStation || attempt.endedAt) return;
    const at = new Date().toISOString();
    const mark = { checkpointId: next.id, name: next.name, kind: next.kind, meters: next.meters, targetSeconds: next.targetSeconds,
      elapsedSeconds: elapsed(at, attempt.startedAt), status };
    const marks = [...attempt.marks, mark];
    record(marks, at, marks.length === course.checkpoints.length && (status === "skipped" || !station(next.kind)));
  };
  const depart = () => {
    if (!atStation) return;
    const at = new Date().toISOString();
    record([...attempt.marks.slice(0, -1), { ...last, departedSeconds: elapsed(at, attempt.startedAt) }], at, !next);
  };
  const finishEarly = async () => {
    if (!await confirm({ title: "End rehearsal here?", message: "Review the checkpoints you reached and choose whether to save.", confirmLabel: "End rehearsal" })) return;
    const at = new Date().toISOString();
    record(atStation ? [...attempt.marks.slice(0, -1), { ...last, departedSeconds: elapsed(at, attempt.startedAt) }] : attempt.marks, at, true);
  };
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      if (!await onSaveAttempt(session.dateKey, attempt)) throw new Error("Save did not finish. Your rehearsal is kept on this device. Retry when ready.");
      onSaved(attempt, session.dateKey);
    } catch (e) { setError(e.message || "Could not save. Your rehearsal is ready to retry."); }
    finally { saving.current = false; setBusy(false); }
  };
  if (attempt.endedAt) return <section className="rr-stack" aria-label="Review rehearsal">
    <h2 className="t-h">Review rehearsal</h2><p>{course.name}</p>
    <AttemptBreakdown attempt={attempt} />
    <button className="btn btn-p" type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save rehearsal"}</button>
    <button className="btn btn-g" type="button" disabled={busy} onClick={async () => {
      if (await confirm({ title: "Discard rehearsal?", message: "Remove this unsaved attempt from this device?", confirmLabel: "Discard rehearsal", destructive: true })) onUpdate(null);
    }}>Discard attempt</button>
    {error && <p role="alert" className="err">{error}</p>}{confirmDialog}
  </section>;
  return <section className="rr-stack" aria-label="Rehearsal in progress">
    <div className="sec"><h2 className="t-h">{course.name}</h2><span className="n-md">{time(elapsed(now, attempt.startedAt))}</span></div>
    {atStation ? <>
      <h3 className="t-h">At {last.name}</h3><p className="t-s c2">Station time · {time(elapsed(now, attempt.startedAt) - last.elapsedSeconds)}</p>
      {course.checkpoints[attempt.marks.length - 1]?.instruction && <p>{course.checkpoints[attempt.marks.length - 1].instruction}</p>}
      <button className="btn btn-p" type="button" onClick={depart}>Depart station</button>
    </> : next && <>
      <p className="t-s c2">Checkpoint {attempt.marks.length + 1} of {course.checkpoints.length} · {distance(next.meters)}</p>
      <h3 className="t-h">{next.name}</h3>
      {next.targetSeconds > 0 && <p className="n-s">Target elapsed {time(next.targetSeconds)}</p>}
      {next.instruction && <p>{next.instruction}</p>}
      <p className="t-s c2">Tap when you reach this checkpoint.</p>
      <button className="btn btn-p" type="button" onClick={() => markNext("taken")}>{next.kind === "finish" ? "Mark finish" : "Mark arrival"}</button>
      {next.kind !== "finish" && <button className="btn btn-s" type="button" onClick={() => markNext("skipped")}>Skip checkpoint</button>}
    </>}
    <CourseMap points={course.points} checkpoints={course.checkpoints} readOnly />
    <button className="btn btn-g" type="button" onClick={finishEarly}>Finish early</button>
    {confirmDialog}
  </section>;
}

export default function RehearsalAttempt({ owner, course, onSaveAttempt, onSaved, children }) {
  const key = owner ? "0vt.rehearsal.current.v1." + owner : null;
  const [session, setSession] = useState(() => {
    try {
      const saved = key && JSON.parse(localStorage.getItem(key));
      if (!saved?.attempt || !validCourseDate(saved.dateKey)) return null;
      const snapshot = buildCourse(saved.course);
      const checked = rehearsalAttempt({ ...saved.attempt, endedAt: saved.attempt.endedAt || new Date().toISOString() });
      if (!checked || checked.courseId !== snapshot.id || checked.marks.some((mark, i) => mark.checkpointId !== snapshot.checkpoints[i]?.id)) return null;
      return { course: snapshot, dateKey: saved.dateKey, attempt: { ...checked, endedAt: saved.attempt.endedAt ?? null } };
    } catch { return null; }
  });
  const [error, setError] = useState("");
  const persist = value => {
    try {
      if (!key) throw new Error();
      if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key);
      setSession(value); setError("");
      return true;
    } catch { setError("Device storage is unavailable. Free some space and try again."); return false; }
  };
  const start = () => {
    if (!course || session) return;
    persist({ course, dateKey: getTodayKey(), attempt: { id: crypto.randomUUID(), courseId: course.id, name: course.name,
      startedAt: new Date().toISOString(), endedAt: null, distanceMeters: 0, marks: [] } });
  };
  return <>
    {session ? <ActiveTimer key={session.attempt.id} session={session} onUpdate={persist} onSaveAttempt={onSaveAttempt}
      onSaved={(attempt, date) => { persist(null); onSaved(attempt, date); }} />
      : children(course && key && onSaveAttempt ? <button type="button" className="btn btn-p" onClick={start}>Start phone rehearsal</button> : null)}
    {error && <p className="err" role="alert">{error}</p>}
  </>;
}
