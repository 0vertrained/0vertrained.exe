import { validCourseId, checkpointKinds } from "./course";

const name = value => typeof value === "string" && value.trim().length > 0 && value.length <= 120;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const seconds = value => Number.isSafeInteger(value) && value >= 0;
function instant(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

// The workout log retains what the athlete rehearsed even after a course is
// renamed or replaced. Accept only the fields used in the athlete's history.
export function rehearsalAttempt(raw) {
  if (!raw || !validCourseId(raw.id) || !validCourseId(raw.courseId) || !name(raw.name) ||
      !Array.isArray(raw.marks) || raw.marks.length > 40 || !nonnegative(raw.distanceMeters)) return null;
  const start = instant(raw.startedAt), end = instant(raw.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  // A watch may round its two ISO timestamps to seconds independently.
  const duration = Math.ceil((end - start) / 1000) + 1;
  let lastMeters = 0, lastTime = 0;
  const marks = [], ids = new Set();
  for (const mark of raw.marks) {
    if (!mark || !validCourseId(mark.checkpointId) || ids.has(mark.checkpointId) || !name(mark.name) ||
        !checkpointKinds.includes(mark.kind) || !["taken", "skipped"].includes(mark.status) ||
        !nonnegative(mark.meters) || mark.meters < lastMeters || !seconds(mark.elapsedSeconds) ||
        mark.elapsedSeconds < lastTime || mark.elapsedSeconds > duration ||
        (mark.targetSeconds != null && !seconds(mark.targetSeconds)) ||
        (mark.departedSeconds != null && (!seconds(mark.departedSeconds) || mark.departedSeconds < mark.elapsedSeconds || mark.departedSeconds > duration))) return null;
    ids.add(mark.checkpointId);
    lastMeters = mark.meters;
    lastTime = mark.departedSeconds ?? mark.elapsedSeconds;
    marks.push({ checkpointId: mark.checkpointId, name: mark.name, kind: mark.kind, meters: mark.meters,
      targetSeconds: mark.targetSeconds ?? null, elapsedSeconds: mark.elapsedSeconds, status: mark.status,
      ...(mark.departedSeconds != null && { departedSeconds: mark.departedSeconds }) });
  }
  return { id: raw.id, courseId: raw.courseId, name: raw.name, startedAt: raw.startedAt, endedAt: raw.endedAt, distanceMeters: raw.distanceMeters, marks };
}
