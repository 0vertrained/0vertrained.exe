import { useMemo, useState } from "react";
import { formatDuration } from "../runPaces";
import { buildCourse } from "./course";
import { rehearsalAttempt } from "./attempts";
import CourseMap from "./CourseMap";
import { CourseEditor } from "./CourseEditor";
import RehearsalAttempt, { AttemptBreakdown } from "./RehearsalAttempt";
import "./raceRehearsal.css";

function History({ entries, recent }) {
  const attempts = new Map();
  for (const [date, day] of Object.entries(entries || {})) {
    for (const raw of Object.values(day?.workout?.raceRehearsals || {})) {
      const attempt = rehearsalAttempt(raw);
      if (attempt) attempts.set(attempt.id, { date, attempt });
    }
  }
  if (recent && !attempts.has(recent.attempt.id)) attempts.set(recent.attempt.id, recent);
  if (!attempts.size) return null;
  return <section className="rr-stack" aria-label="Rehearsal history"><h2 className="t-h">Rehearsal history</h2>
    {[...attempts.values()].sort((a, b) => new Date(b.attempt.startedAt) - new Date(a.attempt.startedAt)).map(({ date, attempt }) =>
      <details className="rr-record" key={attempt.id}><summary>{attempt.name} · {date}</summary><AttemptBreakdown attempt={attempt} /></details>)}
  </section>;
}

function AthleteRehearsal({ owner, program, entries, todayKey, onSaveProgram, onSaveAttempt }) {
  const [editing, setEditing] = useState(false);
  const [recent, setRecent] = useState(null);
  const raw = program?.__rehearsal;
  const course = useMemo(() => {
    if (!raw) return null;
    try { return buildCourse(raw); } catch { return null; }
  }, [raw]);
  return <div className="race-rehearsal rr-stack">
    <RehearsalAttempt owner={owner} course={editing ? null : course} onSaveAttempt={onSaveAttempt}
      onSaved={(attempt, date) => setRecent({ attempt, date })}>
    {startButton => editing ? <CourseEditor initialCourse={course} {...{ owner, program, todayKey, onSaveProgram }} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
      : course ? <section className="rr-stack" aria-label="Scheduled course">
        <div className="sec"><h2 className="t-h">{course.name}</h2><button className="btn btn-s btn-sm" onClick={() => setEditing(true)}>Edit course</button></div>
        <p className="n-s">{course.date} · {(course.distanceMeters / 1000).toFixed(2)} km · {course.checkpoints.length} checkpoints</p>
        {startButton}
        <CourseMap points={course.points} checkpoints={course.checkpoints} readOnly />
        <ol className="rows" aria-label="Course checkpoints">{course.checkpoints.map(cp =>
          <li className="rr-split" key={cp.id}><div className="sec"><strong>{cp.name}</strong><span className="n-s">{(cp.meters / 1000).toFixed(2)} km</span></div>
            <p className="t-s c2">{cp.kind}{cp.targetSeconds > 0 && " · Target " + formatDuration(cp.targetSeconds)}{cp.instruction && " · " + cp.instruction}</p></li>)}</ol>
      </section> : <section className="rr-stack"><h2 className="t-h">{raw ? "Replace unreadable course" : "Plan a race rehearsal"}</h2>
        {raw && <p>The saved course could not be opened. Save a new course to replace it.</p>}
        <p>Draw your road or trail course, or import its GPX file. Add split targets and station stops to practice on your phone or Watch.</p>
        <button type="button" className="btn btn-p" onClick={() => setEditing(true)}>Build course</button>
      </section>}
    </RehearsalAttempt>
    {!editing && <History entries={entries} recent={recent} />}
  </div>;
}

export function RaceRehearsal(props) { return <AthleteRehearsal key={props.owner || ""} {...props} />; }
export default RaceRehearsal;
