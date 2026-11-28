import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../ui/ConfirmDialog";
import { nativePlugin } from "../native";
import { validCourseDate } from "../rehearsal/course";
import { SAMPLE_COURSE, buildClimbCourse, climbReadout } from "./engine";
import { changeClimbLibrary, packActiveClimb, readClimbLibrary } from "./library";
import { climbHistory, climbSlots, courseSummary } from "./ledger";
import RaceTheClimb from "./RaceTheClimb";

const SOURCES = [
  { name: "Big Tesuque Trail Run · Santa Fe, NM", url: "https://runsignup.com/Race/NM/SantaFe/TheBigT" },
  { name: "Philmont Tooth Ridge Sprint · Cimarron, NM", url: "https://runsignup.com/Race/PhilmontTrailRace/Page/ToothRidgeSprint" },
];

function useClimbWatch(owner, active) {
  const [reading, setReading] = useState(null);
  const plugin = nativePlugin("OTWatch"), live = useRef(active);
  useEffect(() => { live.current = active; }, [active]);
  const id = active?.run.recordingId;
  useEffect(() => {
    if (!owner || !id || !plugin?.mirrorStatus) return;
    let cancelled = false, fetching = false;
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const response = await plugin.mirrorStatus({ owner });
        const state = response?.state, meters = state?.cardio?.distanceMeters;
        if (cancelled) return;
        const matches = response.connected && state?.cursor?.owner === owner && state?.cursor?.workoutID?.toLowerCase() === id.toLowerCase();
        if (matches && Number.isFinite(meters)) setReading({ meters, at: response.receivedAt, recordingId: id, heartRate: state.heartRate, connected: true });
        else setReading(null);
        const current = live.current;
        if (matches && current?.run.recordingId === id && plugin.climbCue) {
          const read = climbReadout(current.course, current.run, Date.now());
          await plugin.climbCue({ owner, recordingId: id, name: current.course.name,
            distance: current.run.distanceMeters, remaining: Math.max(0, current.course.distanceMeters - current.run.distanceMeters),
            grade: read.gradePercent, gap: read.gapSeconds, landmark: read.nextLandmark?.name || "" });
        }
      } catch { if (!cancelled) setReading(null); }
      finally { fetching = false; }
    }
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id, owner, plugin]);
  return { reading: reading?.recordingId === id ? reading : null,
    connect: plugin?.climbInvite ? ({ course, run, dateKey }) => plugin.climbInvite({ owner, recordingId: run.recordingId, name: course.name, date: dateKey }) : null };
}

export default function ClimbHub({ owner, entries, program, todayKey, onSaveProgram, onSaveAttempt, fromToday, initialHealthRun }) {
  const [lib, setLib] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const { confirm, confirmDialog } = useConfirm();
  const known = useRef(new Map()), queue = useRef(Promise.resolve()), token = useRef(null);
  useEffect(() => {
    if (!owner) return;
    let current = true;
    readClimbLibrary(owner).then(data => {
      if (!current) return;
      token.current = data.active?.journalToken ?? data.active?.run?.id ?? null;
      known.current = new Map(data.courses.map(c => [c.revision, c]));
      setLib(data); setError("");
    }).catch(() => { if (current) setError("The on-device climb library could not be opened."); });
    return () => { current = false; };
  }, [owner, retry]);
  const watch = useClimbWatch(owner, lib?.active);
  const schedule = program?.__climbs?.[todayKey];
  const scheduled = schedule && (lib?.courses.find(c => c.revision === schedule.revision) || (SAMPLE_COURSE.revision === schedule.revision ? SAMPLE_COURSE : null));
  const rehearsal = useMemo(() => {
    const raw = program?.__rehearsal;
    if (!raw?.points?.length) return null;
    try { return buildClimbCourse({ name: raw.name, points: raw.points, landmarks: raw.checkpoints, source: "Saved rehearsal" }); }
    catch { return null; }
  }, [program?.__rehearsal]);
  if (!owner) return <p className="t-s c2">Load your athlete profile to open Race the Climb.</p>;
  if (!lib) return <div className="card"><p role="status">{error || "Opening your climbs…"}</p>
    {error && <button className="btn btn-s" onClick={() => setRetry(n => n + 1)}>Retry</button>}</div>;
  const serialize = work => {
    const next = queue.current.then(work);
    queue.current = next.catch(() => {});
    return next;
  };
  const storeCourse = async course => {
    if (!known.current.has(course.revision) || known.current.get(course.revision) !== course) {
      await changeClimbLibrary(owner, [["course/" + course.revision, course]]);
      known.current.set(course.revision, course);
      setLib(before => ({ ...before, courses: [...known.current.values()] }));
    }
    return true;
  };
  const resultMap = new Map(climbHistory(entries).map(row => [row.run.id, row]));
  lib.results.forEach(row => resultMap.set(row.run.id, row));
  const courses = [...lib.courses];
  if (rehearsal && !courses.some(c => c.revision === rehearsal.revision)) courses.push(rehearsal);
  const upcoming = Object.entries(program?.__climbs || {}).filter(([date, spec]) => validCourseDate(date) && date >= todayKey && typeof spec?.name === "string")
    .sort(([a], [b]) => a.localeCompare(b));
  const initialSetup = fromToday && scheduled ? { ...schedule, dateKey: todayKey } : null;
  return <>
    {fromToday && schedule && !scheduled && <p role="status" className="banner">Today's course, {schedule.name}, is saved on another device. Import that course file here to use it.</p>}
    <RaceTheClimb owner={owner} initialHealthRun={initialHealthRun} todayKey={todayKey} courses={courses} active={lib.active} results={[...resultMap.values()]} courseSources={SOURCES}
      initialCourse={initialSetup ? scheduled : null} initialSetup={initialSetup} watchReading={watch.reading} onConnectWatch={watch.connect}
      getScheduleSlots={date => climbSlots(program, entries, date)}
      onSaveCourse={course => serialize(() => storeCourse(course))}
      onDeleteCourse={course => serialize(async () => {
        const revision = typeof course === "string" ? course : course?.revision;
        if (!revision || revision === lib.active?.course?.revision) throw new Error("Finish the active climb before removing its course.");
        await changeClimbLibrary(owner, [["course/" + revision, null]]);
        known.current.delete(revision);
        setLib(before => ({ ...before, courses: [...known.current.values()] }));
        return true;
      })}
      onUpdateActive={value => serialize(async () => {
        if (value) {
          if (value.run.owner !== owner || !validCourseDate(value.dateKey)) throw new Error("Athlete or date changed. Reopen the saved climb.");
          if (!known.current.has(value.course.revision)) await storeCourse(value.course);
          const stamp = crypto.randomUUID();
          await changeClimbLibrary(owner, [["active", packActiveClimb(value, stamp)]], token.current);
          token.current = stamp;
        } else {
          await changeClimbLibrary(owner, [["active", null]], token.current);
          token.current = null;
          const closing = lib.active?.run?.recordingId;
          const plugin = nativePlugin("OTWatch");
          if (closing && plugin?.climbClose) Promise.resolve(plugin.climbClose({ owner, recordingId: closing })).catch(() => {});
        }
        setLib(before => ({ ...before, active: value }));
        return true;
      })}
      onSaveResult={value => serialize(async () => {
        if (value.run.owner !== owner) return false;
        // Claim the current journal before staging a terminal write. A stale
        // tab cannot finish or delete a newer recording.
        const stamp = crypto.randomUUID();
        await changeClimbLibrary(owner, [["active", packActiveClimb(value, stamp)]], token.current);
        token.current = stamp;
        if (!await onSaveAttempt(value)) return false;
        const rows = [...(value.previousAttempts || []), value].map(row => ({
          course: courseSummary(row.course), run: row.run, dateKey: row.dateKey,
        }));
        const ids = new Set(rows.map(row => row.run.id));
        await changeClimbLibrary(owner, [...rows.map(row => ["result/" + row.run.id, row]), ["active", null]], token.current);
        token.current = null;
        const watchPlugin = nativePlugin("OTWatch");
        if (watchPlugin?.climbClose) Promise.resolve(watchPlugin.climbClose({ owner, recordingId: value.run.recordingId })).catch(() => {});
        setLib(before => ({ ...before, active: null, results: [...before.results.filter(r => !ids.has(r.run.id)), ...rows] }));
        return true;
      })}
      onScheduleCourse={(course, date, options = {}) => serialize(async () => {
        if (!validCourseDate(date)) return false;
        const { sessionId, paceSecondsPerKm, reference, gradeCap, indoorGhostId } = options;
        if (sessionId && !climbSlots(program, entries, date).some(s => s.id === sessionId)) throw new Error("That run has already been logged or moved.");
        const existing = program?.__climbs?.[date];
        if (existing && existing.revision !== course.revision && !await confirm({ title: "Replace scheduled climb?",
          message: existing.name + " is scheduled for " + date + ".", confirmLabel: "Replace climb" })) return false;
        await storeCourse(course);
        return onSaveProgram({ ...program, __climbs: { ...program?.__climbs, [date]: { revision: course.revision, name: course.name, sessionId: sessionId || null, paceSecondsPerKm, reference, gradeCap, indoorGhostId: indoorGhostId || null } } }, { savedMessage: "Climb scheduled" });
      })} />
    {!lib.active && upcoming.length > 0 && <details className="cl-details"><summary>Scheduled climbs ({upcoming.length})</summary>
      <ul className="rows">{upcoming.map(([date, spec]) => <li key={date} className="row"><span className="grow">{date} · {spec.name}</span>
        <button type="button" className="btn btn-g" aria-label={"Remove climb from " + date} onClick={async () => {
          if (!await confirm({ title: "Remove scheduled climb?", message: spec.name + " on " + date, confirmLabel: "Remove from schedule" })) return;
          const remaining = { ...program.__climbs };
          delete remaining[date];
          await onSaveProgram({ ...program, __climbs: remaining }, { savedMessage: "Climb removed from schedule" });
        }}>Remove</button></li>)}</ul>
    </details>}
    {confirmDialog}
  </>;
}
