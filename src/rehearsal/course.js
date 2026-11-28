// A rehearsal keeps a bounded, ordered course on both devices. Distances are
// measured along the polyline, including on loops and out-and-back courses.
const MAX_POINTS = 450;
const MAX_CHECKPOINTS = 40;
export const checkpointKinds = ["split", "aid", "fuel", "water", "finish"];
export function validCourseId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
}
export function validCourseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(+date) && date.toISOString().startsWith(value + "T");
}
function check(ok, message) { if (!ok) throw new Error(message); }
const radians = Math.PI / 180;
function distance(a, b) {
  const h = Math.sin((b.lat - a.lat) * radians / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin((b.lon - a.lon) * radians / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function courseDistances(points) {
  let meters = 0;
  return points.map((pt, i) => {
    if (i) meters += distance(points[i - 1], pt);
    return meters;
  });
}
function point(value) {
  check(value && Number.isFinite(value.lat) && Math.abs(value.lat) <= 85.051129 &&
    Number.isFinite(value.lon) && Math.abs(value.lon) <= 180, "Use valid latitude and longitude within the map.");
  return { lat: +value.lat.toFixed(6), lon: +value.lon.toFixed(6) };
}
const label = (value, max) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
export function buildCourse({ id, name, date, points, checkpoints = [] }) {
  check(validCourseId(id), "Create the course again to give it a valid ID.");
  check(label(name, 120), "Name the course using up to 120 characters.");
  check(validCourseDate(date), "Choose a valid rehearsal date.");
  check(Array.isArray(points) && points.length >= 2 && points.length <= MAX_POINTS, "Draw a course with 2 to 450 route points.");
  const line = points.map(point);
  const cumulative = courseDistances(line);
  const distanceMeters = cumulative.at(-1);
  check(distanceMeters >= 1, "Place the route points at least one meter apart in total.");
  check(Array.isArray(checkpoints) && checkpoints.length <= MAX_CHECKPOINTS, "Use up to 40 checkpoints including the finish.");
  const ids = new Set();
  const ordered = checkpoints.map(cp => {
    check(cp && validCourseId(cp.id) && !ids.has(cp.id), "Each checkpoint needs its own ID.");
    ids.add(cp.id);
    check(Number.isInteger(cp.pointIndex) && cp.pointIndex >= 0 && cp.pointIndex < line.length, "Place each checkpoint on the route.");
    check(checkpointKinds.includes(cp.kind) && label(cp.name, 120), "Choose a type and name for each checkpoint.");
    check(cp.kind !== "finish" || cp.pointIndex === line.length - 1, "Place the finish at the final route point.");
    check(cp.targetSeconds == null || (Number.isSafeInteger(cp.targetSeconds) && cp.targetSeconds > 0), "Enter a positive elapsed time for checkpoint targets.");
    check(cp.instruction == null || (typeof cp.instruction === "string" && cp.instruction.length <= 240), "Keep checkpoint instructions under 241 characters.");
    return { id: cp.id, name: cp.name.trim(), kind: cp.kind, pointIndex: cp.pointIndex, meters: cumulative[cp.pointIndex],
      targetSeconds: cp.targetSeconds ?? null, instruction: cp.instruction?.trim() || "" };
  }).sort((a, b) => a.pointIndex - b.pointIndex || Number(a.kind === "finish") - Number(b.kind === "finish"));
  check(ordered.filter(cp => cp.kind === "finish").length <= 1, "Keep a single finish checkpoint.");
  if (ordered.at(-1)?.kind !== "finish") {
    check(ordered.length < MAX_CHECKPOINTS, "Leave one of the 40 checkpoints for the finish.");
    let finishId = "finish";
    while (ids.has(finishId)) finishId += "_";
    ordered.push({ id: finishId, name: "Finish", kind: "finish", pointIndex: line.length - 1, meters: distanceMeters, targetSeconds: null, instruction: "" });
  }
  let lastTarget = 0;
  for (const cp of ordered) {
    if (cp.targetSeconds == null) continue;
    check(cp.targetSeconds >= lastTarget, "Checkpoint targets must follow elapsed race time along the route.");
    lastTarget = cp.targetSeconds;
  }
  return { id, name: name.trim(), date, points: line, checkpoints: ordered, distanceMeters };
}

// Retain named checkpoints and endpoints. Spend the remaining point budget
// on bends with the largest departure from the chord, splitting straight
// sections near the middle to keep equally shaped alternatives deterministic.
function simplify(points, pinned) {
  if (points.length <= MAX_POINTS) return points.map((_, index) => index);
  const kept = new Set([0, points.length - 1, ...pinned]);
  const gaps = [];
  function addGap(a, b) {
    if (b <= a + 1) return;
    const scale = Math.cos(points[a].lat * radians);
    const deltaLon = (x, y) => ((x - y + 540) % 360) - 180;
    const dx = deltaLon(points[b].lon, points[a].lon) * scale, dy = points[b].lat - points[a].lat;
    const squared = dx * dx + dy * dy;
    let best = -1, index = a + 1;
    for (let i = a + 1; i < b; i++) {
      const x = deltaLon(points[i].lon, points[a].lon) * scale, y = points[i].lat - points[a].lat;
      const t = squared ? Math.max(0, Math.min(1, (x * dx + y * dy) / squared)) : 0;
      const error = (x - t * dx) ** 2 + (y - t * dy) ** 2;
      if (error > best || (error === best && Math.abs(i - (a + b) / 2) < Math.abs(index - (a + b) / 2))) {
        best = error; index = i;
      }
    }
    gaps.push({ a, b, index, error: best });
  }
  const sorted = [...kept].sort((a, b) => a - b);
  sorted.slice(1).forEach((end, i) => addGap(sorted[i], end));
  while (kept.size < MAX_POINTS && gaps.length) {
    gaps.sort((x, y) => x.error - y.error || (x.b - x.a) - (y.b - y.a));
    const { a, b, index } = gaps.pop();
    kept.add(index); addGap(a, index); addGap(index, b);
  }
  return [...kept].sort((a, b) => a - b);
}
const children = (node, tag) => Array.from(node.children).filter(item => item.localName === tag);
const childText = (node, tag) => children(node, tag)[0]?.textContent?.trim() || "";
function gpxPoint(node) {
  const coords = ["lat", "lon"].map(key => {
    const raw = node.getAttribute(key);
    return raw?.trim() ? Number(raw) : NaN;
  });
  return point({ lat: coords[0], lon: coords[1] });
}
// GPX waypoints can fall halfway along a long, straight route leg. Insert a
// point on the line at that location before reducing the route for the Watch.
function snapWaypoint(line, fix) {
  const xScale = Math.cos(fix.lat * radians);
  const longitudeDelta = (a, b) => ((a - b + 540) % 360) - 180;
  let bestMeters = Infinity;
  let result;
  for (let end = 1; end < line.length; end++) {
    const a = line[end - 1], b = line[end];
    const dLon = longitudeDelta(b.lon, a.lon);
    const dx = dLon * xScale, dy = b.lat - a.lat;
    const lengthSquared = dx * dx + dy * dy;
    const x = longitudeDelta(fix.lon, a.lon) * xScale, y = fix.lat - a.lat;
    const fraction = lengthSquared ? Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared)) : 0;
    const snapped = point({ lat: a.lat + fraction * dy, lon: longitudeDelta(a.lon + fraction * dLon, 0) });
    const meters = distance(fix, snapped);
    if (meters >= bestMeters) continue;
    bestMeters = meters;
    // Use an existing endpoint when coordinate rounding put us there.
    const atStart = distance(a, snapped) < 0.15, atEnd = distance(b, snapped) < 0.15;
    result = atStart || atEnd ? { position: atStart ? end - 1 : end } : { position: end - 1 + fraction, point: snapped };
    if (meters < 0.01) break;
  }
  return bestMeters <= 150 ? result : null;
}
export function importGpx(text) {
  check(typeof text === "string" && text.length <= 8 * 1024 * 1024 && !/<!DOCTYPE|<!ENTITY/i.test(text), "Choose a GPX file of up to 8 MB without an XML document type.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  check(root?.localName === "gpx" && !doc.getElementsByTagName("parsererror").length, "Choose a valid GPX track or route.");
  const tracks = children(root, "trk");
  const routes = children(root, "rte");
  check(tracks.length + routes.length === 1, "Import one continuous GPX track or route at a time.");
  const track = tracks[0] || routes[0];
  const segments = tracks.length ? children(track, "trkseg") : [track];
  check(segments.length === 1, "Import a continuous course with a single segment so gaps are not joined.");
  const nodes = children(segments[0], tracks.length ? "trkpt" : "rtept");
  check(nodes.length >= 2 && nodes.length <= 50000, "Choose a GPX course with 2 to 50,000 points.");
  const points = nodes.map(gpxPoint);
  const placements = points.map((pt, i) => [i, pt]);
  const marks = [];
  function addMark(node, index) {
    const name = childText(node, "name");
    if (!name) return;
    check(marks.length < MAX_CHECKPOINTS, "Use up to 40 named GPX checkpoints including the finish.");
    const type = childText(node, "type").toLowerCase();
    const kind = checkpointKinds.includes(type) && (type !== "finish" || index === nodes.length - 1) ? type : "split";
    marks.push({ id: "gpx-" + marks.length, name: name.slice(0, 120), kind, pointIndex: index, instruction: childText(node, "desc").slice(0, 240) });
  }
  nodes.forEach(addMark);
  const namedWaypoints = children(root, "wpt").filter(node => childText(node, "name"));
  check(namedWaypoints.length + marks.length <= MAX_CHECKPOINTS, "Use up to 40 named GPX checkpoints including the finish.");
  for (const waypoint of namedWaypoints) {
    const snap = snapWaypoint(points, gpxPoint(waypoint));
    if (!snap) continue;
    if (snap.point) placements.push([snap.position, snap.point]);
    addMark(waypoint, snap.position);
  }
  const sortedPoints = [...new Map(placements)].sort((a, b) => a[0] - b[0]);
  const line = sortedPoints.map(([, pt]) => pt);
  const positions = new Map(sortedPoints.map(([position], i) => [position, i]));
  for (const cp of marks) cp.pointIndex = positions.get(cp.pointIndex);
  const indices = simplify(line, marks.map(cp => cp.pointIndex));
  const indexMap = new Map(indices.map((old, i) => [old, i]));
  const course = buildCourse({ id: "import", date: "2000-01-01", name: (childText(track, "name") || childText(children(root, "metadata")[0] || root, "name") || "Imported course").slice(0, 120),
    points: indices.map(i => line[i]), checkpoints: marks.map(cp => ({ ...cp, pointIndex: indexMap.get(cp.pointIndex) })) });
  return { name: course.name, points: course.points, checkpoints: course.checkpoints };
}

// A course belongs to the athlete's calendar across changes of training plan.
export function preserveRehearsal(previous, next) {
  if (previous?.__climbs && next && !Object.hasOwn(next, "__climbs")) next = { ...next, __climbs: previous.__climbs };
  return previous?.__rehearsal && next && !Object.hasOwn(next, "__rehearsal")
    ? { ...next, __rehearsal: previous.__rehearsal } : next;
}
