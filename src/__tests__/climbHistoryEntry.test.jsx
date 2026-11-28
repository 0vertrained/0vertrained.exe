// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DayDetail } from "../ProgressHistory";

afterEach(()=>{ cleanup(); delete window.Capacitor; });

it("offers the selected day's confirmed outdoor Apple route only after an explicit lookup", async()=>{
  const day="2026-11-27", onRaceClimb=vi.fn(), near={date:day, name:"Run · Fri", id:"original", meters:6540};
  const climbRouteList=vi.fn().mockResolvedValue({runs:[near, near,{...near,date:"2026-11-24",id:"earlier"}]});
  window.Capacitor={isNativePlatform:()=>true,Plugins:{OTRuns:{climbRouteList,climbRoute:vi.fn()}}};
  const data={[day]:{workout:{cardio:{type:"Trail run",modality:"run",time:"42:00",miles:"4"}}}};
  render(<DayDetail owner="a" dateKey={day} data={data} onRaceClimb={onRaceClimb}/>);
  expect(climbRouteList).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Find this day’s outdoor routes"}));
  fireEvent.click(await screen.findByRole("button",{name:"Race this climb"}));
  expect(climbRouteList).toHaveBeenCalledWith({owner:"a",nearDate:day});
  expect(onRaceClimb).toHaveBeenCalledWith({owner:"a",date:day,id:"original",name:"Run · Fri"});
});

it("keeps history usable on the web, for an indoor workout, and while a late route is unavailable", async()=>{
  const day="2026-11-27", data={[day]:{workout:{cardio:{modality:"run",time:"28:00",miles:"3"}}}};
  const view=render(<DayDetail owner="a" dateKey={day} data={data} onRaceClimb={vi.fn()}/>);
  expect(screen.queryByRole("button",{name:/outdoor routes/})).toBeNull();
  const climbRouteList=vi.fn().mockResolvedValueOnce({runs:[]}).mockResolvedValueOnce({runs:[{date:day,id:"late",name:"Hike"}]});
  window.Capacitor={isNativePlatform:()=>true,Plugins:{OTRuns:{climbRouteList,climbRoute:vi.fn()}}};
  const indoor={[day]:{workout:{cardio:{...data[day].workout.cardio,indoor:true}}}};
  view.rerender(<DayDetail owner="a" dateKey={day} data={indoor} onRaceClimb={vi.fn()}/>);
  expect(screen.queryByRole("button",{name:/outdoor routes/})).toBeNull();
  view.rerender(<DayDetail owner="a" dateKey={day} data={data} onRaceClimb={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:/outdoor routes/}));
  await screen.findByText(/no readable outdoor route/);
  fireEvent.click(screen.getByRole("button",{name:"Check routes again"}));
  await screen.findByRole("button",{name:"Race this climb"});
});
