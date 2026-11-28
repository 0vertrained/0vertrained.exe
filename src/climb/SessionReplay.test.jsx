import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SAMPLE_COURSE } from "./course";
import * as replay from "./replaySession.js";
import { SessionReplay } from "./SessionReplay.jsx";

const open = () => fireEvent.click(screen.getByText("Session replay",{selector:"summary"}));
const change = (label,value) => fireEvent.change(screen.getByLabelText(label),{target:{value}});
const run = () => fireEvent.click(screen.getByRole("button",{name:"Run replay"}));
const check = (id,name,endedAt)=>({...replay.DEMO_CHECK,id,physicalMachine:name,endedAt});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it("runs the synthetic example end to end, converts a selected start in miles, shows live cursor readouts and reports an injected release",async()=>{
  const spy=vi.spyOn(replay,"runSessionReplay");
  const {container}=render(<SessionReplay course={SAMPLE_COURSE} unit="mi"/>);open();
  expect(screen.getByLabelText("Replay recording").selectedOptions[0].textContent).toBe("Demo check");
  change("Course start (mi)","0.1");change("Replay incline cap (%)","8");change("Replay scenario","disconnect");run();
  const outcome=await screen.findByRole("region",{name:"Replay result"});
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({course:SAMPLE_COURSE,check:replay.DEMO_CHECK,scenario:"disconnect",cap:8,startMeters:160.9344}));
  expect(within(outcome).getByText(/no incline commands followed the interruption/i)).toBeTruthy();
  expect(within(outcome).getByText(/control released at/i)).toBeTruthy();
  expect(container.querySelectorAll("svg path[data-signal]")).toHaveLength(3);
  fireEvent.change(screen.getByRole("slider",{name:"Replay time"}),{target:{value:12}});
  expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("0:12");
  expect(within(outcome).getByText(/0:12 · /)).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Delete saved check"})).toBeNull();
});

it("retains the selected real check across courses and ignores a late completion from a superseded run",async()=>{
  const older=check("older","North treadmill",61000), newer=check("newer","South treadmill",70000);
  const props={checks:[older,newer],course:SAMPLE_COURSE,unit:"km"};
  const {rerender}=render(<SessionReplay {...props}/>);open();
  expect(screen.getByLabelText("Replay recording").value).toBe("newer");
  change("Replay recording","older");
  const spy=vi.spyOn(replay,"runSessionReplay");
  let resolve;
  spy.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  run();
  expect(screen.getByRole("button",{name:/running replay/i}).disabled).toBe(true);
  const other={...SAMPLE_COURSE,name:"Other course",revision:"other"};
  rerender(<SessionReplay {...props} course={other}/>);
  expect(screen.getByLabelText("Replay recording").value).toBe("older");
  change("Replay scenario","console");run();
  const fresh=await screen.findByRole("region",{name:"Replay result"});
  expect(within(fresh).getByText(/console override at/i)).toBeTruthy();
  resolve({points:[],commands:[],durationSeconds:1,controller:"Stale controller",trackedMeters:0});
  await waitFor(()=>expect(spy).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Stale controller/)).toBeNull();
});

it("retains statistics from saved empty partial checks and requires confirmation for local deletion",async()=>{
  const partial={id:"partial",outcome:"partial",physicalMachine:"Gym treadmill",transmitter:{name:"Gym bridge"},
    startedAt:1000,endedAt:8000,markers:[{note:"No connection"}],samples:[],stats:{durationMs:7000,packets:0,interruptions:1,missedPackets:0}};
  const onDelete=vi.fn(),confirm=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<SessionReplay course={SAMPLE_COURSE} checks={JSON.parse(JSON.stringify([partial]))} confirm={confirm} onDelete={onDelete}/>);open();
  expect(screen.getByText(/Partial check · 0 captured packets/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"Run replay"}).disabled).toBe(true);
  fireEvent.click(screen.getByText("Saved check details",{selector:"summary"}));
  expect(screen.getByText("0:07")).toBeTruthy();expect(screen.getByText("Gym bridge")).toBeTruthy();expect(screen.getByText("No connection")).toBeTruthy();
  const del=screen.getByRole("button",{name:"Delete saved check"});
  fireEvent.click(del);await waitFor(()=>expect(del.disabled).toBe(false));expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(del);await waitFor(()=>expect(onDelete).toHaveBeenCalledWith("partial"));
});

it("breaks each graph trace at missing readings or a new segment and explains empty feedback",async()=>{
  const samples=[{at:0,segment:0,inclinePercent:2},{at:1000,segment:0,inclinePercent:2},{at:14000,segment:1,inclinePercent:0}];
  const incomplete={id:"gaps",startedAt:0,endedAt:14000,physicalMachine:"Gym",samples,markers:[],outcome:"partial",stats:{packets:3}};
  const {container}=render(<SessionReplay course={SAMPLE_COURSE} checks={[incomplete]}/>);open();change("Replay scenario","background");run();
  await screen.findByRole("region",{name:"Replay result"});
  const path=container.querySelector('[data-signal="measuredGrade"]');
  expect(path.getAttribute("d").match(/M/g)?.length).toBe(2);
  expect(container.querySelector('[data-signal="requestedGrade"]').getAttribute("d")).toBe("");
  expect(screen.getByText(/no eligible point for this interruption/i)).toBeTruthy();
  change("Replay incline cap (%)","20");run();expect(screen.getByRole("alert").textContent).toMatch(/0% to 15%/);
  change("Replay incline cap (%)","4");change("Course start (km)","1000");run();expect(screen.getByRole("alert").textContent).toMatch(/before the end/);
});


it("selects a saved indoor workout by its name, preserves its physical machine details, and only offers deletion for checks",()=>{
  const machine=check("diagnostic","Gym console",61000);
  const workout={...check("workout","Peloton Tread+",62000),origin:"workout",name:"Indoor climb · Big Tesuque"};
  render(<SessionReplay course={SAMPLE_COURSE} checks={[machine,workout]} onDelete={vi.fn()} confirm={vi.fn()}/>);open();
  expect(screen.getByLabelText("Replay recording").selectedOptions[0].textContent).toMatch(/Indoor climb · Big Tesuque/);
  expect(screen.getByText("Workout recording details",{selector:"summary"})).toBeTruthy();
  expect(screen.getByText("Peloton Tread+",{selector:"dd"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Delete saved check"})).toBeNull();
  change("Replay recording","diagnostic");
  expect(screen.getByLabelText("Replay recording").selectedOptions[0].textContent).toMatch(/Machine check · Gym console/);
  expect(screen.getByRole("button",{name:"Delete saved check"})).toBeTruthy();
});
