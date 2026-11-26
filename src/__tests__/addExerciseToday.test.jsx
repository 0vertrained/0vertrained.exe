// src/__tests__/addExerciseToday.test.jsx
// On Today, an exercise can be added for the day from Quick edit, or from
// the plan when no lifting is planned. It joins the day's lifting, its sets
// log like any others, it can be taken off again while nothing is logged,
// and the program never changes.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { TodayTab } from "../TodayTab";
import { DAYS, defaultDay, getDayName, getTodayKey } from "../constants";
import { DEFAULT_SETTINGS } from "../data";

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

function mountToday(todayPlan) {
  const program = { ...Object.fromEntries(DAYS.map((day) => [day, rest])), [todayName]: todayPlan };
  const frozen = JSON.stringify(program);
  const showToast = vi.fn();
  let latest = null;
  function Harness() {
    const [day, setDay] = useState(defaultDay());
    latest = day;
    const updateToday = (path, value) => setDay((prev) => setPath(prev, path.split("."), value));
    return (
      <ThemeProvider>
        <TodayTab
          todayName={todayName} todayData={day} updateToday={updateToday} showToast={showToast} onExport={vi.fn()} loaded
          program={program} baseProgram={program}
          settings={{ ...DEFAULT_SETTINGS, onboarded: true }} allData={{ [todayKey]: day }}
          logDate={null} setLogDate={vi.fn()} ouraRecovery={null} setTab={vi.fn()}
        />
      </ThemeProvider>
    );
  }
  render(<Harness />);
  return { showToast, day: () => latest, programUnchanged: () => JSON.stringify(program) === frozen };
}

function addFromSheet(search, choice) {
  const sheet = screen.getByRole("dialog", { name: "Add an exercise" });
  fireEvent.change(within(sheet).getByLabelText("Exercise"), { target: { value: search } });
  fireEvent.click(within(sheet).getByRole("button", { name: choice }));
  fireEvent.click(within(sheet).getByRole("button", { name: "More sets" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Add to today" }));
}

describe("adding an exercise on Today", () => {
  it("adds one from Quick edit, for the day only", () => {
    const { day, showToast, programUnchanged } = mountToday({ type: "Upper A", lifting: [{ name: "Bench Press", sets: 4, reps: 6 }] });
    fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add an exercise" }));
    addFromSheet("goblet", "Goblet Squat");

    expect(day().workout.added).toEqual([{ name: "Goblet Squat", sets: 4, reps: 10, session: "main" }]);
    expect(showToast).toHaveBeenLastCalledWith("Goblet Squat added for today");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/0 of 2/)).toBeTruthy();
    expect(screen.getByText("· added today")).toBeTruthy();
    expect(programUnchanged()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Remove Goblet Squat from today" }));
    expect(day().workout.added).toEqual([]);
    expect(screen.queryByText("· added today")).toBeNull();
    expect(screen.getAllByText(/0 of 1/).length).toBeGreaterThan(0);
  });

  it("takes a name of your own", () => {
    const { day } = mountToday({ type: "Upper A", lifting: [{ name: "Bench Press", sets: 4, reps: 6 }] });
    fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add an exercise" }));
    addFromSheet("Sled Push", "Add “Sled Push”");
    expect(day().workout.added[0]).toMatchObject({ name: "Sled Push", sets: 4, reps: 10 });
  });

  it("gives a day without lifting a way to add one", () => {
    const { day } = mountToday({ type: "Run day", lifting: [], cardio: { type: "Easy Run", miles: 3 } });
    expect(screen.queryByRole("button", { name: "Quick edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    addFromSheet("plank", "Plank");
    expect(day().workout.added[0]).toMatchObject({ name: "Plank", session: "main" });
    // The day now has lifting, open for logging.
    expect(screen.getByText("Added today")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
  });
});
