import { expect, it } from "vitest";
import { GuidedCheckCapture } from "./guidedCheck";

const start=1_800_000_000_000;
const frame=(sequence, offset, fields={}, overrides={})=>{
  const at=start+offset;
  const metrics=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{value,at}]));
  return {status:"connected",connectionId:"session-A",deviceId:"private-peripheral-id",controlStage:"manual",report:{deviceName:"FitSwitch",model:"Bridge",manufacturer:"Fitness",firmware:"1",startedAt:start-1000,state:"receiving",sampleCount:sequence,lastSampleAt:at,metrics,serviceFound:true,modelQualified:false},...overrides};
};
const feed=(c,seq,t,fields,options)=>c.record(frame(seq,t,fields,options),start+t);

it("stores separate physical and transmitting machine names, frame-only motion signals, exact cadence and a reported post-knob grade change",()=>{
  const c=new GuidedCheckCapture("Peloton Tread+",frame(10,-500,{inclinePercent:6}),start);
  const first=frame(11,200,{inclinePercent:1,distanceMeters:14,speedMps:1.2,heartRateBpm:155});c.record(first,start+204);
  c.record(first,start+300); // a status notification carries the identical previous packet
  const next=frame(12,1200,{speedMps:1.3});next.report.metrics.inclinePercent=first.report.metrics.inclinePercent;c.record(next,start+1201);
  c.nextPhase(start+1300,4);feed(c,13,1500,{inclinePercent:1});
  c.nextPhase(start+1600);feed(c,14,1800,{inclinePercent:3.8});
  const result=c.finish(start+2200);
  expect(result).toMatchObject({physicalMachine:"Peloton Tread+",transmitter:{name:"FitSwitch",model:"Bridge",firmware:"1"},outcome:"completed",stats:{
    packets:4,intervals:3,meanIntervalMs:1600/3,longestGapMs:1000,duplicateSnapshots:1,baselineGrade:1,observedGrade:3.8,gradeResponse:"changed",responseDelayMs:500}});
  expect(result.samples[1]).toEqual({at:start+1200,segment:0,phase:"baseline",speedMps:1.3});
  expect(result.markers.find(m=>m.kind==="adjust")).toMatchObject({at:start+1300,note:"Console set to 4%"});
  expect(JSON.stringify(result)).not.toMatch(/heartRate|private-peripheral-id|session-A/);
});

it("keeps pauses, background, reconnects, missing frames and counter resets out of continuous comparisons",()=>{
  const c=new GuidedCheckCapture("Tread",frame(0,0),start);
  feed(c,1,100,{inclinePercent:1,distanceMeters:20});c.nextPhase(start+120);
  c.setPaused(true,start+300);feed(c,2,400,{inclinePercent:4});c.setPaused(false,start+2000);
  feed(c,3,2100,{inclinePercent:4,distanceMeters:21});
  c.setHidden(true,start+2500);feed(c,4,2700,{inclinePercent:5});c.setHidden(false,start+3000);
  c.record({status:"idle",report:{state:"disconnected"}},start+3500);
  feed(c,1,4000,{distanceMeters:0},{connectionId:"session-B"});feed(c,2,4300,{distanceMeters:1},{connectionId:"session-B"});
  feed(c,5,4800,{distanceMeters:3},{connectionId:"session-B"});feed(c,6,5200,{distanceMeters:0},{connectionId:"session-B"});
  expect(c.result.stats).toMatchObject({missedPackets:2,longestGapMs:500,baselineGrade:1,observedGrade:null,gradeResponse:"unknown"});
  expect(c.result.samples.map(s=>s.at-start)).toEqual([100,2100,4000,4300,4800,5200]);
  expect(c.result.markers.map(m=>m.kind)).toEqual(["baseline","adjust","pause","resume","background","foreground","disconnect","reconnect","gap","reset"]);
  expect(c.result.samples.at(-1).segment).toBeGreaterThan(c.result.samples.at(-2).segment);
});

it("records quiet or missing fields without manufacturing a baseline and separates a long observation gap",()=>{
  const c=new GuidedCheckCapture("Tread",frame(0,0),start);
  feed(c,1,100,{inclinePercent:0});c.nextPhase(start+400);c.nextPhase(start+450);
  feed(c,2,7000,{inclinePercent:6});feed(c,3,7100,{});
  const result=c.finish(start+8000);
  expect(result.stats).toMatchObject({longestGapMs:6900,gradeResponse:"unknown",packets:3});
  expect(result.samples.at(-1)).toEqual({at:start+7100,phase:"observe",segment:1});
  const noSignal=new GuidedCheckCapture("Silent treadmill",{status:"idle",report:{state:"incompatible",deviceName:"Selected adapter",serviceFound:false}},start);
  noSignal.nextPhase(start+10);noSignal.nextPhase(start+50);
  expect(noSignal.finish(start+100)).toMatchObject({outcome:"partial",transmitter:{name:"Selected adapter"},capabilities:{serviceFound:false},samples:[]});
});

it("caps samples and markers and freezes an attempt if an athlete changes transmitters or enables control",()=>{
  const c=new GuidedCheckCapture("A",frame(0,0),start);
  for(let i=1;i<=6010;i++) feed(c,i,i*100,{speedMps:1});
  expect(c.result.samples).toHaveLength(6000);expect(c.result.outcome).toBe("partial");expect(c.result.markers.at(-1).note).toMatch(/limit/);
  const manyMarkers=new GuidedCheckCapture("A",frame(0,0),start);
  for(let i=1;i<=501;i++)manyMarkers.setPaused(i%2===1,start+i);
  expect(manyMarkers.result.markers).toHaveLength(256);
  for(const options of [{deviceId:"another-peripheral"},{controlStage:"armed"}]) {
    const session=new GuidedCheckCapture("A",frame(0,0),start);feed(session,1,100,{distanceMeters:1},options);
    expect(session.finished).toBe(true);expect(session.result.samples).toHaveLength(0);
  }
});

it("uses the packet timestamp to place a delayed notification before an adjustment and skips backward clock jumps",()=>{
  const c=new GuidedCheckCapture("Tread",frame(0,0),start);
  feed(c,1,100,{inclinePercent:1});c.nextPhase(start+500);c.record(frame(2,450,{speedMps:2}),start+580);
  c.record(frame(3,300,{speedMps:2}),start+600);
  c.record(frame(4,400,{speedMps:2}),start+800);
  feed(c,5,900,{speedMps:2});
  expect(c.result.samples.map(s=>[s.at-start,s.phase])).toEqual([[100,"baseline"],[450,"baseline"],[900,"adjust"]]);
});
