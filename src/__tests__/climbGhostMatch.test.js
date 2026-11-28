import { describe, expect, it } from "vitest";
import { buildClimbCourse, climbReadout, selectClimb, startClimb, withRecordedGhost } from "../climb/engine";
import { attachClimbTerrain } from "../climb/course";

const route = [[0,0],[40,0],[80,0],[120,0],[160,0],[160,40],[160,80],[120,80],[80,80],[40,80],[0,80]];
const origin = { lat:35.7, lon:-105.8 };
const trace = (xy, options={}) => buildClimbCourse({
  name: options.name || "Morning trail",
  points: xy.map(([east,north],i)=>({
    lat:origin.lat + north / 111195, lon:origin.lon + east/(111195*Math.cos(origin.lat*Math.PI/180)),
    ...(options.timed && { elapsedSeconds: options.times?.[i] ?? i*15 }),
    elevationMeters: 2000 + i
  }))
});
const course = trace(route,{name:"Race course"});

describe("matching an independent outdoor recording to a published climb",()=>{
  it("matches a continuous forward traversal, removes the warm-up and cooldown, and retains an aid stop",()=>{
    const source = trace([[-40,0],...route.slice(0,5),route[4],...route.slice(5),[-40,80]],{timed:true});
    const matched = withRecordedGhost(course,source);
    expect(matched).toMatchObject({ghostName:source.name,rootRevision:course.revision,hasRecordedGhost:true});
    expect(matched.revision).not.toBe(course.revision);
    expect(matched.points).toBe(course.points);
    expect(course.hasRecordedGhost).toBe(false);
    const run=startClimb(matched,{id:"test",now:0});
    const at = ms => climbReadout(matched,run,ms).ghostMeters;
    expect(at(60000)).toBeCloseTo(course.points[4].meters,0);
    expect(at(73000)).toBeCloseTo(at(60000),5);
    expect(matched.recordedGhost.points.at(-1).elapsedSeconds).toBeCloseTo(165);
    expect(withRecordedGhost(matched,source)).toBe(matched);
    const clipped = selectClimb(JSON.parse(JSON.stringify(matched)),{startMeters:40,endMeters:220});
    expect(clipped.recordedGhost.points[0]).toEqual({meters:0,elapsedSeconds:0});
    expect(clipped.recordedGhost.points.at(-1).meters).toBe(180);
    expect(clipped.recordedGhost.points.at(-1).elapsedSeconds).toBeCloseTo(82.5,0);
    expect(attachClimbTerrain(matched,{revision:"terrain"},[]).recordedGhost).toBe(matched.recordedGhost);
  });
  it("accepts realistic small GPS offsets without changing the physical elevation or checkpoints",()=>{
    const offset = route.map(([east,north],i)=>[east + Math.sin(i)*2,north + Math.cos(i)*2]);
    const matched = withRecordedGhost(course, trace(offset,{timed:true}));
    expect(matched.landmarks).toBe(course.landmarks);
    expect(matched.ascentMeters).toBe(course.ascentMeters);
    expect(matched.recordedGhost.points.at(-1).meters).toBe(course.distanceMeters);
  });
  it("rejects missing time, wrong direction, insufficient coverage and multiple viable laps",()=>{
    expect(()=>withRecordedGhost(course,trace(route))).toThrow(/timestamps/);
    expect(()=>withRecordedGhost(course,trace(route.toReversed(),{timed:true}))).toThrow(/direction/);
    expect(()=>withRecordedGhost(course,trace(route.slice(2),{timed:true}))).toThrow(/direction/);
    const laps = [...route,...route.toReversed().slice(1),...route.slice(1)];
    expect(()=>withRecordedGhost(course,trace(laps,{timed:true}))).toThrow(/single recorded lap/);
  });
  it("rejects a nearby different trail, an unsupported long position gap and an implausible clock",()=>{
    const straight = Array.from({length:21},(_,i)=>[i*30,0]);
    const target = trace(straight);
    const offCourse = straight.map(([east],i)=>[east,Math.sin(i*Math.PI/20)*28]);
    expect(()=>withRecordedGhost(target,trace(offCourse,{timed:true}))).toThrow(/continuous/);
    expect(()=>withRecordedGhost(target,trace(straight.filter((_,i)=>i<5 || i>10),{timed:true}))).toThrow(/continuous/);
    expect(()=>withRecordedGhost(course,trace(route,{timed:true,times:route.map((_,i)=>i*15+(i>5?160:0))}))).toThrow(/continuous/);
  });
});
