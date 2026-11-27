import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { ProgramEditor } from "../ProgramScreen";
import { ThemeProvider } from "../theme";

afterEach(cleanup);

function openEditor(day) {
  const onSave = vi.fn(async () => true);
  render(<ThemeProvider><ProgramEditor program={{ Monday: day }} initialDay="Monday" onSaveProgram={onSave} /></ThemeProvider>);
  return async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save program" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    return onSave.mock.calls[0][0].Monday;
  };
}

describe("weekly program library", () => {
  it("adds a machine lift and a timed erg workout to the selected session", async () => {
    const save = openEditor({ type: "Gym", sessions: [{ id: "pm", label: "PM", lifting: [] }] });
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    const picker = within(screen.getByRole("dialog", { name: "Add an exercise" }));
    fireEvent.change(picker.getByLabelText("Equipment or activity"), { target: { value: "plate_loaded" } });
    fireEvent.click(picker.getByRole("button", { name: "Belt Squat" }));
    fireEvent.click(picker.getByRole("button", { name: "Add to session" }));
    fireEvent.click(screen.getByRole("button", { name: "Add cardio" }));
    fireEvent.change(screen.getByLabelText("Cardio library"), { target: { value: "row_intervals" } });
    const { sessions } = await save();
    expect(sessions[0].lifting).toEqual([expect.objectContaining({ name: "Belt Squat", sets: 3, reps: 10, notes: expect.any(String) })]);
    expect(sessions[0].cardio).toMatchObject({ type: "Row Erg Intervals", modality: "row", miles: 0, minutes: 25, steps: expect.any(Array) });
  });

  it("updates a timed workout and the lower bound of a prescribed target range", async () => {
    const save = openEditor({ type: "Gym", lifting: [{ name: "Barbell Row", sets: 3, repMin: 8, reps: 12, rir: 2, restSeconds: 120 }],
      cardio: { type: "Bike", modality: "bike", minutes: 30, steps: [{ kind: "steady", minutes: 30 }] } });
    fireEvent.change(screen.getByLabelText("Max reps"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Rest seconds"), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText("Target minutes"), { target: { value: "40" } });
    const day = await save();
    expect(day.lifting[0]).toMatchObject({ repMin: 6, reps: 6, restSeconds: 180, rir: 2 });
    expect(day.cardio).toEqual({ type: "Bike", modality: "bike", minutes: 40 });
  });
});
