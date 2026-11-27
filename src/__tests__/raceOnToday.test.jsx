// src/__tests__/raceOnToday.test.jsx
// A run logged on Today can be marked as a race. The result fills what the
// run is missing, a faster one is called a PR, and with a race plan the
// sheet offers to set training paces from it.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { TodayTab } from "../TodayTab";
import { DAYS, DEFAULT_PROGRAM, defaultDay, getDayName, getTodayKey } from "../constants";
import { DEFAULT_SETTINGS } from "../data";
import strengthPhoto from "../assets/training/strength.webp";
import trackPhoto from "../assets/training/track.webp";
import corePhoto from "../assets/training/core.webp";

vi.mock("../oura", async (importOriginal) => ({ ...(await importOriginal()), isOuraConnected: vi.fn(async () => false), loadOuraData: vi.fn(async () => ({})) }));
vi.mock("../whoop", () => ({ isWhoopConnected: vi.fn(async () => false), loadWhoopData: vi.fn(async () => ({})) }));

afterEach(cleanup);

function setPath(object, keys, value) {
  if (!keys.length) return value;
  const [head, ...rest] = keys;
  return { ...(object || {}), [head]: setPath(object?.[head], rest, value) };
}

const todayKey = getTodayKey();
const todayName = getDayName(new Date());
const rest = { type: "Rest", lifting: [], cardio: null };
const program = { ...Object.fromEntries(DAYS.map((day) => [day, rest])), [todayName]: { type: "Run day", lifting: [], cardio: { type: "Easy Run", miles: 3, effort: "Easy" } } };

function mountToday({ earlier = {}, currentProgram = program, baseProgram = currentProgram } = {}) {
  const showToast = vi.fn();
  const onUseRaceForPaces = vi.fn();
  let latest = null;
  function Harness() {
    const [day, setDay] = useState(defaultDay());
    latest = day;
    const updateToday = (path, value) => setDay((prev) => setPath(prev, path.split("."), value));
    return (
      <ThemeProvider>
        <TodayTab
          todayName={todayName} todayData={day} updateToday={updateToday} showToast={showToast} onExport={vi.fn()} loaded
          program={currentProgram} baseProgram={baseProgram} onUseRaceForPaces={onUseRaceForPaces}
          settings={{ ...DEFAULT_SETTINGS, onboarded: true }} allData={{ ...earlier, [todayKey]: day }}
          logDate={null} setLogDate={vi.fn()} ouraRecovery={null} setTab={vi.fn()}
        />
      </ThemeProvider>
    );
  }
  render(<Harness />);
  return { showToast, onUseRaceForPaces, day: () => latest };
}

function logRun(miles) {
  fireEvent.change(screen.getAllByLabelText("Miles")[0], { target: { value: miles } });
}

describe("the planned activity on Today", () => {
  const run = { type: "Easy Run", miles: 3 };
  const lift = { name: "Back Squat", sets: 3, reps: 5 };
  it.each([
    ["Run", { cardio: run }, trackPhoto],
    ["Lift then run", { lifting: [lift], cardio: run }, strengthPhoto],
    ["Intervals and core", DEFAULT_PROGRAM.Thursday, corePhoto],
    ["Bodyweight", { lifting: [{ name: "Plank", sets: 3, reps: 30 }] }, corePhoto],
    ["Custom", { lifting: [{ name: "Mobility circuit", sets: 2, reps: 8 }] }, null],
    ["Bike", { cardio: { type: "Bike intervals" } }, null],
    ["Unknown cardio", { cardio: { type: "Intervals" } }, null],
    ["Rest", {}, null],
  ])("matches the next activity on a %s day", (type, planned, expectedPhoto) => {
    mountToday({ currentProgram: { ...program, [todayName]: { ...rest, type, ...planned } } });
    const image = document.querySelector('[data-ui="today-command-center"] img');
    expect(image?.getAttribute("src") ?? null).toBe(expectedPhoto);
    if (expectedPhoto) expect(image.alt).toBe("");
  });
});

describe("a race on Today", () => {
  it("is offered once a run is logged, and fills what the run is missing", () => {
    const { day, showToast } = mountToday();
    expect(screen.queryByRole("button", { name: "Log as a race" })).toBeNull();
    logRun("3.1");
    fireEvent.click(screen.getByRole("button", { name: "Log as a race" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Finish time"), { target: { value: "24:10" } });
    fireEvent.change(within(sheet).getByLabelText("Race name (optional)"), { target: { value: "Turkey Trot" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    expect(day().workout.cardio).toMatchObject({ miles: "3.1", time: "24:10", pace: "7:47", race: { distance: "5k", seconds: 1450, name: "Turkey Trot" } });
    expect(showToast).toHaveBeenLastCalledWith("Race saved");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Turkey Trot")).toBeTruthy();
  });

  it("asks again for a time it can't read", () => {
    mountToday();
    logRun("3.1");
    fireEvent.click(screen.getByRole("button", { name: "Log as a race" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Finish time"), { target: { value: "24" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    expect(within(sheet).getByRole("alert").textContent).toMatch(/like 24:10/);
  });

  it("calls a faster time than any before a PR", () => {
    const earlier = { "2026-10-04": { workout: { cardio: { miles: "3.1", race: { distance: "5k", seconds: 1500 } } } } };
    const { showToast } = mountToday({ earlier });
    logRun("3.1");
    fireEvent.click(screen.getByRole("button", { name: "Log as a race" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Finish time"), { target: { value: "24:10" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    expect(showToast).toHaveBeenLastCalledWith("New 5K PR: 24:10, 0:50 faster");
    expect(screen.getByText("PR")).toBeTruthy();
  });

  it("with a race plan, offers the paces the result sets", () => {
    const spec = {
      kind: "runPlan", v: 1, distance: "10k", raceDate: "2027-01-09", startDate: "2026-11-23", runsPerWeek: 4,
      longRunDay: "Saturday", qualityDay: "Wednesday", crossTraining: "none", startLongRunMin: 45,
      benchmark: { distance: "5k", seconds: 1560, date: "2026-11-01" }, benchmarkTest: "none", raceName: "10K",
    };
    const { onUseRaceForPaces } = mountToday({ baseProgram: { ...program, __raceBuild: spec } });
    logRun("3.1");
    fireEvent.click(screen.getByRole("button", { name: "Log as a race" }));
    let sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Finish time"), { target: { value: "24:10" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    sheet = screen.getByRole("dialog", { name: "Update your training paces?" });
    expect(within(sheet).getByText(/A 5K in 24:10 puts your training at easy/)).toBeTruthy();
    act(() => { fireEvent.click(within(sheet).getByRole("button", { name: "Use these paces" })); });
    expect(onUseRaceForPaces).toHaveBeenCalledWith({ distance: "5k", seconds: 1450, date: todayKey });
  });

  it("can be taken off again", () => {
    const { day } = mountToday();
    logRun("3.1");
    fireEvent.click(screen.getByRole("button", { name: "Log as a race" }));
    let sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Finish time"), { target: { value: "24:10" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save race" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "It wasn’t a race" }));
    expect(day().workout.cardio.race).toBeNull();
    expect(screen.getByRole("button", { name: "Log as a race" })).toBeTruthy();
  });
});
