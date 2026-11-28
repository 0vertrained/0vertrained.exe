// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { presetProgram } from "../constants";
import { RoadTrailBlock } from "../ProgramScreen";
import { RacePlanPanel } from "../RacePlanPanel";
import { describeRoadTrailWeek, startRoadTrailHybrid } from "../plans/roadTrailHybrid";

const todayKey = "2026-11-27";
const race = {
  kind: "runPlan", raceName: "Winter trail race", distance: "10k", startDate: todayKey, raceDate: "2027-01-31",
  runsPerWeek: 4, longRunDay: "Sunday", qualityDay: "Tuesday", startLongRunMin: 35, benchmarkTest: "none",
};
const initial = { ...startRoadTrailHybrid(presetProgram("roadTrailHybrid"), todayKey), __raceBuild: race };
const block = (program, onSaveProgram, entries, dateKey = todayKey) => <RoadTrailBlock program={program} entries={entries} week={describeRoadTrailWeek(program, dateKey)}
  todayKey={dateKey} onSaveProgram={onSaveProgram} />;
const openPreview = () => fireEvent.click(screen.getByRole("button", { name: "Align lifting to this race" }));
const review = () => within(screen.getByRole("dialog", { name: "Preview lifting changes" }));
afterEach(cleanup);

describe("hybrid lifting taper preview", () => {
  it("shows current and proposed dates, expands all changes, and saves only after acceptance", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    function Harness() {
      const [program, setProgram] = useState(initial);
      return block(program, async (candidate, options) => {
        const ok = await save(candidate, options);
        if (ok) setProgram(candidate);
        return ok;
      });
    }
    render(<Harness />);
    openPreview();
    expect(review().getByText(/Current taper target · Sat, Jan 16/)).toBeTruthy();
    expect(review().getByText(/Winter trail race · Sun, Jan 31/)).toBeTruthy();
    const changes = review().getByRole("list", { name: "Training days that would change" });
    expect(changes.children).toHaveLength(3);
    fireEvent.click(review().getByRole("button", { name: /Show all \d+ days/ }));
    expect(changes.children.length).toBeGreaterThan(3);
    const exerciseDetails = review().getAllByText("Exercise changes")[0].closest("details");
    fireEvent.click(within(exerciseDetails).getByText("Exercise changes"));
    expect(exerciseDetails.open).toBe(true);
    expect(within(exerciseDetails).getAllByRole("listitem").length).toBeGreaterThan(0);
    fireEvent.click(review().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).not.toHaveBeenCalled();
    openPreview();
    fireEvent.click(review().getByRole("button", { name: "Apply changes" }));
    expect(await review().findByRole("alert")).toBeTruthy();
    fireEvent.click(review().getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Lifting taper target · Winter trail race · Sun, Jan 31/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Preview a training week" }).options).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Use original block dates" }));
    expect(review().getByText(/Original hybrid target · Sat, Jan 16/)).toBeTruthy();
    fireEvent.click(review().getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Hybrid target · Road 10K · Sat, Jan 16/)).toBeTruthy();
    expect(save.mock.calls[2][0].__raceBuild).toEqual(race);
  });

  it("requires a new preview if a synced race changes while reviewing", () => {
    const save = vi.fn();
    const { rerender } = render(block(initial, save));
    openPreview();
    const changed = { ...initial, __raceBuild: { ...race, raceDate: "2027-01-30" } };
    rerender(block(changed, save));
    expect(screen.queryByRole("dialog")).toBeNull();
    openPreview();
    expect(review().getByText(/Winter trail race · Sat, Jan 30/)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("shows a pending alignment the same day a lift was logged and offers to reverse it", async () => {
    const monday = "2027-01-11";
    const entries = { [monday]: { workout: { exercises: { "Barbell Bench Press": { sets: [{ done: true, reps: "8", weight: "90" }] } } } } };
    function Harness() {
      const [program, setProgram] = useState(initial);
      return block(program, next => { setProgram(next); return true; }, entries, monday);
    }
    render(<Harness />);
    openPreview();
    expect(review().getByText(/Changes begin Tue, Jan 12/)).toBeTruthy();
    fireEvent.click(review().getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("New taper takes effect Tue, Jan 12.")).toBeTruthy();
    expect(screen.getByRole("option", { selected: true, name: /Week 8 · Race week → Race-specific/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use original block dates" })).toBeTruthy();
  });

  it("links a saved race to alignment, and keeps unsaved race edits on the form", () => {
    const onOpenBlock = vi.fn();
    render(<RacePlanPanel program={initial} todayKey={todayKey} onSave={vi.fn()} onOpenBlock={onOpenBlock} />);
    fireEvent.click(screen.getByRole("button", { name: "Review lifting alignment" }));
    expect(onOpenBlock).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Race date"), { target: { value: "2027-01-30" } });
    expect(screen.queryByRole("button", { name: "Review lifting alignment" })).toBeNull();
    expect(screen.getByText(/After saving the running schedule/)).toBeTruthy();
  });
});
