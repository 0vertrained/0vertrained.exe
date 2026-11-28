import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClimbCourse, SAMPLE_COURSE, selectClimb } from "../climb/engine";
import { courseTerrainGrid, downloadClimbTerrain, terrainElevation } from "../climb/terrain";

const points = Array.from({length:21}, (_, i) => ({lat:35.78+i*.00015, lon:-105.85+i*.00011}));
const make = values => buildClimbCourse({name:"Private athlete name",points:points.map((p,i)=>({...p, elevationMeters:values?.[i]}))});

afterEach(()=>vi.unstubAllGlobals());

function mockGrid(sample) {
  return vi.fn(async (url, init) => {
    const coords=JSON.parse(init.body.get("geometry"));
    expect(url).toContain("https://elevation.nationalmap.gov/");
    expect(init.method).toBe("POST");expect(init.credentials).toBe("omit");expect(coords.spatialReference.wkid).toBe(4326);
    expect(init.body.toString()).not.toContain("Private");
    expect(coords.points.length).toBeLessThanOrEqual(961);
    expect(coords.points).not.toEqual(points);
    return {ok:true, json: async () => ({samples: coords.points.map(([x,y],i)=>({ locationId:i, value:sample(x,y,i) })).reverse()})};
  });
}

describe("downloadable geographic terrain",()=>{
  it("sends a bounded regular grid only on demand and retains missing cells and attribution",async()=>{
    const fetch=mockGrid((x,y,i)=>i===2?"NoData":(2000+1000*(y-35.78)).toFixed(3));
    vi.stubGlobal("fetch", fetch);
    const course=make();
    const grid=courseTerrainGrid(course);
    expect(fetch).not.toHaveBeenCalled();expect(grid.rows).toBeLessThanOrEqual(31);
    const enriched=await downloadClimbTerrain(course);
    expect(fetch).toHaveBeenCalledOnce();
    expect(enriched.terrain.heights[2]).toBeNull();
    expect(enriched.terrain.coverage).toBeGreaterThan(.95);
    expect(enriched.terrain.heights[0]).toBeCloseTo(2000+1000*(grid.south-35.78),1);
    expect(enriched.id).toBe(course.id);expect(enriched.revision).not.toBe(course.revision);
    expect(enriched.elevationSource).toBe("USGS 3DEP");expect(enriched.hasElevation).toBe(true);
    expect(enriched.landmarks).toEqual(course.landmarks);
    expect(enriched.points[8].elevationMeters).toBeCloseTo(2000+1000*(points[8].lat-35.78),1);
    expect(course.points.every(p=>p.elevationMeters===null)).toBe(true);
    const sub=selectClimb(enriched,{startMeters:10,endMeters:150});
    expect(sub.terrain).toBe(enriched.terrain);
    expect(sub.elevationSource).toBe("USGS 3DEP");
  });
  it("never replaces an existing GPX profile with an unrelated elevation datum",async()=>{
    vi.stubGlobal("fetch",mockGrid(()=>2400));
    const course=make(points.map((_,i)=>1500+i));
    const result=await downloadClimbTerrain(course);
    expect(result.points).toEqual(course.points);
    expect(result.ascentMeters).toBe(course.ascentMeters);
    expect(terrainElevation(result.terrain, course.points[0])).toBe(2400);
    expect(terrainElevation(result.terrain, {lat:0,lon:0})).toBeNull();
  });
  it("leaves the ribbon available after no coverage, network errors and outside supported geography",async()=>{
    const fetch=mockGrid(()=>null);
    vi.stubGlobal("fetch",fetch);
    const nz=buildClimbCourse({points:[{lat:-41,lon:174},{lat:-41.001,lon:174}]});
    await expect(downloadClimbTerrain(nz)).rejects.toThrow(/unavailable in this area/);
    await expect(downloadClimbTerrain(SAMPLE_COURSE)).rejects.toThrow(/illustrative/);
    expect(fetch).not.toHaveBeenCalled();
    const course=make();
    await expect(downloadClimbTerrain(course)).rejects.toThrow(/too few/);
    fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(downloadClimbTerrain(course)).rejects.toThrow(/retry/);
    expect(course.terrain).toBeUndefined();
  });
  it("suppresses grid interpolation around missing samples and preserves genuine zero elevation",()=>{
    const g={west:0,south:0,east:1,north:1,columns:2,rows:2,heights:[0,10,null,20]};
    expect(terrainElevation(g,{lat:0,lon:0})).toBe(0);
    expect(terrainElevation(g,{lat:0,lon:.5})).toBe(5);
    expect(terrainElevation(g,{lat:.5,lon:.5})).toBeNull();
  });
});
