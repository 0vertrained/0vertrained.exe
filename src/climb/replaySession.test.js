import { afterEach, expect, it, vi } from "vitest";
import { simulateIncline } from "./offlineIncline";
import { DEMO_CHECK, runSessionReplay } from "./replaySession";
import { changeClimbLibrary, readClimbLibrary } from "./library";

const course={name:"Test hill",points:[0,50,100,150].map(meters=>({meters,elevationMeters:meters*.08})),distanceMeters:150};
const check=(samples, markers=[], endedAt=samples.at(-1)?.at??2000)=>({
  version:1,id:"session",physicalMachine:"Test treadmill",transmitter:{name:"Adapter"},startedAt:1000,endedAt,samples,markers
});
const replay=(record, rest={})=>runSessionReplay({course,check:record,...rest});
const samples=Array.from({length:20},(_,s)=>({at:1000+s*1000+.375,segment:0,speedMps:2,distanceMeters:100+s*2,inclinePercent:Math.min(8,2*Math.floor(Math.max(0,s-1)/3))}));

afterEach(()=>{delete window.Capacitor;localStorage.clear();});

it("replays a sustained course from real fractional native timestamps, with confirmed bounded steps and no initial phantom command",async()=>{
  const run=await replay(check(samples));
  expect(run.controller).toBe("Browser");
  expect(run.trackedMeters).toBeCloseTo(38);
  expect(run.estimatedMeters).toBe(0);
  expect(run.acquired).toBe(true);
  expect(run.points[0].requestedGrade).toBe(null);
  expect(run.commands.map(c=>c.grade)).toEqual([2,4,6,8]);
  expect(run.points.at(-1).measuredGrade).toBe(8);
});

it.each(["console","disconnect","background"])("injects %s into an actual armed replay and never renews motor requests after it",async scenario=>{
  const run=await replay(check(samples),{scenario});
  expect(run.faultSkipped).toBe(false);
  expect(run.releaseReason).toBeTruthy();
  expect(run.releasedAt).toEqual(run.faultAt);
  expect(run.afterFaultCommands).toBe(0);
  expect(run.commands.length).toBe(1);
  expect(run.points.at(-1).requestedGrade).toBeNull();
});

it("skips an untestable fault and handles an empty check independently from the labeled example",async()=>{
  const empty=await replay(check([]),{scenario:"console"});
  expect(empty).toMatchObject({commands:[],acquired:false,faultSkipped:true,trackedMeters:0});
  expect((await replay(DEMO_CHECK)).acquired).toBe(true);
});

it("rebases distance after gaps and reconnects and clears missing grade readings",async()=>{
  const data=[...samples.slice(0,3),{at:15300,segment:1,speedMps:2,distanceMeters:9000},{at:16300,segment:1,distanceMeters:9003,inclinePercent:0}];
  const run=await replay(check(data,[{kind:"disconnect",at:4500}]),{startMeters:30});
  expect(run.trackedMeters).toBeCloseTo(7);
  expect(run.points.at(-1).meters).toBeCloseTo(37);
  expect(run.points.find(p=>p.at===14.3)?.measuredGrade).toBeNull();
  expect(run.releasedAt).toBeCloseTo(3.5);
  expect(run.commands).toHaveLength(0);
});

it("uses speed estimates only within recorded periods and stops distance at the crest",async()=>{
  const speedOnly=samples.map(({distanceMeters,...other})=>other);
  const run=await replay(check(speedOnly),{startMeters:140});
  expect(run.trackedMeters).toBeCloseTo(10);
  expect(run.estimatedMeters).toBeCloseTo(10);
  expect(run.releasedAt).not.toBeNull();
});

it("uses the isolated iPhone replay method without accessing live Bluetooth methods",async()=>{
  const replayIncline=vi.fn(async({events,cap,simulateAcknowledgements})=>simulateIncline(events,cap,simulateAcknowledgements));
  const live=vi.fn(()=>{throw new Error("access to live hardware")});
  window.Capacitor={isNativePlatform:()=>true,Plugins:{OTClimb:{replayIncline,status:live,arm:live,scan:live,requestIncline:live,disconnect:live}}};
  const run=await replay(check(samples),{scenario:"background"});
  expect(run.controller).toBe("iPhone");
  expect(replayIncline).toHaveBeenCalledTimes(2);
  expect(live).not.toHaveBeenCalled();
  replayIncline.mockRejectedValue(Object.assign(new Error("Not implemented"),{code:"UNIMPLEMENTED"}));
  expect((await replay(check(samples))).controller).toBe("Browser");
  replayIncline.mockRejectedValue(new Error("Invalid input"));
  await expect(replay(check(samples))).rejects.toThrow("Invalid input");
});

it("restores and removes recordings in the correct local account without modifying workouts",async()=>{
  const record=check(samples);
  await changeClimbLibrary("athlete-a",[["check/session",record],["course/h",{revision:"h"}]]);
  expect((await readClimbLibrary("athlete-b")).checks).toEqual([]);
  expect((await readClimbLibrary("athlete-a")).checks).toEqual([record]);
  await changeClimbLibrary("athlete-a",[["check/session",null]]);
  expect(await readClimbLibrary("athlete-a")).toMatchObject({checks:[],results:[],active:null,courses:[{revision:"h"}]});
});

it("runs the watchdog after the last fractional packet, even when the check stays open for much longer",async()=>{
  const record=check([{at:1200,segment:0,speedMps:2,inclinePercent:0,distanceMeters:10},
    {at:1400,segment:0,speedMps:2,inclinePercent:0,distanceMeters:10.4}],[],40000);
  const run=await replay(record);
  expect(run.releasedAt).toBeGreaterThanOrEqual(5.4);
  expect(run.releasedAt).toBeLessThanOrEqual(5.9);
  expect(run.points.at(-1).measuredGrade).toBeNull();
});

it("reconciles speed-based motion and slow belt counters without dropping or double-counting motion",async()=>{
  const fields=Array.from({length:13},(_,s)=>({at:1000+s*1000,segment:0,speedMps:2,inclinePercent:0,
    ...(s===0||s===12?{distanceMeters:s*2}:{})}));
  const run=await replay(check(fields));
  expect(run.trackedMeters).toBe(24);
  expect(run.estimatedMeters).toBe(0);
  expect(run.points.find(p=>p.at===9)?.meters).toBeGreaterThan(0);
  expect(run.releaseReason||"").not.toMatch(/expired/i);
});
