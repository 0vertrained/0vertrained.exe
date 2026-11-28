import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Equipment } from "./ClimbEquipment";

const epoch=1_800_000_000_000;
const packet=(sequence,at,values)=>({status:"connected",controlStage:"manual",connectionId:"link",deviceId:"secret-id",deviceName:"FitSwitch",scan:{state:"found",found:1},
  report:{deviceName:"FitSwitch",manufacturer:"Bridge Co",model:"Adapter",firmware:"1.2",startedAt:epoch-2000,sampleCount:sequence,lastSampleAt:at,state:"receiving",
    metrics:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value,at}]))}});
function setup(reading,onSaveCheck) {
  const remove=vi.fn(async()=>{}), belt={scan:vi.fn(),connect:vi.fn(),arm:vi.fn(),requestIncline:vi.fn(),disarm:vi.fn(),addListener:vi.fn(async()=>({remove}))};
  window.Capacitor={isNativePlatform:()=>true,Plugins:{OTClimb:belt}};
  render(<Equipment reading={reading} onSaveCheck={onSaveCheck}/>);
  fireEvent.click(screen.getByText(/^Treadmill connection/));fireEvent.click(screen.getByText("Guided Peloton check"));
  return {belt,remove};
}
const click=name=>fireEvent.click(screen.getByRole("button",{name}));
const type=(name,value)=>fireEvent.change(screen.getByLabelText(name),{target:{value}});
afterEach(()=>{cleanup();delete window.Capacitor;vi.restoreAllMocks();});

it("captures a direct native packet burst through a baseline, knob adjustment and observation and retries the same read-only result",async()=>{
  let now=epoch;vi.spyOn(Date,"now").mockImplementation(()=>now);
  const saved=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const {belt,remove}=setup(packet(0,epoch-1,{}),saved);
  expect(belt.addListener).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Start baseline walk"}).disabled).toBe(true);
  type("Physical treadmill name","My Peloton Tread+");click("Start baseline walk");
  await waitFor(()=>expect(belt.addListener).toHaveBeenCalledTimes(1));
  const emit=belt.addListener.mock.calls[0][1];
  const burst=(offset,seq,val)=>{now=epoch+offset;emit(packet(seq,now,val));};
  act(()=>{burst(100,1,{speedMps:1.1,inclinePercent:1});burst(200,2,{distanceMeters:10});burst(400,3,{inclinePercent:1});});
  now=epoch+500;type("New console incline (%) · optional","3");click("Mark manual incline change");
  act(()=>burst(700,4,{inclinePercent:2}));now=epoch+800;click("Begin observation");act(()=>burst(1000,5,{inclinePercent:3}));
  click("Finish check");expect(screen.getByText("Check complete")).toBeTruthy();expect(saved).not.toHaveBeenCalled();
  click("Save machine check");await screen.findByRole("alert");click("Save machine check");await screen.findByText("Machine check saved on this device.");
  const result=saved.mock.calls[0][0];expect(saved.mock.calls[1][0]).toBe(result);
  expect(result).toMatchObject({physicalMachine:"My Peloton Tread+",transmitter:{name:"FitSwitch"},stats:{packets:5,gradeResponse:"changed",responseDelayMs:200}});
  expect(result.samples.map(s=>s.phase)).toEqual(["baseline","baseline","baseline","adjust","observe"]);
  expect(remove).toHaveBeenCalledTimes(1);
  for(const action of [belt.arm,belt.requestIncline,belt.disarm,belt.scan,belt.connect])expect(action).not.toHaveBeenCalled();
});

it("allows a silent/empty scan to be saved as partial, and blocks a read-only check while control is armed",async()=>{
  const saved=vi.fn(async()=>true);
  setup({status:"idle",scan:{state:"empty",found:0}},saved);
  type("Physical treadmill name","Gym treadmill");click("Start baseline walk");click("Pause check");
  expect(screen.getByRole("button",{name:"Mark manual incline change"}).disabled).toBe(true);click("Resume check");
  click("Finish check");expect(screen.getByText("Partial check")).toBeTruthy();click("Save machine check");
  await waitFor(()=>expect(saved).toHaveBeenCalledWith(expect.objectContaining({outcome:"partial",samples:[]})));
  cleanup();
  setup({...packet(0,epoch,{}),controlStage:"armed"},saved);type("Physical treadmill name","Gym treadmill");
  expect(screen.getByRole("button",{name:"Start baseline walk"}).disabled).toBe(true);
});
