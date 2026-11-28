// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClimbCourse, finishClimb, startClimb, updateClimb } from "../climb/engine";
import { describeTerrainSections } from "../climb/sectionTerrain";
import { ClimbWorkout } from "../climb/ClimbWorkout";
import { SectionTerrain } from "../climb/SectionClimbing";
import { climbHistory, recordClimb } from "../climb/ledger";
import { profileSummary } from "../climb/ascent";

afterEach(cleanup);
const course = {id:"climb",revision:"r",rootRevision:"r",name:"Race climb",distanceMeters:100,hasElevation:true,
  points:[0,20,40,60,80,100].map(meters=>({lat:0,lon:meters/111195,meters,elevationMeters:meters/10})),
  landmarks:[{id:"first",name:"First turn",meters:15},{id:"second",name:"The saddle",meters:40},{id:"crest",name:"Finish",meters:100}]};
const owner="runner", date="2026-11-27";
const begin = (c=course) => startClimb(c,{owner,id:"attempt",recordingId:"recording",now:0,reference:"solo"});
const update = (c,run,time,meters,extra={})=>updateClimb(c,run,{now:time*1000,source:"belt",meters,gradeCap:6,...extra});
const grade = (time,percent)=>({at:time*1000,percent});
const vertical = percent=>Math.max(0,percent)/Math.hypot(100,percent);

describe("section terrain from independent treadmill observations",()=>{
  it("splits intervals at both grade changes and landmarks, applies a cap to cues only, and clips a crest overshoot",()=>{
    let run=update(course,begin(),0,100,{grades:[grade(0,10)]});
    // Exactly 10 m/s. Incorporate a separately timestamped inclination at t=1s.
    run=update(course,run,3,130,{grades:[grade(1,0),grade(3,0)]});
    run=update(course,run,6,160,{grades:[grade(6,5)]});
    run=update(course,run,9,190,{grades:[grade(9,20)]});
    run=update(course,run,12,220,{grades:[grade(11,50)]});
    const [a,b,c] = describeTerrainSections(course,run);
    expect(run.status).toBe("finished");
    expect(run.endedAt).toBe(10000);
    expect([a.targetAscent,b.targetAscent,c.targetAscent]).toEqual([1.5,2.5,6]);
    expect([a.beltMeters,b.beltMeters,c.beltMeters]).toEqual([15,25,60]);
    expect(a.beltAscent).toBeCloseTo(10*vertical(10));
    expect(b.beltAscent).toBe(0);
    expect(c.beltAscent).toBeCloseTo(30*vertical(5)+10*vertical(20));
    expect([a.cappedMeters,b.cappedMeters,c.cappedMeters]).toEqual([15,25,60]);
    expect(a.cueMatchedMeters).toBe(10);
    expect(c.capTargetAscent).toBeCloseTo(3.6);
    expect(run.deckObservedMeters).toBe(100);
    expect(c.comparableBelt).toBe(c.beltAscent);
    expect(c.coverage).toBe(1);
  });

  it("counts only the metres supported by the actual incline timestamps and measured belt counter",()=>{
    let run=update(course,begin(),0,0);
    run=update(course,run,5,50,{grades:[grade(1,10),grade(9,20)]});
    const rows=describeTerrainSections(course,run);
    expect(rows.reduce((n,r)=>n+r.beltMeters,0)).toBe(30);
    expect(rows[2].partial).toBe(true);
    expect(rows[2].reachedMeters).toBe(10);
    run=update(course,run,6,60,{estimated:true,grades:[grade(6,5)]});
    run=update(course,run,7,70,{grades:[grade(7,8)]});
    run=update(course,run,8,80,{measuredDistanceTime:false,grades:[grade(8,8)]});
    expect(describeTerrainSections(course,run).reduce((n,r)=>n+r.beltMeters,0)).toBe(30);
  });

  it("survives resume and retries, excludes resets, long gaps and source handoffs from the grade estimate",()=>{
    let run=update(course,begin(),0,500,{grades:[grade(0,5)]});
    const event=()=>({grades:[grade(2,6)]});
    run=update(course,run,2,520,event());
    const before=JSON.parse(JSON.stringify(run));
    const saved=update(course,before,2,520,event());
    expect(saved.terrainSections).toEqual(before.terrainSections);
    run=update(course,saved,20,535,{discontinuity:true,grades:[grade(20,6)]});
    run=update(course,run,21,1,{rebase:true,grades:[grade(20,6)]});
    run=update(course,run,22,3,{grades:[grade(20,6)]});
    run=update(course,run,23,40,{source:"manual"});
    run=update(course,run,24,1000,{source:"watch"});
    run=update(course,run,25,1010,{source:"watch"});
    run=update(course,run,26,10,{grades:[grade(25,9)]});
    run=update(course,run,27,20,{grades:[grade(25,9)]});
    run=finishClimb(course,run,28000);
    const rows=describeTerrainSections(course,run);
    expect(rows.reduce((n,r)=>n+r.beltMeters,0)).toBe(20);
    expect(rows.reduce((n,r)=>n+r.reachedMeters,0)).toBe(60);
  });

  it("does not invent course ascent across missing elevations or confuse either type of missing value with zero",()=>{
    const sparse={...course,points:course.points.map((p,i)=>({...p,elevationMeters:i===2?null:p.elevationMeters}))};
    let run=update(sparse,begin(sparse),0,0,{grades:[grade(0,0)]});
    for(let t=1;t<=10;t++) run=update(sparse,run,t,t*10,{grades:[grade(t,0)]});
    const rows=describeTerrainSections(sparse,run);
    expect(rows.reduce((n,r)=>n+r.beltMeters,0)).toBe(100);
    expect(rows.reduce((n,r)=>n+r.comparableMeters,0)).toBe(60);
    expect(rows.reduce((n,r)=>n+r.targetAscent,0)).toBe(6);
    expect(rows.reduce((n,r)=>n+r.beltAscent,0)).toBe(0);
    expect(rows[1].profileCoverage).toBeCloseTo(.2);
  });

  it("allocates the same noise-filtered route ascent across the section boundaries",()=>{
    const coords=course.points.map((p,i)=>({...p, elevationMeters:[0,1.5,1,2,3,5][i]}));
    const plan={...course,points:coords};
    const old=finishClimb(plan,update(plan,begin(plan),20,100,{source:"manual"}));
    expect(describeTerrainSections(plan,old).reduce((n,r)=>n+r.targetAscent,0)).toBeCloseTo(5);
    expect(profileSummary(coords).ascent).toBe(5);
    expect(buildClimbCourse({points:coords}).ascentMeters).toBe(5);
  });

  it("restores historical aggregate readings without assigning old incline or a cap to earlier sections",()=>{
    const old={...update(course,begin(),5,20,{source:"manual"}),terrainSections:undefined,deckObservedMeters:10,deckMatchedMeters:5};
    let next=update(course,old,6,10,{grades:[grade(6,10)]});
    next=update(course,next,7,20,{grades:[grade(7,10)]});
    const sections=describeTerrainSections(course,next);
    expect(sections[0].beltMeters).toBe(0);
    expect(sections[0].capProfileMeters).toBe(0);
    expect(sections[1].beltMeters).toBe(10);
    expect(next.deckObservedMeters).toBe(20);
    expect(next.deckMatchedMeters).toBe(15);
    expect(next.legacyDeckTotals.observed).toBe(10);
  });

  it("collects a grade-only radio notification while a prior distance sample is still fresh",async()=>{
    const base=Date.now()-6000, saved=vi.fn();
    const run=startClimb(course,{owner,id:"ui",now:base,reference:"solo"});
    function Mount({packet}) {
      const [active,setActive]=useState({course,run,source:"belt",gradeCap:12,phase:"climb"});
      return <ClimbWorkout active={active} onUpdateActive={next=>{setActive(next);saved(next.run);return true;}}
        unit="km" profile={true} onProfile={()=>{}} treadmill={packet}/>;
    }
    const packet={status:"connected",connectionId:"real-belt",fresh:true,distanceMeters:100,distanceAt:base,sampleAt:base};
    const mounted=render(<Mount packet={packet}/>);
    await waitFor(()=>expect(saved.mock.lastCall[0].sensor?.meters).toBe(100));
    mounted.rerender(<Mount packet={{...packet,inclinePercent:10,inclineAt:base+1000}}/>);
    mounted.rerender(<Mount packet={{...packet,inclinePercent:0,inclineAt:base+2000}}/>);
    mounted.rerender(<Mount packet={{...packet,distanceMeters:130,distanceAt:base+3000,sampleAt:base+3500,
      inclinePercent:0,inclineAt:base+2000}}/>);
    await waitFor(()=>expect(saved.mock.lastCall[0].distanceMeters).toBe(30));
    const rows=describeTerrainSections(course,saved.mock.lastCall[0]);
    expect(rows.reduce((n,r)=>n+r.beltAscent,0)).toBeCloseTo(10*vertical(10));
    expect(rows.reduce((n,r)=>n+r.beltMeters,0)).toBe(20);
  });

  it("syncs summary-only history, highlights a measured flatter climb and repeats the exact attempted range",()=>{
    let run=update(course,begin(),0,0,{grades:[grade(0,0)]});
    for(let t=1;t<=8;t++) run=update(course,run,t,t*10,{grades:[grade(t,0)]});
    run=finishClimb(course,run,9000);
    const workout=recordClimb({notes:"retain"},{course,run,dateKey:date},owner,{});
    expect(workout.notes).toBe("retain");
    const [saved]=climbHistory({[date]:{workout}});
    expect(saved.run.terrainSections).toEqual(run.terrainSections);
    expect(saved.run.sensor).toBeUndefined();
    expect(saved.course.points).toBeUndefined();
    const repeat=vi.fn();
    const view=render(<SectionTerrain course={course} run={saved.run} unit="km" onRepeat={repeat}/>);
    expect(within(screen.getByRole("list",{name:"Section climbing estimates"})).getByText("Finish · partial")).toBeTruthy();
    expect(screen.getAllByText(/0% of course ascent reproduced on the measured portion/)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button",{name:"Practice this climb"}));
    expect(repeat).toHaveBeenCalledWith(40,80);
    view.rerender(<SectionTerrain course={saved.course} run={saved.run} unit="mi" onRepeat={repeat}/>);
    expect(screen.getByText(/belt reproduced 13 ft less/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(describeTerrainSections(saved.course,{...saved.run,terrainSections:undefined})).toEqual([]);
  });
});
