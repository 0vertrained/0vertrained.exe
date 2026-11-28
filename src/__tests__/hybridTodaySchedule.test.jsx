// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { defaultDay, getDayName } from "../constants";
import { DEFAULT_SETTINGS } from "../data";
import { ThemeProvider } from "../theme";
import { TodayTab } from "../TodayTab";
import { liveTrainingWeek } from "../customTrainingDay";
import { ROAD_TRAIL_HYBRID, startRoadTrailHybrid } from "../plans/roadTrailHybrid";
import { flattenProgramLifting } from "../programSessions";

vi.mock("../oura", async (original) => ({ ...(await original()), isOuraConnected: async () => false }));
vi.mock("../whoop", async (original) => ({ ...(await original()), isWhoopConnected: async () => false }));
vi.mock("../strava/dataLoading", async (original) => ({ ...(await original()), isStravaConnected: async () => false }));

const friday = "2026-11-27";
const race = {
  kind: "runPlan", raceName: "January 10K", distance: "10k", raceDate: "2027-01-16", startDate: "2026-10-26",
  runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Tuesday", crossTraining: "none", startLongRunMin: 35,
  benchmark: null, benchmarkTest: "none",
};

afterEach(() => { cleanup(); vi.useRealTimers(); });

function mountSchedule({ dateKey = friday, start = "2026-11-23", racePlan = null, liftingComplete = false, onChangeStartDate = null, onSaveProgram = null } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${dateKey}T12:00:00`));
  const todayName = getDayName(new Date());
  const day = defaultDay();
  const base = startRoadTrailHybrid(ROAD_TRAIL_HYBRID.program, start);
  if (racePlan) base.__raceBuild = racePlan;
  const data = { [dateKey]: day };
  const live = liveTrainingWeek({ program: base, data, dateKey, currentDateKey: dateKey });
  if (liftingComplete) {
    for (const exercise of flattenProgramLifting(live[todayName])) {
      day.workout.exercises[exercise.name] = { sets: Array.from({ length: exercise.sets }, () => ({ done: true, weight: "50", reps: "8" })) };
    }
  }
  const { container } = render(
    <ThemeProvider>
      <TodayTab todayName={todayName} todayData={day} updateToday={vi.fn()} showToast={vi.fn()} loaded
        program={live} baseProgram={base} onSaveProgram={onSaveProgram} onChangeStartDate={onChangeStartDate} settings={{ ...DEFAULT_SETTINGS, onboarded: true }} allData={data}
        logDate={null} setLogDate={vi.fn()} ouraRecovery={null} setTab={vi.fn()} />
    </ThemeProvider>
  );
  return within(container.querySelector('[data-section="physique-os"]'));
}

describe("Road & Trail Hybrid on Today", () => {
  it.each([
    ["during week one", "2026-11-23", null],
    ["with a generated race plan", "2026-11-23", race],
    ["when the block starts today", friday, null],
  ])("offers Friday's upper-body session %s", async (_, start, racePlan) => {
    const card = mountSchedule({ start, racePlan });
    expect(card.getByRole("button", { name: "Start session" })).toBeTruthy();
    expect(card.queryByText("Rest day, protected")).toBeNull();
    expect(screen.getByText("AM · Upper bodybuilding")).toBeTruthy();
    if (!racePlan) expect(screen.getByRole("button", { name: "Start run" })).toBeTruthy();
    fireEvent.click(card.getByRole("button", { name: "Start session" }));
    const runner = await screen.findByRole("dialog", { name: /workout session/ });
    expect(within(runner).getByRole("heading", { name: "Plate-Loaded Incline Press" })).toBeTruthy();
  });

  it("offers the remaining run after Friday's lifts have been logged", () => {
    const card = mountSchedule({ liftingComplete: true });
    expect(card.getByRole("button", { name: "Start run" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Box Score" })).toBeTruthy();
    expect(card.queryByRole("button", { name: "Start session" })).toBeNull();
  });

  it("opens Friday PM directly from Today after finishing AM and saves only that skip", async () => {
    const save = vi.fn().mockResolvedValue(true);
    mountSchedule({ liftingComplete: true, onSaveProgram: save });
    fireEvent.click(screen.getByRole("button", { name: "Move or skip PM run" }));
    const sheet = within(screen.getByRole("dialog"));
    fireEvent.click(sheet.getByRole("button", { name: "Skip" }));
    expect(sheet.getByText(/after this change/).textContent).toMatch(/AM · Upper bodybuilding/);
    fireEvent.click(sheet.getByRole("button", { name: "Skip this session" }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].__sessionEdits.items).toMatchObject([{ from: friday, id: "pm", to: null }]);
  });

  it("shows the selected midweek start on an empty day and offers to change it", () => {
    const onChangeStartDate = vi.fn();
    const card = mountSchedule({ dateKey: "2026-12-01", start: "2026-12-02", onChangeStartDate });
    expect(card.getByText("Road & Trail Hybrid starts Wed, Dec 2.")).toBeTruthy();
    fireEvent.click(card.getByRole("button", { name: "Change start date" }));
    expect(onChangeStartDate).toHaveBeenCalledOnce();
    expect(card.queryByText("Rest day, protected")).toBeNull();
    expect(card.queryByRole("button", { name: "Start session" })).toBeNull();
  });

  it("keeps a current race run actionable while showing when the hybrid block starts", () => {
    const card = mountSchedule({ dateKey: "2026-11-24", start: "2026-11-30", racePlan: race });
    expect(card.getByText("Road & Trail Hybrid starts Mon, Nov 30.")).toBeTruthy();
    expect(card.getByRole("button", { name: "Start run" })).toBeTruthy();
    expect(card.queryByText("Rest day, protected")).toBeNull();
  });

  it("still identifies a scheduled rest day during the block", () => {
    const card = mountSchedule({ dateKey: "2026-11-29" });
    expect(card.getByText("Rest day, protected")).toBeTruthy();
    expect(card.queryByRole("button", { name: "Start session" })).toBeNull();
  });
});
