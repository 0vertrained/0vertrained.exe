import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import RaceTheClimb from "./RaceTheClimb";
import { SAMPLE_COURSE, finishClimb, startClimb, updateClimb } from "./engine";

const click = name => fireEvent.click(screen.getByRole("button",{name}));
const edit = (label, value) => fireEvent.change(screen.getByLabelText(label),{target:{value}});

function Mount({initial = null, saved = vi.fn(() => true), scheduled = vi.fn(() => true), added = vi.fn(() => true), ...props}) {
  const [active,setActive] = useState(initial);
  const [courses,setCourses] = useState([]);
  return <RaceTheClimb owner="athlete" courses={courses} active={active} results={[]} onUpdateActive={setActive} onSaveResult={async value=>{
    const success=await saved(value); if(success)setActive(null); return success;
  }}
    onSaveCourse={course => { added(course); setCourses(current => [...current,course]); return true; }} onScheduleCourse={scheduled}
    getScheduleSlots={() => [{id:"pm",label:"PM run"}]} todayKey="2026-11-27" {...props}/>;
}
afterEach(()=>{cleanup();window.localStorage?.clear();vi.useRealTimers()});

it("opens a usable bundled course, previews it separately, and assigns an explicit PM run",async()=>{
  const saved=vi.fn(), scheduled=vi.fn(()=>true);
  render(<Mount saved={saved} scheduled={scheduled}/>);
  expect(screen.getByRole("heading",{name:"Switchback Ridge"})).toBeTruthy();
  click("Play preview"); click("Pause preview");
  expect(saved).not.toHaveBeenCalled();
  edit("Distance units","mi");
  expect(screen.getByRole("img",{name:/3D terrain of Switchback Ridge/}).getAttribute("aria-label")).toMatch(/mi/);
  fireEvent.click(screen.getByText("Schedule as my run"));
  edit("Training slot","pm");click("Schedule climb");
  await screen.findByText("Scheduled for 2026-11-27");
  expect(scheduled).toHaveBeenCalledWith(SAMPLE_COURSE,"2026-11-27",expect.objectContaining({sessionId:"pm",reference:"pacer"}));
});

it("requires a segment choice when importing a multi-segment file and picks a recorded ghost only for complete timing",async()=>{
  const added=vi.fn();
  render(<Mount added={added}/>);
  fireEvent.click(screen.getByText("Add a course"));
  const track=(name,lat,timed)=>'<trk><name>'+name+'</name><trkseg>'+[0,1,2].map(i=>'<trkpt lat="'+(lat+i*.0005)+'" lon="-105"><ele>'+(100+i*5)+'</ele>'+(timed?'<time>2026-11-27T00:0'+i+':00Z</time>':'')+'</trkpt>').join("")+'</trkseg></trk>';
  const file={name:"mountain.gpx",size:1300,text:async()=>'<gpx>'+track("Out",40,false)+track("Return",41,true)+'</gpx>'};
  fireEvent.change(screen.getByLabelText("Import GPX file"),{target:{files:[file]}});
  const selector=await screen.findByLabelText(/Continuous segment/);
  expect(added).not.toHaveBeenCalled();
  fireEvent.change(selector,{target:{value:"1"}});click("Import selected segment");
  await waitFor(()=>expect(added).toHaveBeenCalled());
  expect(added.mock.calls[0][0].hasRecordedGhost).toBe(true);
  expect(screen.getByLabelText("Race against").value).toBe("recorded");
});

it("pairs a separate timed run with the organizer course and schedules that exact ghost revision",async()=>{
  const added=vi.fn(), scheduled=vi.fn(()=>true);
  render(<Mount added={added} scheduled={scheduled}/>);
  fireEvent.click(screen.getByText("Add a course"));
  const importTrack=(name,timed) => {
    const points=Array.from({length:10},(_,i)=>`<trkpt lat="${40+i*.00012}" lon="-105"><ele>${100+i}</ele>${timed?`<time>2026-11-27T00:00:${String(i*4).padStart(2,"0")}Z</time>`:""}</trkpt>`).join("");
    const file={name:`${name}.gpx`,size:1500,text:async()=>`<gpx><trk><name>${name}</name><trkseg>${points}</trkseg></trk></gpx>`};
    fireEvent.change(screen.getByLabelText("Import GPX file"),{target:{files:[file]}});
  };
  importTrack("Race course",false);await screen.findByRole("heading",{name:"Race course"});
  edit("Import as","ghost");importTrack("My trail run",true);
  const ghost=await screen.findByRole("option",{name:"Outdoor ghost · My trail run"});
  expect(ghost.selected).toBe(true);
  const [base,paired]=added.mock.calls.map(([course])=>course);
  expect(base.hasRecordedGhost).toBe(false);
  expect(paired.revision).not.toBe(base.revision);
  fireEvent.click(screen.getByText("Schedule as my run"));click("Schedule climb");
  await waitFor(()=>expect(scheduled).toHaveBeenCalledWith(paired,"2026-11-27",expect.objectContaining({reference:"recorded"})));
});

it("records a real console reading and retries the same persisted attempt after a save error",async()=>{
  const saved=vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  render(<Mount saved={saved}/>);
  click("Start indoor climb");await screen.findByRole("region",{name:"Climb in progress"});
  edit("Distance since climb start (km)","0.05");click("Record console reading");
  click("Take a stop");await screen.findByText(/At a stop/);
  edit("Distance since climb start (km)","0.09");
  expect(screen.getByRole("button",{name:"Record console reading"}).disabled).toBe(true);
  click("Resume distance");click("Finish early");
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button",{name:"Finish here"}));
  await screen.findByRole("region",{name:"Review climb"});click("Save climb");await screen.findByRole("alert");
  click("Save climb");await screen.findByRole("region",{name:"Climb history"});
  expect(saved.mock.calls.map(([v])=>v.run.id)).toEqual([saved.mock.calls[0][0].run.id,saved.mock.calls[0][0].run.id]);
  expect(saved.mock.calls[1][0].run).toMatchObject({owner:"athlete",distanceMeters:50,status:"partial"});
});

it("stops workout time at the last effort when an athlete reopens an unsaved debrief the next day",async()=>{
  const endedAt=Date.now()-86_400_000, startedAt=endedAt-300_000;
  const timed=startClimb(SAMPLE_COURSE,{owner:"athlete",now:startedAt});
  const run=finishClimb(SAMPLE_COURSE,updateClimb(SAMPLE_COURSE,timed,{now:endedAt-1000,source:"manual",meters:400}),endedAt);
  const saved=vi.fn(()=>true);
  render(<Mount initial={{course:SAMPLE_COURSE,run,dateKey:"2026-11-26",phase:"climb",recording:{startedAt,distanceMeters:400}}} saved={saved}/>);
  click("Save climb");await waitFor(()=>expect(saved).toHaveBeenCalled());
  expect(saved.mock.calls[0][0].recording).toMatchObject({startedAt,endedAt,distanceMeters:400});
});

it("keeps a warm-up, two timed efforts and a cooldown in one physical recording",async()=>{
  const saved=vi.fn(()=>true);
  render(<Mount saved={saved}/>);
  click("Warm up first");await screen.findByRole("region",{name:"Warm-up in progress"});
  edit("Warm-up distance (km)","0.1");click("Record console reading");
  await screen.findAllByText("0.10 km");
  click("Start timed climb");await screen.findByRole("region",{name:"Climb in progress"});
  for(const landmark of SAMPLE_COURSE.landmarks) {
    const b=await screen.findByRole("button",{name:new RegExp("^Mark "+landmark.name+" at")});fireEvent.click(b);
  }
  const review=await screen.findByRole("region",{name:"Review climb"});
  fireEvent.click(within(review).getByRole("button",{name:/Creek crossing/}));click("Repeat this section");
  await screen.findByRole("region",{name:"Climb in progress"});click(/^Mark Finish at/);
  await screen.findByRole("region",{name:"Review climb"});click("Start cooldown");
  await screen.findByRole("region",{name:"Cooldown in progress"});
  edit("Cooldown distance (km)","0.2");click("Record console reading");await screen.findByText("0.20 km");
  click("Finish workout and save");await screen.findByRole("region",{name:"Climb history"});
  const final=saved.mock.calls[0][0], first=final.previousAttempts[0];
  expect(first.run.recordingId).toBe(final.run.recordingId);
  expect(first.run.id).not.toBe(final.run.id);
  expect(final.recording.distanceMeters).toBeCloseTo(300 + SAMPLE_COURSE.distanceMeters + SAMPLE_COURSE.landmarks[0].meters, 3);
});

it("recovers cumulative distance from the same Watch after suspension and leaves intermediate split timing unknown",async()=>{
  const saved=vi.fn(()=>true), now=Date.now(), first=startClimb(SAMPLE_COURSE,{owner:"athlete",now:now-120000});
  const base=updateClimb(SAMPLE_COURSE,first,{now:now-110000,source:"watch",meters:80});
  const run=updateClimb(SAMPLE_COURSE,base,{now:now-100000,source:"watch",meters:100});
  const initial={course:SAMPLE_COURSE,run,dateKey:"2026-11-27",source:"watch",lastSample:{t:now-100000,connection:run.recordingId,source:"watch",meters:100,hasCounter:true}};
  render(<Mount saved={saved} initial={initial} watchReading={{connected:true,recordingId:run.recordingId,at:now,meters:330}}/>);
  await screen.findByRole("img",{name:/Runner at 0.25 km/});
  click("Finish early");fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button",{name:"Finish here"}));
  await screen.findByRole("region",{name:"Review climb"});click("Save climb");await waitFor(()=>expect(saved).toHaveBeenCalled());
  expect(saved.mock.calls[0][0].run.marks[0]).toMatchObject({quality:"unknown",elapsedSeconds:null});
});
