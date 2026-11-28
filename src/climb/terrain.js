import { stableUuid } from "../stableUuid";
import { attachClimbTerrain } from "./course";

const endpoint = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
const MAX_DIMENSION = 31;
const METRES_PER_DEGREE = 111_195;
// Broad coverage envelopes only. Missing 3DEP samples inside an envelope remain
// explicit holes. No information leaves the device until the athlete downloads.
const regions = [[-125, 24, -66, 50], [-180, 51, -129, 72], [-161, 18, -154, 23],
  [-68, 17, -64, 19], [143, 12, 146, 22], [-172, -15, -168, -10]];

export function courseTerrainGrid(course) {
  if (course.source === "sample") throw new Error("The sample ridge uses an illustrative landscape. Choose an imported course for real terrain.");
  let west = Infinity, east = -Infinity, north = -Infinity, south = Infinity;
  for (const { lat, lon } of course.points) {
    west = Math.min(west,lon); east = Math.max(east,lon);
    north = Math.max(north,lat); south = Math.min(south,lat);
  }
  if (!regions.some(([w,s,e,n]) => west >= w && east <= e && south >= s && north <= n)) {
    throw new Error("USGS terrain is unavailable in this area. Your course ribbon is still available.");
  }
  const xScale = METRES_PER_DEGREE * Math.cos((south + north) * Math.PI / 360);
  const span = Math.max((east - west) * xScale, (north - south) * METRES_PER_DEGREE);
  if (span > 35_000) throw new Error("Select a climb less than 35 km across before downloading terrain.");
  const margin = Math.min(650, Math.max(130, span * .08));
  west -= margin / xScale; east += margin / xScale;
  south -= margin / METRES_PER_DEGREE; north += margin / METRES_PER_DEGREE;
  const width = (east - west) * xScale, height = (north - south) * METRES_PER_DEGREE;
  const spacing = Math.max(20, Math.max(width,height)/(MAX_DIMENSION - 1));
  const columns = Math.min(MAX_DIMENSION, Math.max(4, Math.ceil(width/spacing) + 1));
  const rows = Math.min(MAX_DIMENSION, Math.max(4, Math.ceil(height/spacing) + 1));
  return {west, south, east, north, columns, rows, spacingMeters: Math.max(width/(columns-1),height/(rows-1))};
}

function gridPoints(g) {
  const points = [];
  for (let row = 0; row < g.rows; row++) {
    const lat = g.south + row * (g.north - g.south) / (g.rows - 1);
    for (let col = 0; col < g.columns; col++) {
      const lon = g.west + col * (g.east - g.west) / (g.columns - 1);
      points.push([Number(lon.toFixed(7)), Number(lat.toFixed(7))]);
    }
  }
  return points;
}

export function terrainElevation(grid, {lat, lon}) {
  const x = (lon - grid.west) / (grid.east - grid.west) * (grid.columns - 1);
  const y = (lat - grid.south) / (grid.north - grid.south) * (grid.rows - 1);
  if (x<0 || x>grid.columns-1 || y<0 || y>grid.rows-1) return null;
  const col = Math.min(Math.floor(x), grid.columns-2), row = Math.min(Math.floor(y), grid.rows-2);
  const i = row*grid.columns + col, fx = x-col, fy = y-row;
  const corners = [[i,(1-fx)*(1-fy)], [i+1,fx*(1-fy)], [i+grid.columns,(1-fx)*fy], [i+grid.columns+1,fx*fy]];
  let z = 0;
  for (const [index,weight] of corners) {
    if (weight === 0) continue;
    if (!Number.isFinite(grid.heights[index])) return null;
    z += weight * grid.heights[index];
  }
  return Math.round(z * 10) / 10;
}

// Only the regular sampling grid (bounding area) is submitted to USGS. Track
// samples, the athlete's ID, their clock, and their source filename stay local.
export async function downloadClimbTerrain(course, {signal} = {}) {
  const grid = courseTerrainGrid(course);
  const locations = gridPoints(grid);
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: locations, spatialReference:{wkid:4326} }),
    f:"json", geometryType:"esriGeometryMultipoint", returnFirstValueOnly:"true", interpolation:"RSP_Bilinear",
    outFields:""
  });
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort",abort,{once:true});
  const timeout = setTimeout(abort,25_000);
  let response;
  try {
    const http = await fetch(endpoint,{method:"POST", body, signal:controller.signal, credentials:"omit", referrerPolicy:"no-referrer"});
    if (!http.ok) throw new Error("Terrain service unavailable.");
    response = await http.json();
  } catch {
    throw new Error("The terrain download did not finish. Keep the course ribbon or retry when online.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort",abort);
  }
  if (response?.error || !Array.isArray(response?.samples)) throw new Error("USGS could not provide terrain for this area. Your course is still available.");
  const heights = Array(locations.length).fill(null);
  for (const sample of response.samples) {
    const index = sample?.locationId;
    if (!Number.isInteger(index) || index < 0 || index >= locations.length || heights[index] !== null) continue;
    const raw = sample.value;
    const elevation = typeof raw === "number" || (typeof raw === "string" && raw.trim()) ? Number(raw) : NaN;
    if (Number.isFinite(elevation) && elevation >= -500 && elevation <= 9000) heights[index] = Math.round(elevation*10)/10;
  }
  const coverage = heights.filter(Number.isFinite).length / heights.length;
  if (coverage < .5) throw new Error("This area has too few USGS elevation samples. The course ribbon is available.");
  const terrain = {...grid, heights, coverage, provider:"USGS 3DEP", url:"https://www.usgs.gov/3d-elevation-program",
    revision:stableUuid(JSON.stringify([1,grid,heights]))};
  // Wide course packs are appropriate for viewing terrain. Only use a
  // reasonably resolved grid to derive a missing centerline profile.
  const elevations = course.hasElevation || grid.spacingMeters > 120 ? [] : course.points.map(p=>terrainElevation(terrain,p));
  return attachClimbTerrain(course, terrain, elevations);
}
