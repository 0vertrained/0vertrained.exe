import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TodayTab } from "../TodayTab";
import { DayDetail, daySummary } from "../ProgressHistory";
import { buildAthleteTimeline } from "../athleteTimeline";
import { defaultDay, getDayName, getTodayKey } from "../constants";
import { DEFAULT_SETTINGS } from "../data";
import { calcStreak } from "../AppHeader";
import { computeSessionLoad } from "../loadModel";
import { MIXED_PLANS } from "../plans/mixed";
import { loggedRuns } from "../runProgress";
import { manualMilesForDay } from "../runningVolume";
import { ThemeProvider } from "../theme";

vi.mock("../oura", async (original) => ({ ...(await original()), isOuraConnected: vi.fn(async () => false) }));
vi.mock("../whoop", async (original) => ({ ...(await original()), isWhoopConnected: vi.fn(async () => false) }));
vi.mock("../CardioSession.jsx", () => ({
  CardioSession: ({ onLogTime }) => <button onClick={() => onLogTime("27:15")}>Log elapsed time</button>,
}));
afterEach(cleanup);

const date = getTodayKey();
const weekday = getDayName(new Date());
const bike = MIXED_PLANS.cardioBase.program.Friday;
function today(plan, day = defaultDay()) {
  const save = vi.fn();
  render(<ThemeProvider><TodayTab loaded todayName={weekday} todayData={day}
    program={{ [weekday]: plan }} updateToday={save} showToast={vi.fn()}
    settings={{ ...DEFAULT_SETTINGS, onboarded: true }} allData={{ [date]: day }}
    logDate={null} setLogDate={vi.fn()} setTab={vi.fn()} /></ThemeProvider>);
  return save;
}

describe("time-based cardio", () => {
  it("logs actual bike time and identity from the manual form", () => {
    const save = today(bike);
    expect(screen.queryByLabelText("Miles")).toBeNull();
    expect(screen.queryByLabelText("Pace")).toBeNull();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "29:05" } });
    expect(save).toHaveBeenCalledWith("workout.cardio.time", "29:05");
    expect(save).toHaveBeenCalledWith("workout.cardio.modality", "bike");
    expect(save).toHaveBeenCalledWith("workout.cardio.type", bike.cardio.type);
    expect(save.mock.calls.some(([field]) => field.endsWith(".miles"))).toBe(false);
  });

  it("logs elapsed time and sport in the scheduled slot from the timer", async () => {
    const save = today({ sessions: [{ ...bike, id: "main", label: "Morning" }] });
    fireEvent.click(screen.getAllByRole("button", { name: "Start cardio" }).at(-1));
    fireEvent.click(await screen.findByRole("button", { name: "Log elapsed time" }));
    expect(save).toHaveBeenCalledWith("workout.cardioSessions.main.time", "27:15");
    expect(save).toHaveBeenCalledWith("workout.cardioSessions.main.modality", "bike");
    expect(save.mock.calls.some(([field]) => field.endsWith(".miles"))).toBe(false);
  });

  it("counts a time-only ride as a workout without changing running mileage", () => {
    const entry = { workout: { cardio: { type: bike.cardio.type, modality: "bike", time: "30" } } };
    const data = { [date]: entry };
    expect(calcStreak(data)).toMatchObject({ count: 1, active: true });
    expect(computeSessionLoad(entry)).toMatchObject({ cardioMin: 30, durationSource: "recorded", load: 120 });
    expect(manualMilesForDay(entry)).toBe(0);
    expect(daySummary(entry)).toBe(bike.cardio.type + ", 30:00");
    expect(buildAthleteTimeline(data)[0]).toMatchObject({ type: "training", metrics: { miles: 0 } });
  });

  it("keeps split sessions and an extra run distinct in history, daily load and running totals", () => {
    const entry = { workout: { rpe: "5", cardioSessions: { main: { type: bike.cardio.type, modality: "bike", time: "27:15" },
      pm: { type: "Row", modality: "row", miles: 1, time: "10:00" } },
      cardio: { type: "Run", modality: "run", unplanned: true, miles: 2, time: "20:00" } } };
    const data = { [date]: entry };
    expect(computeSessionLoad(entry)).toMatchObject({ cardioMin: 57, cardioSessionCount: 3, load: 286 });
    expect(manualMilesForDay(entry)).toBe(2);
    expect(loggedRuns(data, {}, { todayKey: date, days: 1 }).map(block => block.miles)).toEqual([2]);
    expect(daySummary(entry)).toContain(bike.cardio.type + ", 27:15");
    const [event] = buildAthleteTimeline(data);
    expect(event.metrics.miles).toBe(2);
    expect(event.detail).toContain(bike.cardio.type);
    render(<ThemeProvider><DayDetail data={data} dateKey={date} program={{}} /></ThemeProvider>);
    const section = screen.getByRole("region", { name: bike.cardio.type });
    expect(within(section).getByText("27:15")).toBeTruthy();
    expect(section.textContent).not.toMatch(/mi|pace/i);
    expect(screen.getByRole("region", { name: "Run" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Row" })).toBeTruthy();
  });
});
