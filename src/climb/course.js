// Metres along the ordered line are the shared coordinate for terrain, landmarks
// and both runners. Keep stationary fixes: their timestamps encode aid-stop dwell.
import { courseDistances, validCourseId } from "../rehearsal/course";
import { stableUuid } from "../stableUuid";

const MAX_POINTS = 50_000;
const MAX_MARKS = 40;
export const MAX_GPX_BYTES = 8 * 1024 * 1024;
const within = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
const cleanName = (s, fallback) => typeof s === "string" && s.trim() ? s.trim().slice(0, 120) : fallback;

export function lowerBound(points, key, value) {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid][key] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function fractionAt(points, axis, value) {
  const i = Math.min(lowerBound(points, axis, value), points.length - 1);
  const b = points[i];
  if (i === 0 || b[axis] === value) return [b, b, 0];
  const a = points[i - 1];
  return [a, b, Math.max(0, Math.min(1, (value - a[axis]) / (b[axis] - a[axis]) || 0))];
}

const lerp = (a, b, t) => Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : null;
const deltaLon = (a, b) => ((a - b + 540) % 360) - 180;

export function sampleCoursePoint(course, meters) {
  const [a, b, t] = fractionAt(course.points, "meters", meters);
  if (a === b) return { ...a };
  return { lat: lerp(a.lat, b.lat, t), lon: deltaLon(a.lon + deltaLon(b.lon, a.lon) * t, 0),
    meters: lerp(a.meters, b.meters, t), elevationMeters: lerp(a.elevationMeters, b.elevationMeters, t),
    elapsedSeconds: soundTimeLeg(a, b) ? lerp(a.elapsedSeconds, b.elapsedSeconds, t) : null };
}

function soundTimeLeg(a, b) {
  if (!Number.isFinite(a.elapsedSeconds) || !Number.isFinite(b.elapsedSeconds)) return false;
  const dt = b.elapsedSeconds - a.elapsedSeconds, d = b.meters - a.meters;
  // A long stationary interval is valid. A long moving gap can't establish a
  // runner's position on a specific switchback, even with valid endpoints.
  return dt >= 0 && (d <= 1 || (dt > 0 && d / dt <= 14 && (dt <= 180 || d <= 30)));
}

export function curveValue(points, axis, value, field) {
  const [a, b, t] = fractionAt(points, axis, value);
  return lerp(a[field], b[field], t);
}

export function gradeAt(course, meters) {
  const pts = course.points;
  const lo = Math.max(0, meters - 20), hi = Math.min(course.distanceMeters, meters + 20);
  if (hi - lo < 1) return null;
  const start = Math.max(1, lowerBound(pts, "meters", lo));
  const end = Math.min(pts.length - 1, lowerBound(pts, "meters", hi));
  for (let i = start; i <= end; i++) {
    const a = pts[i - 1], b = pts[i], d = b.meters - a.meters;
    if (b.meters < lo || (b.meters === lo && i < pts.length - 1)) continue;
    if (!Number.isFinite(a.elevationMeters) || !Number.isFinite(b.elevationMeters) ||
        d > 250 || Math.abs(b.elevationMeters - a.elevationMeters) > Math.max(5, d * 0.65)) return null;
  }
  const a = sampleCoursePoint(course, lo), b = sampleCoursePoint(course, hi);
  if (!Number.isFinite(a.elevationMeters) || !Number.isFinite(b.elevationMeters)) return null;
  const grade = (b.elevationMeters - a.elevationMeters) * 100 / (hi - lo);
  return Math.abs(grade) <= 65 ? grade : null;
}

function canonicalMarks(raw, distanceMeters, addDefaultSplits) {
  if (!Array.isArray(raw) || raw.length > MAX_MARKS) throw new Error("Use up to 40 landmarks on a climb.");
  const marks = [];
  for (const item of raw) {
    if (!item || !within(item.meters, 0, distanceMeters + 0.01)) throw new Error("Place each landmark on the selected climb.");
    if (item.meters < 0.5 || item.meters >= distanceMeters - 0.5) continue;
    const id = validCourseId(item.id) ? item.id : "marker-" + marks.length;
    if (id === "crest" || marks.some(mark => mark.id === id)) throw new Error("Each landmark needs a different ID.");
    marks.push({ id, name: cleanName(item.name, "Split " + (marks.length + 1)), meters: item.meters });
  }
  if (!marks.length && addDefaultSplits && distanceMeters >= 100) {
    for (const [n, f] of [[1, 1/3], [2, 2/3]]) marks.push({ id: "split-" + n, name: "Split " + n, meters: distanceMeters * f });
  }
  marks.sort((a, b) => a.meters - b.meters);
  marks.push({ id: "crest", name: "Finish", meters: distanceMeters });
  return marks;
}

// Count meaningful climbing between valleys and crests. A small alternating
// elevation error on a flat road must not accumulate indefinitely as ascent.
function profileSummary(points) {
  const hysteresis = 2;
  let elevationCoverage = 0, ascent = 0, valley = null, peak = null;
  function closeClimb() {
    if (peak !== null && peak - valley >= hysteresis) ascent += peak - valley;
    valley = null;
    peak = null;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], d = b.meters - a.meters;
    const rise = b.elevationMeters - a.elevationMeters;
    if (!Number.isFinite(a.elevationMeters) || !Number.isFinite(b.elevationMeters) ||
        d > 250 || Math.abs(rise) > Math.max(5, d * 0.65)) {
      closeClimb();
      continue;
    }
    if (!d) continue;
    elevationCoverage += d;
    if (valley === null) valley = a.elevationMeters;
    if (peak !== null && b.elevationMeters <= peak - hysteresis) closeClimb();
    valley = Math.min(valley ?? b.elevationMeters, b.elevationMeters);
    if (b.elevationMeters - valley >= hysteresis) peak = Math.max(peak ?? valley, b.elevationMeters);
  }
  closeClimb();
  return { ascent, elevationCoverage };
}

function makeCourse({ name, points, landmarks, source, seedId, rootRevision, offset = 0, addDefaultSplits = true, terrain, elevationSource }) {
  const distanceMeters = points.at(-1).meters;
  if (distanceMeters < 1) throw new Error("A climb needs at least one metre of continuous route.");
  const marks = canonicalMarks(landmarks || [], distanceMeters, addDefaultSplits);
  const title = cleanName(name, "Imported climb");
  const revision = stableUuid(JSON.stringify([1, title, source, rootRevision, offset, points, marks, terrain?.revision]));
  const hasRecordedGhost = Number.isFinite(points[0].elapsedSeconds) && points.at(-1).elapsedSeconds > 0 &&
    points.every((p, i) => !i || soundTimeLeg(points[i - 1], p));
  const { ascent, elevationCoverage } = profileSummary(points);
  return { version: 1, id: seedId || revision, revision, rootRevision: rootRevision || revision,
    name: title, source, points, distanceMeters, ...(terrain && { terrain }), ...(elevationSource && { elevationSource }), startMeters: offset, endMeters: offset + distanceMeters,
    ascentMeters: elevationCoverage ? ascent : null, elevationCoverage: elevationCoverage / distanceMeters,
    hasElevation: elevationCoverage > 0, hasRecordedGhost, landmarks: marks };
}

function absoluteTime(point) {
  const value = point.time ?? point.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // A local date without zone is ambiguous across phones / DST.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function buildClimbCourse({ name, points, landmarks = [], source = "course" } = {}) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS)
    throw new Error("Choose a continuous climb with 2 to 50,000 route points.");
  if (!points.every(p => p && within(p.lat, -90, 90) && within(p.lon, -180, 180)))
    throw new Error("The course has an invalid latitude or longitude.");
  const distances = courseDistances(points);
  const firstTimed = points.find(p => absoluteTime(p) != null);
  const initialTime = firstTimed ? absoluteTime(firstTimed) : null;
  const firstElapsed = points.find(p => Number.isFinite(p.elapsedSeconds))?.elapsedSeconds ?? 0;
  const line = points.map((p, i) => {
    const time = absoluteTime(p);
    const ele = p.elevationMeters ?? p.ele ?? p.altitude;
    return { lat: p.lat, lon: p.lon, meters: distances[i], elevationMeters: within(ele, -500, 9000) ? ele : null,
      elapsedSeconds: Number.isFinite(p.elapsedSeconds) ? p.elapsedSeconds - firstElapsed :
        (initialTime != null && time != null ? (time - initialTime) / 1000 : null) };
  });
  return makeCourse({ name, points: line, source: cleanName(source, "course"), landmarks });
}

function ghostSection(points, start, end) {
  const t0 = curveValue(points, "meters", start, "elapsedSeconds");
  const t1 = curveValue(points, "meters", end, "elapsedSeconds");
  const kept = points.filter(p => p.meters >= start && p.meters < end);
  if (kept[0]?.meters !== start) kept.unshift({meters:start,elapsedSeconds:t0});
  kept.push({meters:end,elapsedSeconds:t1});
  return kept.map(p=>({meters:p.meters-start,elapsedSeconds:p.elapsedSeconds-t0}));
}

// A separate athlete trace carries timing only. The original distance, terrain
// and landmarks remain the source of truth for this course's physical shape.
export function attachRecordedGhost(course, ghost) {
  const baseRevision = course.ghostBaseRevision ?? course.revision;
  const identity = stableUuid(JSON.stringify([baseRevision, ghost.id, ghost.points]));
  if (identity === course.revision) return course;
  return {...course, revision:identity, ghostBaseRevision:baseRevision, hasRecordedGhost:true, ghostSource:"matched", ghostName:ghost.name, recordedGhost:ghost};
}

export function selectClimb(course, { startMeters = 0, endMeters = course.distanceMeters, landmarks, name } = {}) {
  if (!within(startMeters, 0, course.distanceMeters) || !within(endMeters, 0, course.distanceMeters) ||
      endMeters - startMeters < Math.min(10, course.distanceMeters)) throw new Error("Choose a section of at least 10 metres.");
  if (!name && !landmarks && startMeters === 0 && endMeters === course.distanceMeters) return course;
  const first = sampleCoursePoint(course, startMeters), last = sampleCoursePoint(course, endMeters);
  const middle = course.points.filter(p => p.meters >= startMeters && p.meters < endMeters);
  // Retain timed dwell at the starting station. Stop at first arrival at the crest.
  if (middle[0]?.meters !== startMeters) middle.unshift(first);
  const points = [...middle, last].map(p => ({ ...p, meters: p.meters - startMeters,
    elapsedSeconds: Number.isFinite(p.elapsedSeconds) && Number.isFinite(first.elapsedSeconds) ? p.elapsedSeconds - first.elapsedSeconds : null }));
  const marks = landmarks ?? course.landmarks.filter(m => m.meters > startMeters && m.meters < endMeters)
    .map(m => ({ ...m, meters: m.meters - startMeters }));
  const selected = makeCourse({ name: name ?? course.name, source: course.source, points, landmarks: marks,
    rootRevision: course.rootRevision, seedId: course.id, offset: course.startMeters + startMeters, addDefaultSplits: false,
    terrain: course.terrain, elevationSource: course.elevationSource });
  return course.recordedGhost ? attachRecordedGhost(selected, {...course.recordedGhost,
    points:ghostSection(course.recordedGhost.points,startMeters,endMeters)}) : selected;
}

// Adding a terrain pack produces a separate durable revision. Keep the original
// GPS elevation profile when present: mixing vertical datums can create cliffs.
export function attachClimbTerrain(course, terrain, sampledElevations) {
  const useDemProfile = !course.hasElevation && sampledElevations.some(Number.isFinite);
  const points = useDemProfile ? course.points.map((p, i) =>
    ({ ...p, elevationMeters: sampledElevations[i] ?? null })) : course.points;
  const enriched = makeCourse({ name: course.name, points, landmarks: course.landmarks, source: course.source,
    seedId: course.id, rootRevision: course.rootRevision, offset: course.startMeters, addDefaultSplits: false, terrain,
    elevationSource: useDemProfile ? "USGS 3DEP" : course.elevationSource });
  return course.recordedGhost ? attachRecordedGhost(enriched, course.recordedGhost) : enriched;
}

const children = (node, tag) => Array.from(node.children).filter(n => n.localName === tag);
const childText = (node, tag) => children(node, tag)[0]?.textContent?.trim() || "";
function parseGpx(text) {
  if (typeof text !== "string" || text.length > MAX_GPX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Choose a GPX file up to 8 MB without an XML document type.");
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const root = xml.documentElement;
  if (root?.localName !== "gpx" || xml.getElementsByTagName("parsererror").length) throw new Error("Choose a valid GPX track or route.");
  const segments = [];
  for (const node of root.children) {
    if (!["trk", "rte"].includes(node.localName)) continue;
    const name = childText(node, "name") || childText(children(root, "metadata")[0] || root, "name") || "Imported course";
    const track = node.localName === "trk";
    const groups = track ? children(node, "trkseg") : [node];
    groups.forEach((group, i) => {
      const nodes = children(group, track ? "trkpt" : "rtept");
      if (nodes.length >= 2) segments.push({name: groups.length > 1 ? name + " · section " + (i + 1) : name, nodes});
    });
  }
  if (!segments.length) throw new Error("This GPX has no continuous track or route.");
  return { root, segments };
}

export function listClimbGpxSegments(text) {
  return parseGpx(text).segments.map((s, index) => ({ index, name: s.name, pointCount: s.nodes.length }));
}

function xmlNumber(raw) {
  return typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

function gpxPoint(node) {
  return { lat: xmlNumber(node.getAttribute("lat")), lon: xmlNumber(node.getAttribute("lon")),
    elevationMeters: xmlNumber(childText(node, "ele")), time: childText(node, "time") };
}

// A standalone waypoint can sit in the middle of a long GPX leg. Project onto
// the ordered route, preserving the original polyline and sample timestamps.
function nearestStation(points, fix) {
  const xScale = Math.cos(fix.lat * Math.PI / 180) * 111_195, yScale = 111_195;
  let closestSquared = 150 ** 2, station = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = deltaLon(b.lon, a.lon) * xScale, dy = (b.lat - a.lat) * yScale;
    const x = deltaLon(fix.lon, a.lon) * xScale, y = (fix.lat - a.lat) * yScale;
    const size = dx * dx + dy * dy;
    const f = size ? Math.max(0, Math.min(1, (x * dx + y * dy) / size)) : 0;
    const squared = (x - f * dx) ** 2 + (y - f * dy) ** 2;
    if (squared < closestSquared) { closestSquared = squared; station = lerp(a.meters, b.meters, f); }
  }
  return station;
}

export function importClimbGpx(text, {segmentIndex = 0} = {}) {
  const { root, segments } = parseGpx(text);
  const segment = segments[segmentIndex];
  if (!segment) throw new Error("Choose a valid GPX section.");
  if (segment.nodes.length > MAX_POINTS) throw new Error("Select a GPX section with up to 50,000 points.");
  const raw = segment.nodes.map(gpxPoint);
  const course = buildClimbCourse({ name: segment.name, points: raw, source: "gpx" });
  const landmarks = [];
  function mark(name, meters) {
    if (!name || meters == null || meters < .5 || meters >= course.distanceMeters - .5) return;
    if (landmarks.length >= MAX_MARKS - 1) throw new Error("Choose a GPX with up to 39 named landmarks and a finish.");
    landmarks.push({ id: "gpx-" + (landmarks.length + 1), name, meters });
  }
  segment.nodes.forEach((n, i) => mark(childText(n, "name"),course.points[i].meters));
  const named = children(root, "wpt").filter(n => childText(n, "name"));
  if (named.length > MAX_MARKS) throw new Error("Choose a GPX with up to 40 named waypoints.");
  for (const node of named) {
    const fix = gpxPoint(node);
    if (within(fix.lat,-90,90) && within(fix.lon,-180,180)) mark(childText(node, "name"), nearestStation(course.points, fix));
  }
  return landmarks.length ? makeCourse({ name: course.name, points: course.points, landmarks, source: "gpx" }) : course;
}

// A fictional gradient profile, clearly identified as a sample rather than a race.
function sampleRidge() {
  const anchors = [[0, 24, 1500], [60, 6, 1505], [128, -9, 1511], [203, 70, 1522], [265, 92, 1528],
    [325, 25, 1533], [387, -20, 1541], [455, 45, 1548], [520, 74, 1554], [577, 48, 1558], [660, 12, 1560]];
  const points = [];
  const markers = [];
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i-1], b = anchors[i];
    for (let j = i === 1 ? 0 : 1; j <= 8; j++) {
      const t = j/8;
      points.push({ lat: 39.7 + lerp(a[1], b[1], t) / 111195,
        lon: -105.2 + lerp(a[0], b[0], t) / (111195 * Math.cos(39.7*Math.PI/180)), elevationMeters: lerp(a[2], b[2], t) });
    }
    if (i === 2 || i === 6) markers.push({ id: "ridge-" + i, name: i === 2 ? "Creek crossing" : "Upper hairpin", index: points.length - 1 });
  }
  const meters = courseDistances(points);
  return buildClimbCourse({ name: "Switchback Ridge", source: "sample", points, landmarks: markers.map(m=>({...m,meters:meters[m.index]})) });
}
export const SAMPLE_COURSE = sampleRidge();
