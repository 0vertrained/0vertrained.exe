import { useId, useMemo } from "react";
import { terrainElevation } from "./terrain";

export const unitMeters = unit => unit === "mi" ? 1609.344 : 1000;
export const distanceText = (meters, unit) => Number.isFinite(meters) ? (meters / unitMeters(unit)).toFixed(2) + " " + unit : "—";
export const gainText = (meters, unit) => Number.isFinite(meters) ? (unit === "mi" ? Math.round(meters * 3.28084) + " ft" : Math.round(meters) + " m") : "Unavailable";
export const clockText = seconds => {
  if (!Number.isFinite(seconds)) return "—";
  const value = Math.max(0, Math.round(seconds));
  return (value >= 3600 ? Math.floor(value / 3600) + ":" : "") +
    String(Math.floor(value / 60) % 60).padStart(value >= 3600 ? 2 : 1, "0") + ":" + String(value % 60).padStart(2, "0");
};
export const gapText = seconds => !Number.isFinite(seconds) ? "—" : Math.round(seconds) === 0 ? "Even" :
  clockText(Math.abs(seconds)) + (seconds > 0 ? " ahead" : " behind");

const width = 680, height = 222;
const pointsAttr = points => points.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

function makeScene(course, profile) {
  const all = course.points;
  const count = Math.min(all.length, 360);
  const points = Array.from({ length: count }, (_, i) => all[Math.round(i * (all.length - 1) / (count - 1))]);
  const origin = points[0], cos = Math.cos(origin.lat * Math.PI / 180);
  const local = points.map(p => {
    const dLon = ((p.lon - origin.lon + 540) % 360) - 180;
    return [dLon * 111195 * cos, (p.lat - origin.lat) * 111195];
  });
  const end = local.at(-1);
  const angle = Math.hypot(...end) > 1 ? Math.atan2(end[1], end[0]) : 0;
  const elevations = points.map(p => !profile && course.terrain ? terrainElevation(course.terrain, p) : p.elevationMeters);
  const xs = [], ys = [], zs = elevations.filter(Number.isFinite);
  const minZ = zs.length ? Math.min(...zs) : 0, zSpan = zs.length ? Math.max(1, Math.max(...zs) - minZ) : 1;
  local.forEach(([x, y]) => {
    xs.push(x * Math.cos(angle) + y * Math.sin(angle));
    ys.push(y * Math.cos(angle) - x * Math.sin(angle));
  });
  const minX = Math.min(...xs), xSpan = Math.max(...xs) - minX || 1, minY = Math.min(...ys), ySpan = Math.max(...ys) - minY;
  const scale = Math.min(558 / xSpan, 132 / (ySpan || 1));
  const place = (x, y, z) => {
    const depth = (y - minY - ySpan / 2) * scale;
    const vertical = Number.isFinite(z) ? (z - minZ) / zSpan : null;
    const base = 163 - depth * .47;
    return [width / 2 + (x - minX - xSpan / 2) * scale + depth * .26, base - (vertical ?? 0) * 62];
  };
  const projected = points.map((p, i) => {
    const vertical = Number.isFinite(elevations[i]) ? (elevations[i] - minZ) / zSpan : null;
    const depth = (ys[i] - minY - ySpan / 2) * scale;
    if (profile) {
      const x = 34 + (width - 68) * p.meters / course.distanceMeters;
      return { d: p.meters, xy: [x, vertical == null ? 163 : 163 - vertical * 118], floor: [x, 187], known: vertical != null };
    }
    const x = width / 2 + (xs[i] - minX - xSpan / 2) * scale + depth * .26;
    const base = 163 - depth * .47;
    return { d: p.meters, xy: [x, base - (vertical ?? 0) * 62], floor: [x, base + 16], known: vertical != null };
  });
  const cells = [];
  if (!profile && (course.terrain || course.source === "sample")) {
    const tile = course.terrain;
    const cols = tile?.columns || 25, rows = tile?.rows || 15;
    const mesh = [];
    for (let j=0;j<rows;j++) {
      mesh[j] = [];
      for (let i=0;i<cols;i++) {
        const u=i/(cols-1), v=j/(rows-1);
        let x,y,z;
        if (tile) {
          const east = (((tile.west + (tile.east-tile.west)*u - origin.lon + 540)%360)-180) * 111195*cos;
          const north = (tile.south+(tile.north-tile.south)*v-origin.lat)*111195;
          x = east*Math.cos(angle)+north*Math.sin(angle); y=north*Math.cos(angle)-east*Math.sin(angle);
          z=tile.heights[j*cols+i];
        } else {
          // The sample is explicitly illustrative. Shape just its surrounding
          // hills; imported courses only receive terrain from a real download.
          x=minX+xSpan*(-.08+1.16*u); y=minY-ySpan*.8+ySpan*2.6*v;
          let near=0, best=Infinity;
          for(let k=0;k<points.length;k++){
            const d=Math.hypot(x-xs[k],y-ys[k]);
            if(d<best){ best=d;near=k; }
          }
          z=points[near].elevationMeters - Math.min(26,best*.14) + Math.min(10,best*.07)*Math.sin(7*u+6*v);
        }
        if (Number.isFinite(z)) mesh[j][i]={xy:place(x,y,z),z};
      }
    }
    for(let j=1;j<rows;j++)for(let i=1;i<cols;i++){
      const vertices=[mesh[j-1][i-1],mesh[j-1][i],mesh[j][i],mesh[j][i-1]];
      if(vertices.some(v=>!v))continue;
      const corners=vertices.map(v=>v.xy);
      const tint=Math.max(11,Math.min(41,24+2*(vertices[0].z-vertices[2].z)));
      cells.push({polygon:pointsAttr(corners),depth:corners.reduce((sum,c)=>sum+c[1],0),tint});
    }
    cells.sort((a,b)=>a.depth-b.depth);
  }
  return {points:projected,cells};
}

function at(points, meters) {
  if (meters <= 0) return points[0].xy;
  const i = points.findIndex(p => p.d >= meters);
  if (i < 1) return points.at(-1).xy;
  const p = points[i - 1], q = points[i], f = (meters - p.d) / (q.d - p.d || 1);
  return [p.xy[0] + f * (q.xy[0] - p.xy[0]), p.xy[1] + f * (q.xy[1] - p.xy[1])];
}

function Surface({ points, cells, profile, fillId }) {
  const faces = [];
  // Preserve breaks where the file has no elevation observations. A course
  // ribbon only depicts its centerline and never invents surrounding terrain.
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i];
    if (p.known && q.known) faces.push(<polygon key={i} points={pointsAttr([p.xy, q.xy, q.floor, p.floor])} fill={"url(#" + fillId + ")"} />);
  }
  const line = points.slice(1).map((q, i) => {
    const p = points[i];
    if (profile && (!p.known || !q.known)) return null;
    return <line key={i} x1={p.xy[0]} y1={p.xy[1]} x2={q.xy[0]} y2={q.xy[1]} stroke="var(--ink-2)" strokeWidth="2.5" strokeLinecap="round" />;
  });
  return <g>{cells.map((c,i)=><polygon key={i} points={c.polygon} fill={`color-mix(in srgb,var(--good) ${c.tint}%,var(--sunk))`} stroke="var(--sunk)" strokeOpacity=".6" strokeWidth=".55" />)}{!cells.length && faces}
    {cells.length > 0 && <polyline points={pointsAttr(points.map(p=>p.xy))} fill="none" stroke="var(--surface)" strokeWidth="5.5" strokeLinejoin="round" />}
    {line}</g>;
}

export function ClimbScene({ course, unit, athleteMeters = 0, ghostMeters = null, profile, onProfile, progressLabel, visibleLandmark, selectedRange }) {
  const fillId = useId().replace(/:/g, "");
  const {points,cells} = useMemo(() => makeScene(course, profile), [course, profile]);
  const surface = useMemo(() => <Surface points={points} cells={cells} fillId={fillId} profile={profile} />, [points, cells, fillId, profile]);
  const you = at(points, athleteMeters), ghost = Number.isFinite(ghostMeters) ? at(points, ghostMeters) : null;
  const end = selectedRange ? at(points,selectedRange.end) : points.at(-1).xy;
  const marks = course.landmarks.filter(l => l.meters > 0 && l.meters < course.distanceMeters);
  return <div className="cl-scene">
    <div className="cl-scene-toolbar"><div className="cl-toggle" role="group" aria-label="Course view">
      <button type="button" aria-pressed={!profile} onClick={() => onProfile(false)}>{course.terrain || course.source === "sample" ? "3D terrain" : "Course ribbon"}</button>
      <button type="button" aria-pressed={profile} disabled={!course.hasElevation} onClick={() => onProfile(true)}>Elevation profile</button>
    </div></div>
    <svg className="cl-landscape" viewBox={"0 0 " + width + " " + height} role="img" aria-label={(profile ? "Elevation profile" : cells.length ? "3D terrain" : "Course ribbon") + " of " + course.name + ". Runner at " + distanceText(athleteMeters, unit)}>
      <defs><linearGradient id={fillId} x2="0" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stopColor="var(--good)" stopOpacity=".32" /><stop offset="100%" stopColor="var(--good)" stopOpacity=".07" />
      </linearGradient></defs>
      {[72, 111, 150, 189].map(y => <line key={y} x1="22" x2="658" y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 6" />)}
      {surface}
      {selectedRange && <polyline points={pointsAttr([at(points,selectedRange.start),...points.filter(p=>p.d>selectedRange.start&&p.d<selectedRange.end).map(p=>p.xy),end])}
        stroke="var(--good)" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {marks.map(l => { const [x, y] = at(points, l.meters); return <circle key={l.id} cx={x} cy={y} r={visibleLandmark === l.id ? 5 : 2.5} fill="var(--surface)" stroke="var(--ink-2)"><title>{l.name}</title></circle>; })}
      <g transform={`translate(${end[0]},${end[1]})`} stroke="var(--ink)"><line y2="-20" strokeWidth="2"/><path d="M0 -20 L13 -17 L0 -12Z" fill="var(--ink)" /></g>
      {ghost && <path d={`M${ghost[0]} ${ghost[1]-8}l8 8 -8 8 -8 -8z`} fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.5"/>}
      <circle cx={you[0]} cy={you[1]} r="5.5" fill="var(--good)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
    <div className="cl-legend"><span><i className="cl-dot" /> {progressLabel || "You"}</span>{ghost && <span><i className="cl-diamond" /> Reference</span>}
      <span className="cl-axis-end">{distanceText(selectedRange ? selectedRange.end-selectedRange.start : course.distanceMeters, unit)} · {selectedRange ? "Selected section" : "Crest"}</span></div>
    {course.terrain && <p className="cl-credit">Terrain · <a href={course.terrain.url} target="_blank" rel="noreferrer">{course.terrain.provider}</a> · vertical relief exaggerated</p>}
  </div>;
}
