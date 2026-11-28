import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Equipment, useTreadmill } from "./ClimbEquipment";
import { TreadmillReport } from "./TreadmillReport";

const found = {mode:"peloton",state:"found",found:1,startedAt:100};
const setupBridge = () => {
  const remove=vi.fn(async()=>{}), belt={scan:vi.fn(async()=>({})),connect:vi.fn(async()=>({})),disconnect:vi.fn(async()=>({})),addListener:vi.fn(async()=>({remove})),status:vi.fn()};
  window.Capacitor={isNativePlatform:()=>true,Plugins:{OTClimb:belt}};
  return belt;
};
const expand=async () => {
  const summary=screen.getByText(/^Treadmill connection/);
  fireEvent.click(summary);
  await waitFor(()=>expect(summary.parentElement.open).toBe(true));
};
const clipboard = fn => Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:fn}});
afterEach(()=>{cleanup();delete window.Capacitor;delete navigator.clipboard;vi.useRealTimers();});

it("offers an explicit Peloton scan and checks only the selected candidate, without turning an empty scan into a compatibility verdict",async()=>{
  const belt=setupBridge();
  const result=render(<Equipment reading={{status:"idle",scan:{mode:"ftms",state:"empty",found:0},devices:[]}}/>);
  await expand();
  await screen.findByText(/An empty scan only describes/);
  expect(belt.scan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Look for Peloton"}));
  await waitFor(()=>expect(belt.scan).toHaveBeenCalledWith({mode:"peloton"}));
  result.rerender(<Equipment reading={{status:"idle",scan:found,devices:[{id:"peripheral-1234",name:"Peloton Tread",discovery:"nameMatch"}]}}/>);
  expect(belt.connect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:/Connect Peloton Tread · 1234.*Matched by name/}));
  await waitFor(()=>expect(belt.connect).toHaveBeenCalledWith({id:"peripheral-1234"}));
});

it("distinguishes feature bits, measured zero and missing data, and ages each observation after disconnect",()=>{
  vi.useFakeTimers();const now=Date.now();
  const report={state:"disconnected",deviceName:"Peloton",inclineTargets:true,modelQualified:false,featureRead:"read",subscription:"subscribed",sampleCount:2,
    advertisedMetrics:{distanceMeters:false,inclinePercent:true,powerWatts:true},metrics:{distanceMeters:{value:0,at:now-2000},powerWatts:{value:100,at:now-1000}}};
  render(<TreadmillReport reading={{scan:found,status:"idle",report}}/>);
  const distance=screen.getByRole("row",{name:/Belt distance/});
  expect(distance.textContent).toContain("Not advertised");expect(distance.textContent).toContain("0 m");expect(distance.textContent).toContain("2 s ago");
  expect(screen.getByRole("row",{name:/Deck incline/}).textContent).toContain("AdvertisedNo reading");
  expect(screen.getByText(/Belt speed/).closest("tr").textContent).toContain("No FTMS flag");
  expect(screen.getByText(/Reconnect to use treadmill distance/)).toBeTruthy();
  expect(screen.queryByRole("button",{name:/Enable auto incline/})).toBeNull();
  act(()=>vi.advanceTimersByTime(4000));expect(distance.textContent).toContain("6 s ago");
});

it("copies a machine-only snapshot with qualification, actual sample ages and no peripheral identifiers or athlete heart rate",async()=>{
  const copied=vi.fn(async()=>{});clipboard(copied);
  const now=Date.now();
  const report={state:"receiving",deviceName:"Tread+",manufacturer:"Maker",model:"T4",firmware:"2.1",serviceFound:true,treadmillDataFound:true,
    subscription:"subscribed",featureRead:"read",speedTargets:true,inclineTargets:true,controlPointFound:true,modelQualified:false,metrics:{heartRateBpm:{value:173,at:now-8000},inclinePercent:{value:2.5,at:now-1000}}};
  render(<TreadmillReport reading={{scan:found,deviceId:"unique-peripheral-id",armToken:"arm-secret",devices:[{name:"Other athlete's Tread"}],report}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Copy compatibility report"}));
  await screen.findByText("Report copied.");
  const text=copied.mock.calls[0][0];
  for(const expected of ["Firmware: 2.1","Incline targets: Advertised","unqualified","Deck incline: Unverified; 2.5 %","Heart rate: Unverified; Signal received"])expect(text).toContain(expected);
  for(const sensitive of ["173 bpm","unique-peripheral-id","arm-secret","Other athlete"])expect(text).not.toContain(sensitive);
});

it("provides selectable text when clipboard access is unavailable and describes an empty scan accurately",async()=>{
  clipboard(vi.fn(async()=>{throw new Error("denied")}));
  render(<TreadmillReport reading={{scan:{mode:"ftms",state:"empty",found:0}}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Copy compatibility report"}));
  const area=await screen.findByRole("textbox",{name:"Select and copy the report"});
  expect(area.readOnly).toBe(true);expect(area.value).toMatch(/No matching machine found in this scan/);expect(area.value).toContain("Candidates: 0");
  expect(area.value).toContain("Incline control could not be checked without a connection.");
});

it("retains legacy regular scanning and presents the native update hint for missing capabilities",async()=>{
  const belt=setupBridge(),screenView=render(<Equipment reading={{status:"idle",devices:[]}}/>);
  await expand();fireEvent.click(screen.getByRole("button",{name:"Find treadmills"}));
  await waitFor(()=>expect(belt.scan).toHaveBeenCalledWith());
  expect(screen.queryByRole("button",{name:"Look for Peloton"})).toBeNull();expect(screen.getByText(/Update the iPhone app for the detailed/)).toBeTruthy();
  delete window.Capacitor;screenView.rerender(<Equipment reading={null}/>);
  expect(screen.getByText(/Open the updated 0vertrained iPhone app/)).toBeTruthy();
});

it("ignores an old status response that arrives after a newer stream event",async()=>{
  const belt=setupBridge();let resolveStatus;
  belt.status.mockReturnValue(new Promise(resolve=>{resolveStatus=resolve}));
  const hook=renderHook(useTreadmill);
  const newer={status:"connected",report:{sampleCount:1}};
  act(()=>belt.addListener.mock.calls[0][1](newer));
  await act(async()=>resolveStatus({status:"idle"}));
  expect(hook.result.current).toBe(newer);
  hook.unmount();
  expect(belt.disconnect).toHaveBeenCalledWith({forget:true});
});

it.each([
  [{serviceFound:false},"No standard incline control reported by this connection."],
  [{serviceFound:true,inclineTargets:false,controlPointFound:true},"No standard incline control reported by this connection."],
  [{inclineTargets:true,controlPointFound:true,controlPointWritable:true,controlPointIndicates:true},"Advertises standard incline control. Physical response was not tested."],
  [{inclineTargets:true,controlPointFound:true,controlPointWritable:false},"Advertises incline targets, but no usable control point was found."],
  [{inclineTargets:true,controlPointFound:true},"Standard incline control has not been determined."],
  [{controlPointFound:false,featureRead:"failed"},"No usable standard incline control point was found on this connection."],
  [{},"Standard incline control has not been determined."],
])("uses field evidence to explain incline control and includes that same conclusion in the report",async(flags,verdict)=>{
  const copied=vi.fn(async()=>{});clipboard(copied);
  const report={...flags,state:"checking",metrics:{inclinePercent:{value:4.5,at:Date.now()}}};
  render(<TreadmillReport reading={{scan:found,report}}/>);
  const summary=screen.getByText("Incline control",{selector:"strong"}).parentElement;
  expect(summary.textContent).toContain(verdict);
  fireEvent.click(screen.getByRole("button",{name:"Copy compatibility report"}));
  await waitFor(()=>expect(copied.mock.calls[0][0]).toContain(verdict));
});

it("shows the last packet age even if that frame carried no valid values and keeps a denied Bluetooth explanation in a copied scan",async()=>{
  const now=Date.now(),report={state:"checking",sampleCount:1,lastSampleAt:now-15_000,metrics:{}};
  const view=render(<TreadmillReport reading={{scan:found,report}}/>);
  expect(screen.getByText("Last valid data packet · 15 s ago")).toBeTruthy();
  expect(screen.getAllByText("No reading")).toHaveLength(3);
  const copied=vi.fn(async()=>{});clipboard(copied);
  view.rerender(<TreadmillReport reading={{scan:{mode:"peloton",state:"unavailable",found:0},message:"Allow Bluetooth access for 0vertrained in Settings."}}/>);
  expect(screen.queryByText(/empty scan only describes/)).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Copy compatibility report"}));
  await waitFor(()=>expect(copied.mock.calls[0][0]).toContain("Allow Bluetooth access for 0vertrained in Settings."));
});

it("shows speed and cumulative distance in the athlete’s selected units",()=>{
  const at=Date.now(),report={metrics:{speedMps:{value:1609.344/600,at},distanceMeters:{value:1609.344,at}}};
  const view=render(<TreadmillReport distanceUnit="mi" reading={{scan:found,report}}/>);
  expect(screen.getByText("6 mph")).toBeTruthy();expect(screen.getByText("1 mi")).toBeTruthy();
  view.rerender(<TreadmillReport distanceUnit="km" reading={{scan:found,report}}/>);
  expect(screen.getByText("9.66 km/h")).toBeTruthy();
});
