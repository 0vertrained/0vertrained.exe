// src/__tests__/trainWeekMoves.test.jsx
// Train, mounted: moving a day this week saves the swap on the program for
// this week only, and the week list shows where each day's training came
// from.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ShellProvider } from "../ui/shell";
import { TrainTab } from "../TrainTab";
import { DAYS } from "../constants";
import { applyRaceBuild } from "../raceBuild";

const day = (type, lifting = [], cardio = null) => ({ type, lifting, cardio });
const template = {
  ...Object.fromEntries(DAYS.map((name) => [name, day("Rest")])),
  Thursday: day("Cardio A", [], { type: "Intervals", miles: 5 }),
  Friday: day("Upper B", [{ name: "Row", sets: 3, reps: 10 }]),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function mountTrain() {
  let saved = null;
  function Harness() {
    const [program, setProgram] = useState(template);
    const onSaveProgram = async (next, options) => { saved = { next, options }; setProgram(next); return true; };
    return (
      <ThemeProvider>
        <ShellProvider>
          <TrainTab program={program} liveProgram={applyRaceBuild(program, "2026-11-26")} entries={{}} settings={{}} onSaveProgram={onSaveProgram} onApplyGeneratedProgram={vi.fn()} onStartToday={vi.fn()} onOpenDay={vi.fn()} />
        </ShellProvider>
      </ThemeProvider>
    );
  }
  render(<Harness />);
  return { saved: () => saved };
}

describe("Train → Move a day", () => {
  it("swaps today with tomorrow for this week, and says where each came from", async () => {
    const { saved } = mountTrain();
    fireEvent.click(screen.getByRole("button", { name: "Move a day this week" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /^Fri\s27/ }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Thu\s26/ })); });
    expect(saved().next.__weekMoves).toEqual({ "2026-11-23": { Thursday: "Friday", Friday: "Thursday" } });
    expect(saved().options).toEqual({ savedMessage: "Friday and Thursday swapped for this week" });
    expect(saved().next.Thursday.type).toBe("Cardio A");
    const week = screen.getByRole("heading", { name: "This week" }).closest("section");
    expect(within(week).getByText("Upper B").closest(".row").textContent).toMatch(/Thu\s26.*From Friday/);
    expect(within(week).getByRole("button", { name: "Move another day" })).toBeTruthy();
  });
});
