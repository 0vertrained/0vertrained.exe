import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyRaceBuild } from "../raceBuild";
import { ROAD_TRAIL_HYBRID, startRoadTrailHybrid } from "../plans/roadTrailHybrid";
import { SessionSchedule } from "../MoveSession";
import { buildTrainWeek } from "../TrainTab";

afterEach(cleanup);
it("previews both dates, keeps the pending change on a failed save, and lets the athlete undo", async () => {
  const todayKey = "2026-11-27";
  const original = startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, todayKey);
  const data = { [todayKey]: { workout: { sessionState: { am: { status: "complete" } } } } };
  const saved = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  function Harness() {
    const [program, store] = useState(original);
    const week = buildTrainWeek({ program: applyRaceBuild(program, todayKey), entries: data, todayKey });
    return <SessionSchedule program={program} entries={data} week={week} todayKey={todayKey}
      onSaveProgram={async (next) => { if (!await saved(next)) return false; store(next); return true; }} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Move or skip a session" }));
  let sheet = within(screen.getByRole("dialog"));
  expect(sheet.getByRole("button", { name: /AM · Upper bodybuilding/ }).disabled).toBe(true);
  fireEvent.click(sheet.getByRole("button", { name: /Fri.*PM/ }));
  const preview = sheet.getByText(/after this move/);
  expect(preview.textContent).toMatch(/Sat.*07:00 Long trail run.*17:30/);
  expect(sheet.getByText(/after this change/).textContent).toMatch(/AM.*Upper bodybuilding/);
  fireEvent.click(sheet.getByRole("button", { name: "Move this session" }));
  expect(await sheet.findByRole("alert")).toBeTruthy();
  fireEvent.click(sheet.getByRole("button", { name: "Move this session" }));
  await screen.findByRole("button", { name: "Move or skip a session" });
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Move or skip a session" }));
  sheet = within(screen.getByRole("dialog"));
  fireEvent.click(sheet.getByRole("button", { name: /^Undo / }));
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(3));
  expect(saved.mock.lastCall[0]).toEqual(original);
});
