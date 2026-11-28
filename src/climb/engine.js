import { accountSectionTerrain, gradeSamples } from "./sectionTerrain";
import { curveValue, gradeAt } from "./course";
export { matchRecordedGhost, withRecordedGhost } from "./matchGhost";
export { SAMPLE_COURSE, MAX_GPX_BYTES, importClimbGpx, listClimbGpxSegments,
  buildClimbCourse, selectClimb, gradeAt, sampleCoursePoint } from "./course";

const sources = ["belt", "watch", "manual", "pace"];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const systemTime = () => Date.now();

function referenceCurve(course, state) {
  if (state.reference === "indoor") return state.indoorGhost?.points;
  return state.reference === "recorded" && course.hasRecordedGhost ? course.recordedGhost?.points ?? course.points : null;
}

function referenceAt(course, state, distance) {
  if (state.reference === "pacer") return distance * state.paceSecondsPerKm / 1000;
  const curve = referenceCurve(course, state);
  return curve ? curveValue(curve, "meters", distance, "elapsedSeconds") : null;
}

export function startClimb(course, { owner = null, paceSecondsPerKm = 360, reference = course.hasRecordedGhost ? "recorded" : "pacer",
  indoorGhost = null, now = systemTime(), id = crypto.randomUUID(), recordingId = id } = {}) {
  if (typeof id !== "string" || !id || typeof recordingId !== "string" || !recordingId ||
      !Number.isFinite(now) || now < 0) throw new Error("This climb could not start. Try again.");
  if (!["recorded", "pacer", "solo", "indoor"].includes(reference)) throw new Error("Choose a valid climb reference.");
  if (reference === "recorded" && !course.hasRecordedGhost) throw new Error("This course needs continuous timestamps for an outdoor ghost.");
  if (reference === "indoor" && (!indoorGhost || indoorGhost.courseRevision !== course.revision ||
    !Array.isArray(indoorGhost.points) || indoorGhost.points.length < 2)) throw new Error("Choose a measured indoor effort on this course.");
  if (!Number.isFinite(paceSecondsPerKm) || paceSecondsPerKm <= 0) throw new Error("Enter a positive target pace.");
  return { version: 1, id, owner, recordingId, courseId: course.id, courseRevision: course.revision, name: course.name,
    reference, paceSecondsPerKm, ...(reference === "indoor" && { indoorGhost }),
    status: "active", startedAt: now, endedAt: null, lastAt: now, distanceMeters: 0, verifiedMeters: 0,
    marks: [], trace: [{ meters: 0, elapsedSeconds: 0 }], sensor: null, uncertain: false, estimated: false };
}

function elapsedAt(state, now) {
  return Math.max(0, ((state.endedAt ?? Math.max(state.lastAt, Number.isFinite(now) ? now : state.lastAt)) - state.startedAt) / 1000);
}

function trailWith(trace, point) {
  const previous = trace.at(-1);
  if (previous.elapsedSeconds === point.elapsedSeconds && previous.meters === point.meters) return trace;
  // Represent a stationary interval by exact arrival and departure timestamps.
  if (trace.length > 1 && previous.meters === point.meters && trace.at(-2).meters === point.meters)
    return [...trace.slice(0, -1), point];
  let retained = trace;
  if (trace.length >= 4096) {
    // Keep every dwell endpoint while reducing a long recording's moving samples.
    retained = trace.filter((p, i) => i === 0 || i === trace.length - 1 || i % 2 === 0 ||
      p.meters === trace[i - 1].meters || p.meters === trace[i + 1].meters);
    if (retained.length >= 4096) retained = retained.filter((_, i) => i === 0 || i % 2 === 1);
  }
  return [...retained, point];
}

/**
 * A belt/Watch/speed counter is relative to its own clock/connection. Take a
 * baseline on handoff or reset. Manual console input is an absolute distance
 * in this climb and can reconcile an earlier estimate without rewriting splits.
 */
export function updateClimb(course, state, event) {
  if (!state || state.status !== "active" || state.courseRevision !== course.revision) return state;
  const { source, meters, now = systemTime(), rebase = false, discontinuity = false } = event || {};
  if (!sources.includes(source) || !Number.isFinite(meters) || meters < 0 || !Number.isFinite(now) || now < state.lastAt) return state;
  const prev = state.sensor;
  const handoff = !prev || prev.source !== source || rebase || meters < prev.meters;
  const estimated = Boolean(event.estimated) || source === "watch" || source === "pace";
  const continuous = !handoff && !discontinuity && !estimated && prev.estimated !== true &&
    event.measuredDistanceTime !== false && prev.measuredDistanceTime !== false;
  const grades = event.measuredDistanceTime === false ? [] : gradeSamples({...event,now}, prev, continuous);
  const sensor = {source, meters, now, estimated, measuredDistanceTime:event.measuredDistanceTime !== false,
    gradeEpoch:continuous ? prev.gradeEpoch ?? prev.now : now, ...(grades.length > 0 && {gradeSample:grades.at(-1)})};
  const previousMeters = state.distanceMeters;
  let delta;
  if (source === "manual") {
    if (meters < previousMeters) return state;
    delta = meters - previousMeters;
  } else {
    delta = handoff ? 0 : meters - prev.meters;
  }
  const target = Math.min(course.distanceMeters, previousMeters + delta);
  const step = target - previousMeters;
  const elapsedSeconds = (now - state.startedAt) / 1000;
  const dt = (now - state.lastAt) / 1000;
  // Ignore a corrupt counter spike. A believable cumulative reading after a
  // longer radio gap still restores distance without inventing split times.
  if (source !== "manual" && delta > Math.max(6, dt * 12)) return state;
  const sparse = dt > 20 || (dt === 0 && delta > 0) || delta > Math.max(6, dt * 12);
  const missing = discontinuity || sparse || source === "manual";
  // A first post-reconnect cumulative value can resolve the distance, but it
  // cannot tell us precisely when an intermediate landmark was passed.
  let marks = state.marks;
  for (const landmark of course.landmarks) {
    if (landmark.meters <= previousMeters || landmark.meters > target) continue;
    const atEndpoint = Math.abs(meters - landmark.meters) <= .5 && source === "manual";
    const trustedCrossing = !missing || atEndpoint || (Math.abs(landmark.meters-target) < .01 && step === delta && !discontinuity && !sparse);
    const quality = trustedCrossing ? (estimated ? "estimated" : "measured") : "unknown";
    const crossingSeconds = trustedCrossing ? (atEndpoint ? elapsedSeconds :
      elapsedSeconds - dt * (1 - (landmark.meters - previousMeters) / delta)) : null;
    const referenceSeconds = referenceAt(course, state, landmark.meters);
    const gapSeconds = crossingSeconds != null && referenceSeconds != null ? referenceSeconds - crossingSeconds : null;
    const previousGap = marks.length ? marks.at(-1).gapSeconds : 0;
    marks = [...marks, { ...landmark, elapsedSeconds: crossingSeconds, referenceSeconds, gapSeconds,
      sectionGainSeconds: previousGap != null && gapSeconds != null ? gapSeconds - previousGap : null, quality }];
  }
  const finish = target >= course.distanceMeters;
  const finishTime = marks.at(-1)?.elapsedSeconds;
  const endedAt = finish ? (finishTime == null ? now : state.startedAt + finishTime * 1000) : null;
  const trace = trailWith(state.trace, { meters: target, elapsedSeconds: finish ? (endedAt-state.startedAt)/1000 : elapsedSeconds });
  const uncertain = state.uncertain || (step > 0 && (missing || estimated)) || !!(prev && handoff && source !== "manual");
  const terrain = accountSectionTerrain(course,state,{target,delta,event:{...event,now},continuous:continuous && !sparse,grades});
  return { ...state, ...terrain, status: finish ? "finished" : "active", endedAt, lastAt: now, distanceMeters: target, sensor, marks, estimated,
    uncertain, trace, verifiedMeters: state.verifiedMeters + (estimated ? 0 : step) };
}

export function finishClimb(course, state, now = systemTime()) {
  if (!state || state.status !== "active" || state.courseRevision !== course.revision) return state;
  const endedAt = Math.max(state.lastAt, Number.isFinite(now) ? now : state.lastAt);
  return { ...state, endedAt, lastAt: endedAt, status: "partial" };
}

export function climbReadout(course, state, now = systemTime()) {
  const elapsedSeconds = elapsedAt(state, now);
  const distanceMeters = state.distanceMeters;
  const referenceSeconds = referenceAt(course, state, distanceMeters);
  const curve = referenceCurve(course, state);
  const ghostMeters = state.reference === "pacer" ? clamp(elapsedSeconds * 1000 / state.paceSecondsPerKm, 0, course.distanceMeters)
    : curve ? curveValue(curve, "elapsedSeconds", elapsedSeconds, "meters") : null;
  const finished = state.status !== "active";
  const lastSplit = state.marks.at(-1);
  const unknownFinish = state.status === "finished" && lastSplit?.quality === "unknown";
  return { elapsedSeconds, distanceMeters, referenceSeconds, ghostMeters, gradePercent: gradeAt(course, distanceMeters),
    gapSeconds: referenceSeconds == null || unknownFinish ? null : referenceSeconds - elapsedSeconds,
    nextLandmark: course.landmarks.find(mark=>mark.meters>distanceMeters+.001) || null,
    estimated: state.estimated, stale: !finished && (!state.sensor || now-state.sensor.now > 20_000), finished };
}

export function buildIndoorGhost(course, attempt) {
  if (!attempt || attempt.courseRevision !== course.revision || attempt.status !== "finished" ||
      attempt.uncertain || attempt.distanceMeters < course.distanceMeters - .01 || !Array.isArray(attempt.trace) || attempt.trace.length < 2) return null;
  const points = attempt.trace;
  if (points.length > 4096 || points[0]?.meters !== 0 || points[0]?.elapsedSeconds !== 0 || points.at(-1)?.meters !== course.distanceMeters ||
    !points.every((p, i) => p && Number.isFinite(p.meters) && Number.isFinite(p.elapsedSeconds) &&
      (!i || (p.meters >= points[i-1].meters && p.elapsedSeconds >= points[i-1].elapsedSeconds &&
        (p.meters === points[i-1].meters || p.elapsedSeconds > points[i-1].elapsedSeconds))))) return null;
  return { id: attempt.id, name: attempt.name || course.name, courseRevision: course.revision, points };
}
