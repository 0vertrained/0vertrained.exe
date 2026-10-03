import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getPreset } from "../../domain/program/presets";
import type { ProgramDay, ProgramWeek } from "../../domain/program/types";
import { expectNoA11yViolations } from "../../test/axe";
import { DayEditorSheet } from "./DayEditorSheet";

function preset(id: string) {
  const p = getPreset(id);
  if (!p) throw new Error(`preset ${id} missing`);
  return p;
}
const beginner = preset("beginner");
const bodybuilding = preset("bodybuilding");

function open(day: ProgramDay, week: ProgramWeek = beginner.week) {
  const onSave = vi.fn();
  const utils = render(<DayEditorSheet weekday="Monday" day={day} week={week} onSave={onSave} onClose={() => {}} />);
  return { onSave, ...utils };
}

const lastLift = (onSave: ReturnType<typeof vi.fn>) => {
  const day = onSave.mock.calls[0]?.[0] as ProgramDay;
  return day.lifting[day.lifting.length - 1];
};

describe("DayEditorSheet", () => {
  it("lists the day's lifts and picks a catalogue movement from the matches with its defaults", async () => {
    const { onSave, container } = open(beginner.week.Monday);
    expect(screen.getByRole("dialog", { name: "Monday" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Exercises" })).getAllByRole("listitem")).toHaveLength(5);
    await expectNoA11yViolations(container);

    const field = screen.getByRole("textbox", { name: "Add exercise" });
    await userEvent.type(field, "p");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.type(field, "ull");
    const matches = screen.getByRole("listbox", { name: "Matches" });
    expect(within(matches).getAllByRole("option").length).toBeLessThanOrEqual(6);
    await userEvent.click(within(matches).getByText("Pull-Up"));
    expect(screen.getByRole("group", { name: "Pull-Up" })).toBeInTheDocument();
    expect(field).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save day" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(lastLift(onSave)).toMatchObject({ id: "pull-up", name: "Pull-Up", libraryId: "pull-up", trackingMode: "bodyweight_reps", sets: expect.any(Number), reps: expect.any(String) });
    expect((onSave.mock.calls[0]?.[0] as ProgramDay).lifting).toHaveLength(6);
  });

  it("blocks a movement that is already in the day", async () => {
    const { onSave } = open(beginner.week.Monday);
    const field = screen.getByRole("textbox", { name: "Add exercise" });
    await userEvent.type(field, "squat");
    expect(within(screen.getByRole("listbox", { name: "Matches" })).queryByText("Back Squat")).not.toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, "Back Squat{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Already in this day. Pick another movement.");
    expect(within(screen.getByRole("list", { name: "Exercises" })).getAllByRole("listitem")).toHaveLength(5);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps a custom name with a guessed tracking mode, and edits sets and reps", async () => {
    const { onSave } = open(beginner.week.Monday);
    const field = screen.getByRole("textbox", { name: "Add exercise" });
    await userEvent.type(field, "Sandbag shoulder{Enter}");
    const row = screen.getByRole("group", { name: "Sandbag shoulder" });
    await userEvent.click(within(row).getByRole("button", { name: "Increase Sets" }));
    const reps = within(row).getByRole("textbox", { name: "Reps" });
    await userEvent.clear(reps);
    await userEvent.type(reps, "6-8");
    await userEvent.click(screen.getByRole("button", { name: "Save day" }));
    expect(lastLift(onSave)).toMatchObject({ id: "sandbag-shoulder", name: "Sandbag shoulder", sets: 4, reps: "6-8" });
    expect(lastLift(onSave)?.libraryId).toBeUndefined();
    expect(typeof lastLift(onSave)?.trackingMode).toBe("string");
  });

  it("turns a training day into a rest day and back", async () => {
    const { onSave } = open(beginner.week.Monday);
    await userEvent.click(screen.getByRole("switch", { name: "Rest day" }));
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save day" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Rest", rest: true, lifting: [] }));
    await userEvent.click(screen.getByRole("switch", { name: "Rest day" }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Full Body A");
    expect(screen.getByRole("group", { name: "Back Squat" })).toBeInTheDocument();
  });

  it("disables Save day while the day is invalid", async () => {
    open(bodybuilding.week.Monday, bodybuilding.week);
    const save = screen.getByRole("button", { name: "Save day" });
    expect(save).toBeEnabled();
    for (let i = 0; i < 5; i += 1) await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    expect(screen.queryByRole("list", { name: "Exercises" })).not.toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(screen.getByText("Monday: a training day has nothing planned.")).toBeInTheDocument();
  });
});
