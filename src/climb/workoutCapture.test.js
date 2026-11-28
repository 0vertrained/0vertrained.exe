import { expect, it } from "vitest";
import { WorkoutBeltCapture, workoutReplayCheck } from "./workoutCapture";
import { SAMPLE_COURSE, startClimb, updateClimb, finishClimb } from "./engine";
import { recordClimb } from "./ledger";

const base=1_800_000_000_000;
const initial=()=>startClimb(SAMPLE_COURSE,{owner:"a",now:base});
const snapshot=(offset,fields,options={})=>{
  const at=base+offset;
  return {status:"connected",connectionId:"private-link",deviceId:"private-machine",report:{deviceName:"FitSwitch",model:"Bridge",firmware:"1.0",metrics:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,{at,value:v}]))},...options};
};
const end=(run,cap,offset)=>({...finishClimb(SAMPLE_COURSE,run,base+offset),beltReplay:cap.data});
const adapt=run=>workoutReplayCheck({course:SAMPLE_COURSE,run,dateKey:"2027-01-01"});

it("coalesces live belt fields independently while retaining distinct native timestamps and observed zero",()=>{
  const run=initial(), cap=new WorkoutBeltCapture(run);
  cap.record(snapshot(100,{distanceMeters:0,speedMps:0}),base+100);
  const second=snapshot(200,{inclinePercent:0,heartRateBpm:171});second.report.metrics.distanceMeters={value:0,at:base+100};cap.record(second,base+200);
  cap.record(snapshot(500,{distanceMeters:.5,speedMps:1}),base+500);
  cap.record(snapshot(1200,{distanceMeters:2,speedMps:2,inclinePercent:4}),base+1200);
  const check=adapt(end(run,cap,1800));
  expect(check.samples).toEqual([{at:base+100,segment:0,phase:"observe",distanceMeters:0,speedMps:0},{at:base+200,segment:0,phase:"observe",inclinePercent:0},
    {at:base+1200,segment:0,phase:"observe",distanceMeters:2,speedMps:2,inclinePercent:4}]);
  expect(check).toMatchObject({id:"workout-"+run.id,name:"Indoor climb · Switchback Ridge",origin:"workout",physicalMachine:"Physical treadmill unverified",transmitter:{name:"FitSwitch",model:"Bridge"}});
  expect(JSON.stringify(check)).not.toMatch(/private-|heartRateBpm/);
});

it("delimits pause, app restoration, disconnection, missing intervals, counter reset and a different transmitter",()=>{
  const run=initial(), cap=new WorkoutBeltCapture(run);
  const send=(rec,t,v,opt={})=>rec.record(snapshot(t,{distanceMeters:v},opt),base+t);
  send(cap,100,103);cap.interrupt("pause",base+200);cap.interrupt("resume",base+1800);send(cap,2000,180);
  const stored={...run,beltReplay:cap.data}, restored=new WorkoutBeltCapture(stored);
  send(restored,4000,300);restored.record({status:"idle"},base+4100);send(restored,4500,100,{connectionId:"second"});
  send(restored,10000,140,{connectionId:"second"});send(restored,11000,4,{connectionId:"second"});
  send(restored,12000,800,{connectionId:"third",deviceId:"other"});
  const check=adapt(end(stored,restored,15000));
  expect(check.samples.map(s=>s.distanceMeters)).toEqual([103,180,300,100,140,4]);
  expect(check.samples.every((s,i,a)=>i===0||s.segment>a[i-1].segment)).toBe(true);
  expect(check.markers.map(m=>m.kind)).toEqual(["baseline","pause","resume","gap","disconnect","gap","reset","finish"]);
  expect(check.truncated).toBe(true);expect(check.endedAt).toBe(base+11000);expect(check.markers.at(-1).note).toMatch(/transmitter changed/);
});

it("retains only a bounded trace and excludes the block from the account ledger",()=>{
  let run=initial();const cap=new WorkoutBeltCapture(run);
  for(let i=0;i<6002;i++) cap.record(snapshot(i*1000,{distanceMeters:i*3,speedMps:3,inclinePercent:1}),base+i*1000);
  run=updateClimb(SAMPLE_COURSE,run,{now:base+10_000,source:"manual",meters:100});
  const finished=end(run,cap,6_003_000), check=adapt(finished);
  expect(check.samples).toHaveLength(6000);expect(check.truncated).toBe(true);expect(check.markers.at(-1).note).toMatch(/Capture limit/);
  const ledger=recordClimb({}, {course:SAMPLE_COURSE,run:finished,dateKey:"2027-01-01"},"a",{});
  expect(ledger.climbAttempts[run.id].run).not.toHaveProperty("beltReplay");expect(JSON.stringify(ledger)).not.toContain("FitSwitch");
  expect(adapt({...finished,beltReplay:undefined})).toBeNull();
});
