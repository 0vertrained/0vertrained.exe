// src/__tests__/racePlanUi.test.jsx
// V19.3 · Race-plan surfaces: the Today line copy, the More → Program panel
// (draft → stored spec, live preview, explicit save/end), the Progress race
// block reading the synced plan, the cardio runner reading structured steps,
// and the plan surviving a lifting swap.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { DEFAULT_PROGRAM, PROGRAM_PRESETS } from "../constants";
import { RaceWeekLine, raceWeekCopy } from "../RaceWeekLine";
import { RacePlanPanel, draftToSpec, nextMondayKey } from "../RacePlanPanel";
import { RaceBlockSection, racePhase } from "../RaceBlockSection";
import { applyRaceBuild, describeBuildWeek, keepRacePlan } from "../raceBuild";
import { summarizeProgramDay } from "../programSummary";
import { generateRunPlan } from "../runPlanGenerator";
import { suggestPlanFromNotes, suggestPlanFromSteps } from "../cardioSession";

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

const SPEC = {
  kind: "runPlan", raceName: "Chilly Willy 10K", distance: "10k", raceDate: "2027-01-16", startDate: "2026-10-26",
  runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Tuesday", crossTraining: "vest_walk", startLongRunMin: 35,
  benchmark: null, benchmarkTest: "2026-11-26",
};
const PROGRAM = { ...DEFAULT_PROGRAM, __raceBuild: SPEC };

describe("Today race line", () => {
  it("says when a plan hasn't started", () => {
    expect(raceWeekCopy(describeBuildWeek(PROGRAM, "2026-10-22"))).toEqual({
      eyebrow: "Race plan · starts Mon, Oct 26",
      main: "12 weeks to Chilly Willy 10K",
      countdown: "86 days",
    });
  });

  it("names the week, phase and running minutes", () => {
    expect(raceWeekCopy(describeBuildWeek(PROGRAM, "2026-11-11"))).toEqual({
      eyebrow: "Race plan · week 3 of 12",
      main: "Base · 140 min of running this week",
      countdown: "66 days",
    });
    expect(raceWeekCopy(describeBuildWeek(PROGRAM, "2026-11-24")).main).toBe("Build · 5K test · 155 min of running this week");
  });

  it("counts down race week without a minutes line", () => {
    expect(raceWeekCopy(describeBuildWeek(PROGRAM, "2027-01-15"))).toMatchObject({ main: "Race week", countdown: "Tomorrow" });
    expect(raceWeekCopy(describeBuildWeek(PROGRAM, "2027-01-16")).countdown).toBe("Race day");
  });

  it("renders nothing without a plan", () => {
    const { container } = wrap(<RaceWeekLine program={DEFAULT_PROGRAM} dateKey="2026-11-11" />);
    expect(container.textContent).toBe("");
  });

  it("renders the line with a plan", () => {
    wrap(<RaceWeekLine program={PROGRAM} dateKey="2026-11-11" />);
    expect(screen.getByText("Race plan · week 3 of 12")).toBeTruthy();
    expect(screen.getByText("66 days")).toBeTruthy();
  });
});

describe("race plan panel", () => {
  it("starts new plans on the coming Monday", () => {
    expect(nextMondayKey("2026-10-22")).toBe("2026-10-26"); // Thu → next Mon
    expect(nextMondayKey("2026-10-26")).toBe("2026-10-26"); // Mon → today
  });

  it("turns a draft into a clean stored spec", () => {
    const spec = draftToSpec({
      raceName: "Chilly Willy 10K", distance: "10k", raceDate: "2027-01-16", startDate: "2026-10-28",
      runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Tuesday", crossTraining: "vest_walk", startLongRunMin: 35,
      resultDistance: "5k", resultTime: "27:30", testMode: "date", testDate: "2026-11-26",
    });
    expect(spec).toEqual({
      kind: "runPlan", v: 1, raceName: "Chilly Willy 10K", distance: "10k", raceDate: "2027-01-16", startDate: "2026-10-26",
      runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Tuesday", crossTraining: "vest_walk", startLongRunMin: 35,
      benchmark: { distance: "5k", seconds: 1650, date: null }, benchmarkTest: "2026-11-26",
    });
  });

  it("suggests the leg day for the hard run and previews the weeks once there's a race date", () => {
    const onSave = vi.fn().mockResolvedValue(true);
    wrap(<RacePlanPanel program={DEFAULT_PROGRAM} todayKey="2026-10-22" onSave={onSave} onCancel={() => {}} />);
    // Default program: Lower A (squats) on Tuesday is the heaviest leg day away from Saturday.
    expect(screen.getByRole("radio", { name: "Tue", checked: true })).toBeTruthy();
    expect(screen.getByText("Pick a race date.")).toBeTruthy();
    const start = screen.getByRole("button", { name: /Start plan/ });
    expect(start.getAttribute("aria-disabled")).toBe("true");

    fireEvent.change(screen.getByLabelText("Race date"), { target: { value: "2027-01-16" } });
    expect(screen.getByText("Week 1 — Base")).toBeTruthy();
    expect(screen.getByText("Week 12 — Race week")).toBeTruthy();
    expect(screen.getByText(/Saturday has heavy leg work on your long-run day/)).toBeTruthy();
    expect(start.getAttribute("aria-disabled")).toBe("false");
  });

  it("shows paces from a result and flags times it can't read", () => {
    wrap(<RacePlanPanel program={DEFAULT_PROGRAM} todayKey="2026-10-22" onSave={() => {}} onCancel={() => {}} />);
    const time = screen.getByLabelText("Result time");
    fireEvent.change(time, { target: { value: "27" } });
    expect(screen.getByText("Use mm:ss or h:mm:ss.")).toBeTruthy();
    fireEvent.change(time, { target: { value: "27:00" } });
    expect(screen.getByText("Threshold")).toBeTruthy();
    expect(screen.getByText("10K prediction")).toBeTruthy();
  });

  it("saves only on the explicit button, with the spec it previewed", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    wrap(<RacePlanPanel program={DEFAULT_PROGRAM} todayKey="2026-10-22" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Race date"), { target: { value: "2027-01-16" } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Start plan/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const spec = onSave.mock.calls[0][0];
    expect(spec).toMatchObject({ kind: "runPlan", raceDate: "2027-01-16", startDate: "2026-10-26", qualityDay: "Tuesday" });
    expect(generateRunPlan(spec).totalWeeks).toBe(12);
  });

  it("edits an existing plan and ends it only after confirming", async () => {
    const onEnd = vi.fn().mockResolvedValue(true);
    wrap(<RacePlanPanel program={PROGRAM} todayKey="2026-11-11" onSave={() => {}} onEnd={onEnd} onCancel={() => {}} />);
    expect(screen.getByText("Your race plan")).toBeTruthy();
    expect(screen.getByDisplayValue("Chilly Willy 10K")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End plan" }));
    expect(onEnd).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "End plan" }));
    await waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
  });
});

describe("Progress race block", () => {
  it("counts down to the plan's race and points edits at the plan", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00"));
    wrap(<RaceBlockSection program={PROGRAM} />);
    expect(screen.getByText(/66 days · Base · 140 min of running this week/)).toBeTruthy();
    expect(screen.getByText(/Chilly Willy 10K · Sat, Jan 16/)).toBeTruthy();
    expect(screen.getByText("BUILD")).toBeTruthy();
    expect(screen.getByText(/Edit the plan under Profile → Training plan/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull(); // nothing to edit here, no second race
  });

  it("flags the taper and race day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-10T12:00:00"));
    wrap(<RaceBlockSection program={PROGRAM} />);
    expect(screen.getByText("TAPER")).toBeTruthy();
    expect(racePhase(0).stamp).toBe("RACE DAY");
    expect(racePhase(-1).phase).toBe("past");
    expect(racePhase(11).phase).toBe("build");
    expect(racePhase(10).phase).toBe("taper");
  });

  it("with no plan, says where to add one — no local race, no station ledger", () => {
    wrap(<RaceBlockSection program={DEFAULT_PROGRAM} />);
    expect(screen.getByText(/No race on the calendar/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Set race target/ })).toBeNull();
    expect(screen.queryByText(/station/i)).toBeNull();
  });
});

describe("cardio runner reads structured steps", () => {
  const tuesday = generateRunPlan(SPEC).weeks[5].days.Tuesday.run; // 3 × 6 min threshold

  it("takes the interval block from the steps", () => {
    expect(suggestPlanFromSteps(tuesday.steps)).toEqual({ work: 360, rest: 120, rounds: 3, warmup: 600 });
  });

  it("would misread the prose (the reason steps win)", () => {
    expect(suggestPlanFromNotes(tuesday.notes)?.rest).not.toBe(120);
  });

  it("ignores runs without a repeat block", () => {
    expect(suggestPlanFromSteps(generateRunPlan(SPEC).weeks[0].days.Monday.run.steps)).toBeNull();
    expect(suggestPlanFromSteps(undefined)).toBeNull();
  });
});

describe("plan runs in day labels", () => {
  const live = applyRaceBuild(PROGRAM, "2026-12-01"); // week 6 Tuesday: Lower A + 3 × 6 threshold
  it("leads with minutes and doesn't repeat the effort", () => {
    expect(summarizeProgramDay(live.Tuesday).label).toBe("Lower A — Squat Pattern + Threshold Run · 42 min");
    expect(summarizeProgramDay(live.Monday).cardioLabel).toBe("Easy Run · 35 min");
  });
  it("leaves older programs' labels exactly as they were", () => {
    expect(summarizeProgramDay(DEFAULT_PROGRAM.Thursday).cardioLabel).toBe("Intervals · 5mi · High");
  });
});

describe("keepRacePlan", () => {
  it("carries the plan across a lifting swap", () => {
    expect(keepRacePlan(PROGRAM, PROGRAM_PRESETS.doubleEdition.program).__raceBuild).toBe(SPEC);
  });
  it("yields to a program with its own race build", () => {
    expect(keepRacePlan(PROGRAM, PROGRAM_PRESETS.raceEdition50k.program).__raceBuild).toBe("raceBuild50k");
  });
  it("does nothing without a plan", () => {
    const incoming = PROGRAM_PRESETS.doubleEdition.program;
    expect(keepRacePlan(DEFAULT_PROGRAM, incoming)).toBe(incoming);
  });
});
