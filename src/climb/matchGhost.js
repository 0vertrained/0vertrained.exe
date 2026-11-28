import { attachRecordedGhost, sampleCoursePoint, selectClimb } from "./course";
import { stableUuid } from "../stableUuid";

const METRES_PER_DEGREE = 111195;
const OUTER_RADIUS = 25;
const INNER_RADIUS = 15;

function toLocal(origin) {
  const scale = METRES_PER_DEGREE * Math.cos(origin.lat * Math.PI / 180);
  return point => ({ x: (((point.lon - origin.lon + 540) % 360) - 180) * scale,
    y: (point.lat - origin.lat) * METRES_PER_DEGREE, meters:point.meters, elapsedSeconds:point.elapsedSeconds });
}

function project(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dot = (p.x - a.x)*dx + (p.y - a.y)*dy, length = dx*dx + dy*dy;
  const f = length ? Math.max(0,Math.min(1,dot/length)) : 0;
  return { lateral:Math.hypot(p.x-a.x-f*dx,p.y-a.y-f*dy), meters:a.meters+f*(b.meters-a.meters) };
}

// A reference can contain a warm-up and cooldown, or multiple visits to a
// crossing. Keep distinct visits, then verify the whole ordered traversal.
function visits(trace, point) {
  const near = [];
  let best = null, last = -Infinity;
  for (let i = 1; i < trace.length; i++) {
    const candidate = project(trace[i-1], trace[i], point);
    if (candidate.lateral > OUTER_RADIUS) continue;
    if (candidate.meters - last > 45 && best) { near.push(best); best = null; }
    if (!best || candidate.lateral < best.lateral) best = candidate;
    last = candidate.meters;
  }
  if (best) near.push(best);
  return near;
}

function courseGrid(course, local) {
  const count = Math.min(12000, Math.ceil(course.distanceMeters / 8));
  return Array.from({length:count+1}, (_, i)=>local(sampleCoursePoint(course,i*course.distanceMeters/count)));
}

// Distance ordering and a narrow moving search window prevent a hairpin or an
// out-and-back from borrowing timestamps on the adjacent/reversed leg.
function snap(grid, point, expected, previous, total) {
  const spacing = total / (grid.length-1);
  const window = Math.min(150,Math.max(35,total*.035));
  const from = Math.max(1,Math.floor(Math.max(expected-window,previous-8) / spacing));
  const to = Math.min(grid.length-1,Math.ceil((expected+window)/spacing)+1);
  let best = null;
  for(let i=from;i<=to;i++){
    const candidate = project(grid[i-1],grid[i],point);
    if (candidate.meters < previous-8) continue;
    if (!best || candidate.lateral < best.lateral-.4 ||
        (Math.abs(candidate.lateral-best.lateral)<=.4 && Math.abs(candidate.meters-expected)<Math.abs(best.meters-expected))) best = candidate;
  }
  return best;
}

function compress(points) {
  if (points.length <= 4096) return points;
  const keep = new Set([0,points.length-1]);
  for(let i=1;i<points.length;i++) {
    if (points[i].meters === points[i-1].meters) {
      keep.add(i-1); keep.add(i);
    }
  }
  if (keep.size > 2048) throw new Error("The recording contains too many stationary intervals. Select a shorter recorded section.");
  const slots = 4096 - keep.size;
  for(let i=1;i<=slots;i++) keep.add(Math.round(i*(points.length-1)/(slots+1)));
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}

function alignedTrace(course, source, start, end, local, grid) {
  const selected = selectClimb(source,{startMeters:start,endMeters:end});
  if (!selected.hasRecordedGhost || selected.recordedGhost) return null;
  const trace = selected.points.map(local), target = course.distanceMeters;
  const points = [{meters:0,elapsedSeconds:0}];
  let validLength = 0, previous = 0;
  for(let i=1;i<trace.length;i++) {
    const a = trace[i-1], b = trace[i], step = b.meters-a.meters, dt = b.elapsedSeconds-a.elapsedSeconds;
    if (step > 150 || (step > 30 && dt > 90)) return null;
    // A long straight chord can cut off a switchback. Check its interior too,
    // even when only its endpoint will be retained in the final time curve.
    const divisions = Math.max(1,Math.ceil(step/15));
    for(let part=1;part<=divisions;part++) {
      const f=part/divisions, at=a.meters+f*step;
      const p={x:a.x+f*(b.x-a.x),y:a.y+f*(b.y-a.y)};
      const match=snap(grid,p,target*at/selected.distanceMeters,previous,target);
      if (!match || match.lateral > OUTER_RADIUS || match.meters-previous > 16+1.8*step/divisions) return null;
      if (match.lateral <= INNER_RADIUS) validLength+=step/divisions;
      previous=Math.max(previous,match.meters);
    }
    points.push({ meters:previous, elapsedSeconds:b.elapsedSeconds });
  }
  if (validLength / selected.distanceMeters < .95 || target-previous > OUTER_RADIUS) return null;
  points.at(-1).meters=target;
  return compress(points);
}

export function matchRecordedGhost(course, recordedCourse) {
  if (course.distanceMeters < 60) throw new Error("Choose a climb at least 60 metres long to match a separate recording.");
  if (!recordedCourse?.points?.some(p=>Number.isFinite(p.elapsedSeconds))) throw new Error("Choose a run recording with timestamps.");
  const local = toLocal(course.points[0]), trace = recordedCourse.points.map(local);
  const grid = courseGrid(course,local);
  const starts = visits(trace,grid[0]), ends = visits(trace,grid.at(-1));
  if (starts.length > 12 || ends.length > 12) throw new Error("The recording passes these landmarks repeatedly. Trim it to a single lap.");
  const total = course.distanceMeters;
  const tolerance = Math.max(15,total*.12);
  let result = null;
  for (const a of starts) for (const b of ends) {
    const span=b.meters-a.meters;
    if (span<10 || Math.abs(span-total)>tolerance) continue;
    const points=alignedTrace(course, recordedCourse,a.meters,b.meters,local,grid);
    if (!points) continue;
    if (result) throw new Error("This recording covers the climb more than once. Choose a single recorded lap.");
    result={ id:stableUuid(JSON.stringify([recordedCourse.revision,course.rootRevision,a.meters,b.meters])),
      name:recordedCourse.name, sourceRevision:recordedCourse.revision, points };
  }
  if (!result) throw new Error("The recording must cover this climb from start to crest in the same direction, with a continuous timing trace.");
  return result;
}

export function withRecordedGhost(course, recordedCourse) {
  return attachRecordedGhost(course, matchRecordedGhost(course,recordedCourse));
}
