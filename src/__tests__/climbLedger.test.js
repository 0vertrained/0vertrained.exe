// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { climbSlots, recordClimb } from "../climb/ledger";
import { readClimbLibrary, changeClimbLibrary } from "../climb/library";
import { SAMPLE_COURSE as course, startClimb, finishClimb, updateClimb } from "../climb/engine";
import { planHealthFills, fillWrites } from "../watch/healthRuns";
import { preserveRehearsal } from "../rehearsal/course";

const owner = "runner", date = "2026-11-27", stamp = Date.parse(date + "T12:00:00Z");
const program = { Friday: { sessions: [
  { id: "am", label: "AM", lifting: [{ name: "Squat", reps: 5, sets: 3 }] },
  { id: "pm", label: "PM", cardio: { type: "Easy run", modality: "run" } },
] }, __climbs: { [date]: { revision: course.revision, sessionId: "pm" } } };
const am = { completed: true, exercises: { Squat: { sets: [{ weight: 185, done: true }] } }, sessionState: { am: { status: "complete" } } };
function finished() {
  const start = startClimb(course, { owner, reference: "pacer", now: stamp });
  const moved = updateClimb(course, start, { source: "manual", meters: 300, now: stamp + 100000 });
  const run = finishClimb(course, moved, stamp + 101000);
  return { course, run, dateKey: date, sessionId: "pm" };
}
const healthRun = row => ({ id: "health-123", date, activity: "run", meters: 310, seconds: 103, start: new Date(stamp).toISOString(),
  recordingId: row.run.recordingId, sessionId: "climb:" + row.run.recordingId, climbDate: date });
afterEach(() => localStorage.clear());

describe("climb recording integration", () => {
  it("credits the assigned run exactly once and keeps the finished morning lift", () => {
    const row = finished(), result = recordClimb(am, row, owner, program);
    expect(climbSlots(program, { [date]: { workout: am } }, date).map(s => s.id)).toEqual(["pm"]);
    expect(result.exercises).toBe(am.exercises);
    expect(result.cardioSessions.pm.climbRecordingId).toBe(row.run.recordingId);
    expect(result.cardioSessions.pm.unplanned).toBe(false);
    expect(recordClimb(result, row, owner, program)).toBe(result);
    const saved = result.climbAttempts[row.run.id];
    expect(saved.course.points).toBeUndefined();
    expect(saved.run.trace).toBeUndefined();
    expect(recordClimb(am, row, "someone-else", program)).toBeNull();
    expect(preserveRehearsal(program, { Friday: {} }).__climbs).toEqual(program.__climbs);
  });
  it("preserves another athlete-entered run and matches a delayed Watch workout by recording ID", () => {
    const row = finished(), original = { ...am, cardioSessions: { pm: { miles: "2" } } };
    const saved = recordClimb(original, row, owner, program);
    const extra = "climb-" + row.run.recordingId;
    expect(saved.cardioSessions.pm.miles).toBe("2");
    expect(saved.cardioSessions[extra].unplanned).toBe(true);
    const fills = planHealthFills({ runs: [healthRun(row)], data: { [date]: { workout: saved } }, program }).fills;
    expect(fills[0].path).toBe("workout.cardioSessions." + extra);
    expect(fillWrites(fills[0]).some(w => w.path.endsWith(".climbRecordingId"))).toBe(true);
  });
  it("reconciles Watch-first and cross-midnight imports without duplicating distance", () => {
    const row = finished();
    const fills = planHealthFills({ runs: [{ ...healthRun(row), date: "2026-11-28" }], data: { [date]: { workout: am } }, program }).fills;
    const block = fills[0], extra = block.path.split(".").pop();
    expect(block.dateKey).toBe(date);
    const saved = recordClimb({ ...am, cardioSessions: { [extra]: block } }, row, owner, program);
    expect(Object.keys(saved.cardioSessions)).toEqual(["pm"]);
    expect(saved.cardioSessions.pm.activityRefs[0].id).toBe("health-123");
    expect(saved.cardioSessions.pm.time).toBe("1:43");
  });
  it("restores a local pinned course and active attempt only for its owner", async () => {
    const { run, dateKey } = finished();
    await changeClimbLibrary(owner, [["course/" + course.revision, course], ["active", { run, dateKey, revision: course.revision }]]);
    expect((await readClimbLibrary(owner)).active.course.revision).toBe(course.revision);
    expect((await readClimbLibrary("another")).courses).toHaveLength(0);
    await changeClimbLibrary(owner, [["active", null]]);
    expect((await readClimbLibrary(owner)).active).toBeNull();
  });
});

it("keeps both timed attempts but credits their one physical workout including warm-up and cooldown",()=>{
  const first=finished();
  const second={...first, run:{...first.run,id:"second-split",startedAt:stamp+150000,endedAt:stamp+240000,distanceMeters:240}};
  const envelope={...second,previousAttempts:[first],recording:{startedAt:stamp-60000,endedAt:stamp+300000,distanceMeters:1040}};
  const saved=recordClimb(am,envelope,owner,program);
  expect(Object.keys(saved.climbAttempts).sort()).toEqual([first.run.id,"second-split"].sort());
  expect(saved.climbAttempts["second-split"].run.distanceMeters).toBe(240);
  expect(Object.keys(saved.cardioSessions)).toEqual(["pm"]);
  expect(saved.cardioSessions.pm).toMatchObject({time:"6:00",miles:"0.646",climbRecordingId:first.run.recordingId,unplanned:false});
  expect(recordClimb(saved,envelope,owner,program)).toBe(saved);
  const health={...healthRun(first),meters:1200,seconds:365};
  const late=planHealthFills({runs:[health],data:{[date]:{workout:saved}},program}).fills;
  expect(late).toHaveLength(1);expect(late[0].path).toBe("workout.cardioSessions.pm");
  const early=planHealthFills({runs:[health],data:{[date]:{workout:am}},program}).fills[0];
  const joined=recordClimb({...am,cardioSessions:{[early.path.split(".").pop()]:early}}, envelope,owner,program);
  expect(Object.keys(joined.cardioSessions)).toEqual(["pm"]);
  expect(joined.cardioSessions.pm).toMatchObject({time:early.time,miles:early.miles,activityRefs:early.activityRefs});
});

it("leaves an in-progress or edited PM run in place when a previously scheduled climb finishes",()=>{
  for (const protectedWorkout of [
    {...am,sessionState:{...am.sessionState,pm:{status:"active"}}},
    {...am,cardioSessions:{pm:{startedAt:new Date(stamp).toISOString()}}},
    {...am,cardioSessions:{pm:{notes:"Starting the race warm-up"}}}
  ]){
    expect(climbSlots(program,{[date]:{workout:protectedWorkout}},date)).toEqual([]);
    const row=finished(),result=recordClimb(protectedWorkout,row,owner,program);
    expect(result.sessionState).toBe(protectedWorkout.sessionState);
    expect(result.exercises).toBe(am.exercises);
    expect(result.cardioSessions.pm).toEqual(protectedWorkout.cardioSessions?.pm);
    expect(result.cardioSessions["climb-"+row.run.recordingId].unplanned).toBe(true);
  }
});
