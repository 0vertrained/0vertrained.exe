// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildClimbCourse, buildIndoorGhost, climbReadout, finishClimb, gradeAt, importClimbGpx, listClimbGpxSegments,
  SAMPLE_COURSE, selectClimb, startClimb, updateClimb } from "../climb/engine";

const baseTime = Date.parse("2026-04-18T12:00:00Z");
const xml = '<gpx xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="40" lon="-104.9995"><name>Creek</name></wpt><trk><name>My race</name><trkseg>' +
  '<trkpt lat="40" lon="-105"><ele>1000</ele><time>2026-04-18T12:00:00Z</time></trkpt>' +
  '<trkpt lat="40" lon="-104.999"><ele>1005</ele><time>2026-04-18T12:00:40Z</time></trkpt>' +
  '<trkpt lat="40" lon="-104.999"><ele>1005</ele><time>2026-04-18T12:01:00Z</time></trkpt>' +
  '<trkpt lat="40" lon="-104.998"><ele>1010</ele><time>2026-04-18T12:01:40Z</time></trkpt></trkseg>' +
  '<trkseg><trkpt lat="40" lon="-100"/><trkpt lat="40" lon="-99.99"/></trkseg></trk></gpx>';
const begin = (course, spec={}) => startClimb(course, { owner: "athlete", id: "run", now: baseTime, ...spec });
const update = (c,s,t,meters,source="belt",extra={})=>updateClimb(c,s,{now:baseTime+t*1000,meters,source,...extra});

describe("versioned climb courses and references",()=>{
  it("includes a complete first-run course with terrain, landmarks and an explicitly synthetic pacer",()=>{
    expect(SAMPLE_COURSE.source).toBe("sample");
    expect(SAMPLE_COURSE.distanceMeters).toBeGreaterThan(500);
    expect(SAMPLE_COURSE.ascentMeters).toBeGreaterThan(50);
    expect(SAMPLE_COURSE.hasRecordedGhost).toBe(false);
    expect(SAMPLE_COURSE.landmarks.at(-1).meters).toBe(SAMPLE_COURSE.distanceMeters);
    expect(begin(SAMPLE_COURSE).reference).toBe("pacer");
    expect(()=>begin(SAMPLE_COURSE,{reference:"recorded"})).toThrow(/timestamps/);
  });
  it("imports continuous segments separately, snaps off-vertex waypoints, preserves elevations, timing and dwell",()=>{
    expect(listClimbGpxSegments(xml).map(s=>s.pointCount)).toEqual([4,2]);
    const course=importClimbGpx(xml);
    expect(course.name).toContain("My race");
    expect(course.distanceMeters).toBeCloseTo(170.36,0);
    expect(course.landmarks[0].name).toBe("Creek");
    expect(course.landmarks[0].meters).toBeCloseTo(course.distanceMeters/4,3);
    expect(course.ascentMeters).toBeCloseTo(10);
    expect(course.hasRecordedGhost).toBe(true);
    const halted=climbReadout(course,begin(course),baseTime+50_000);
    expect(halted.ghostMeters).toBeCloseTo(course.points[1].meters);
    const other=importClimbGpx(xml,{segmentIndex:1});
    expect(other.hasRecordedGhost).toBe(false);expect(other.hasElevation).toBe(false);expect(other.revision).not.toBe(course.revision);
  });
  it("pins selected section identity, re-anchors arrival times, retains station dwell and leaves original untouched",()=>{
    const course=importClimbGpx(xml);
    const sub=selectClimb(course,{startMeters:course.points[1].meters,endMeters:course.distanceMeters});
    expect(sub.startMeters).toBe(course.points[1].meters);
    expect(sub.rootRevision).toBe(course.revision);
    expect(sub.revision).not.toBe(course.revision);
    expect(sub.points.map(p=>p.elapsedSeconds)).toEqual([0,20,60]);
    expect(sub.points[0].meters).toBe(0);
    expect(course.points.map(p=>p.elapsedSeconds)).toEqual([0,40,60,100]);
    expect(selectClimb(course)).toBe(course);
    expect(selectClimb(course,{startMeters:20,endMeters:70}).revision).toBe(selectClimb(importClimbGpx(xml),{startMeters:20,endMeters:70}).revision);
  });
  it("does not manufacture timestamps from route-only GPX, a large moving gap, or reversed times",()=>{
    const raw=xml.replace("12:01:40","13:01:40");
    expect(importClimbGpx(raw).hasRecordedGhost).toBe(false);
    expect(importClimbGpx(xml.replace("12:01:40","12:00:01")).hasRecordedGhost).toBe(false);
    expect(importClimbGpx('<gpx><rte><rtept lat="1" lon="2"/><rtept lat="1" lon="2.002"/></rte></gpx>').points[1].elevationMeters).toBeNull();
    for(const invalid of ['<gpx', '<!DOCTYPE gpx><gpx/>','<gpx><trk/></gpx>','<gpx><rte><rtept lat="0"/><rtept lat="1" lon="2"/></rte></gpx>'])
      expect(()=>importClimbGpx(invalid)).toThrow();
  });
  it("suppresses grade for sparse elevations, improbable spikes and missing values without losing geometry",()=>{
    const good=importClimbGpx(xml);
    expect(gradeAt(good,45)).toBeCloseTo(5.87,1);
    expect(gradeAt(importClimbGpx(xml.replace("<ele>1005</ele>","")),70)).toBeNull();
    expect(gradeAt(importClimbGpx(xml.replace("<ele>1005</ele>","<ele>1555</ele>")),70)).toBeNull();
    expect(gradeAt(buildClimbCourse({points:[{lat:0,lon:0,elevationMeters:10},{lat:0,lon:1,elevationMeters:11}]}),300)).toBeNull();
  });
});

describe("single-owner indoor climb timing",()=>{
  const course=importClimbGpx(xml);
  it("awards the same crossings for one-second and five-second inputs",()=>{
    const runBy=step=>{
      let state=update(course,begin(course),0,39);
      for(let t=step;t<=100;t+=step) state=update(course,state,t,39+t*2);
      return state;
    };
    const fast=runBy(1), slow=runBy(5);
    expect(fast.status).toBe("finished");
    expect(fast.endedAt).toBeCloseTo(baseTime+course.distanceMeters*500,2);
    expect(fast.marks[0].elapsedSeconds).toBeCloseTo(course.landmarks[0].meters/2);
    expect(fast.marks.at(-1).sectionGainSeconds).toBeCloseTo(fast.marks.at(-1).gapSeconds-fast.marks[0].gapSeconds);
    expect(slow.marks.at(-1).elapsedSeconds).toBeCloseTo(fast.marks.at(-1).elapsedSeconds);
    expect(fast.verifiedMeters).toBeCloseTo(course.distanceMeters);
    const indoor=buildIndoorGhost(course,fast);
    expect(indoor).toBeTruthy();
    expect(begin(course,{reference:"indoor",indoorGhost:indoor}).reference).toBe("indoor");
    expect(buildIndoorGhost(selectClimb(course,{endMeters:100}),fast)).toBeNull();
    expect(finishClimb(course,fast,baseTime+200000)).toBe(fast);
  });
  it("keeps the elapsed clock running at aid, ignores stale events, rebases resets and source switches",()=>{
    let state=begin(course);
    state=update(course,state,0,537);state=update(course,state,5,547);
    expect(state.distanceMeters).toBe(10);
    state=update(course,state,10,547);
    expect(state.distanceMeters).toBe(10);
    expect(climbReadout(course,state,baseTime+12_000).elapsedSeconds).toBe(12);
    expect(update(course,state,9,1000)).toBe(state);
    state=update(course,state,15,1);state=update(course,state,16,3);
    expect(state.distanceMeters).toBe(12);
    state=update(course,state,17,302,"watch");state=update(course,state,20,307,"watch");
    expect(state.distanceMeters).toBe(17);
    expect(state.estimated).toBe(true);
    state=finishClimb(course,state,baseTime+21_000);
    expect(state.status).toBe("partial");
    expect(climbReadout(course,state,baseTime+90_000).elapsedSeconds).toBe(21);
    expect(buildIndoorGhost(course,state)).toBeNull();
  });
  it("does not give invented split times across unknown distance or dense ghost credit for sparse manual logs",()=>{
    let state=update(course,begin(course),0,100);
    state=update(course,state,60,200);
    expect(state.distanceMeters).toBe(100);
    expect(state.marks[0]).toMatchObject({quality:"unknown",elapsedSeconds:null,gapSeconds:null});
    state=update(course,state,90,course.distanceMeters,"manual");
    expect(state.marks.at(-1).quality).toBe("measured");
    expect(state.status).toBe("finished");
    expect(buildIndoorGhost(course,state)).toBeNull();
    expect(state.marks.at(-1).sectionGainSeconds).toBeNull();
    const overshoot=update(course,begin(course),120,course.distanceMeters+80,"manual");
    expect(overshoot.marks.at(-1).elapsedSeconds).toBeNull();
    expect(climbReadout(course,overshoot,baseTime+120_000).gapSeconds).toBeNull();
  });
});

it("filters small alternating elevation noise while preserving a sustained rise",()=>{
  const flat=Array.from({length:41},(_,i)=>({lat:40,lon:-105+i*.0002,elevationMeters:1000+i%2}));
  expect(buildClimbCourse({points:flat}).ascentMeters).toBe(0);
  expect(buildClimbCourse({points:flat.map((p,i)=>({...p,elevationMeters:1000+i*.25}))}).ascentMeters).toBe(10);
});

it("rejects impossible counter spikes, then accepts a good reading on the existing baseline",()=>{
  const c=SAMPLE_COURSE,initial=update(c,begin(c),0,100);
  expect(update(c,initial,1,100000)).toBe(initial);
  expect(update(c,initial,2,104).distanceMeters).toBe(4);
});
