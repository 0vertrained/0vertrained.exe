import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ClimbWorkout } from "./ClimbWorkout";
import { SAMPLE_COURSE, startClimb } from "./engine";
import { workoutReplayCheck } from "./workoutCapture";

afterEach(()=>{cleanup();vi.restoreAllMocks();});

it("attaches telemetry to the existing timed workout writes, retaining a grade-only packet until the next journal commit",async()=>{
  const start=Date.now()-10_000;
  const run=startClimb(SAMPLE_COURSE,{owner:"athlete",now:start});
  const writes=vi.fn(), saved=vi.fn(async()=>true);
  function Harness({packet}) {
    const [active,setActive]=useState({course:SAMPLE_COURSE,run,dateKey:"2026-11-27",source:"belt",phase:"climb"});
    return <ClimbWorkout active={active} onUpdateActive={async value=>{writes(value);setActive(value);return true;}} onSaveResult={saved} onSaved={()=>{}}
      unit="km" profile={true} onProfile={()=>{}} treadmill={packet}/>;
  }
  const first={status:"connected",fresh:true,connectionId:"link",deviceName:"FitSwitch",distanceMeters:100,speedMps:2,inclinePercent:1,distanceAt:start+3000,speedAt:start+3000,inclineAt:start+3000,sampleAt:start+3000};
  const view=render(<Harness packet={first}/>);
  await waitFor(()=>expect(writes).toHaveBeenCalled());
  const next={...first,distanceAt:start+5000,speedAt:start+5000,sampleAt:start+5000,distanceMeters:104};view.rerender(<Harness packet={next}/>);
  await waitFor(()=>expect(writes.mock.calls.at(-1)[0].run.distanceMeters).toBe(4));
  const count=writes.mock.calls.length;
  view.rerender(<Harness packet={{...next,inclineAt:start+6000,inclinePercent:3.5}}/>);
  expect(writes).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole("button",{name:"Finish early"}));fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button",{name:"Finish here"}));
  fireEvent.click(await screen.findByRole("button",{name:"Save climb"}));await waitFor(()=>expect(saved).toHaveBeenCalled());
  expect(workoutReplayCheck(saved.mock.calls[0][0]).samples.at(-1)).toEqual({at:start+6000,phase:"observe",segment:0,inclinePercent:3.5});
});
