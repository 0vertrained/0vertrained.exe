// src/__tests__/presetPickerV19_5.test.jsx
// @vitest-environment jsdom
// More → Switch preset lists the five-plan lineup (not every preset
// in the file), previews each plan's own days with holds read in seconds, and
// switching saves the preset's own program. Hybrid Athlete used to load
// DEFAULT_PROGRAM whatever it said; an active race plan still rides along.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../supabaseClient", () => {
  const chain = {};
  for (const m of ["select", "order", "range", "gte", "gt", "lte", "lt", "eq", "neq", "in", "is", "not", "or", "filter", "match", "limit", "update", "upsert", "insert", "delete"]) chain[m] = () => chain;
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve, reject) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }), getSession: async () => ({ data: { session: null } }) },
      from: () => chain,
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

import { ThemeProvider } from "../theme";
import { ProgramHome, ProgramEditor } from "../ProgramScreen";
import { DEFAULT_PROGRAM, PROGRAM_PRESETS, ORIGINAL_PRESET_IDS, RESEARCH_PRESET_IDS } from "../constants";
import { readSupersetPref } from "../liftLogPrefs";
import { flattenProgramLifting } from "../programSessions";

afterEach(() => { cleanup(); localStorage.clear(); });

const SPEC = {
  kind: "runPlan", raceName: "Chilly Willy 10K", distance: "10k", raceDate: "2027-01-16", startDate: "2026-10-26",
  runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Tuesday", crossTraining: "vest_walk", startLongRunMin: 35,
  benchmark: null, benchmarkTest: "2026-11-26",
};
const LINEUP_NAMES = ORIGINAL_PRESET_IDS.map((id) => PROGRAM_PRESETS[id].name);
const UNLISTED_NAMES = ["raceEdition50k"].map((id) => PROGRAM_PRESETS[id].name);

function openPicker({ program = DEFAULT_PROGRAM, original = true, todayKey } = {}) {
  const onSaveProgram = vi.fn(async () => true);
  render(
    <ThemeProvider>
      <ProgramHome program={program} todayKey={todayKey} onSaveProgram={onSaveProgram} onEdit={vi.fn()} onBuild={vi.fn()} />
    </ThemeProvider>,
  );
  if (original) fireEvent.change(screen.getByRole("combobox", { name: "Plan collection" }), { target: { value: "original" } });
  return { onSaveProgram };
}

async function switchTo(name) {
  fireEvent.click(screen.getByText(name).closest("[role=radio]"));
  fireEvent.click(screen.getByRole("button", { name: `Load ${name}` }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Switch program" }));
  return dialog;
}

describe("Switch preset", () => {
  it("previews and loads a research plan with its guide, sets, effort and timer targets", async () => {
    const { onSaveProgram } = openPicker({ original: false });
    expect(screen.getAllByRole("radio")).toHaveLength(RESEARCH_PRESET_IDS.length);
    fireEvent.click(screen.getByRole("radio", { name: /Barbell Strength/ }));
    fireEvent.click(screen.getByRole("button", { name: /Barbell Strength, day by day/ }));
    expect(screen.getAllByText("3×3–5").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /How to train on this plan/ }));
    expect(screen.getByRole("link", { name: /plan and its research/ }).getAttribute("href")).toBe("/training-guide.html#barbellStrength");
    await switchTo("Barbell Strength");
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledWith(PROGRAM_PRESETS.barbellStrength.program));
  });
  it("can restore a preset after the athlete changes the working sets", async () => {
    const preset = PROGRAM_PRESETS.barbellStrength.program;
    const changed = structuredClone(preset);
    changed.Monday.lifting[0].sets += 1;
    const { onSaveProgram } = openPicker({ program: changed, original: false });
    await switchTo("Barbell Strength");
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledWith(preset));
  });
  it("lists the original collection in its established order", () => {
    openPicker();
    const shown = screen.getAllByRole("radio").map((radio) => radio.querySelector(".t-bs").textContent);
    expect(shown).toEqual(LINEUP_NAMES);
    for (const name of UNLISTED_NAMES) expect(screen.queryByText(name)).toBeNull();
  });

  it("previews a plan's own week, with holds in seconds and lifts in reps", () => {
    openPicker();
    fireEvent.click(screen.getByText("Calisthenics").closest("[role=radio]"));
    fireEvent.click(screen.getByRole("button", { name: /^Calisthenics, day by day/ }));
    expect(screen.getAllByText("Upper A — Pull + Push").length).toBeGreaterThan(0);
    const hold = screen.getByText("Hollow Body Hold").parentElement;
    expect(within(hold).getByText("3×30s")).toBeTruthy();
    const pullUp = screen.getByText("Pull-Up").parentElement;
    expect(within(pullUp).getByText("4×6")).toBeTruthy();
  });

  it("previews Hybrid Athlete as its own program, not the default one", () => {
    openPicker();
    fireEvent.click(screen.getByText("Hybrid Athlete").closest("[role=radio]"));
    fireEvent.click(screen.getByRole("button", { name: /^Hybrid Athlete, day by day/ }));
    expect(screen.getAllByText(PROGRAM_PRESETS.hybrid.program.Monday.type).length).toBeGreaterThan(0);
    expect(screen.queryByText(DEFAULT_PROGRAM.Monday.type)).toBeNull();
  });

  it("switching to Hybrid Athlete saves the Hybrid Athlete program", async () => {
    const { onSaveProgram } = openPicker();
    await switchTo("Hybrid Athlete");
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    const saved = onSaveProgram.mock.calls[0][0];
    expect(saved).toEqual(PROGRAM_PRESETS.hybrid.program);
    expect(saved).not.toEqual(DEFAULT_PROGRAM);
  });

  it("switching keeps an active race plan and the new plan's strength days", async () => {
    const { onSaveProgram } = openPicker({ program: { ...DEFAULT_PROGRAM, __raceBuild: SPEC } });
    const dialog = await switchTo("Runner");
    expect(dialog.textContent).toMatch(/Your race plan stays\./);
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    const saved = onSaveProgram.mock.calls[0][0];
    expect(saved.__raceBuild).toBe(SPEC);
    expect(flattenProgramLifting(saved.Tuesday)).toEqual(flattenProgramLifting(PROGRAM_PRESETS.running.program.Tuesday));
  });

  it("a plan's declared supersets are live as soon as it's loaded", async () => {
    const { onSaveProgram } = openPicker();
    expect(readSupersetPref("Monday", "Pull-Up")).toBe(false);
    await switchTo("Calisthenics");
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readSupersetPref("Monday", "Pull-Up")).toBe(true));
    expect(readSupersetPref("Thursday", "Chin-Up")).toBe(true);
  });
});

describe("Road & Trail Hybrid activation", () => {
  function pickHybrid(program) {
    const { onSaveProgram } = openPicker({ program, original: false, todayKey: "2026-11-27" });
    fireEvent.click(screen.getByRole("radio", { name: /Road & Trail Hybrid/ }));
    return onSaveProgram;
  }

  it("defaults a Friday selection to the coming Monday, previews the race, then commits the selected target on confirmation", async () => {
    const onSaveProgram = pickHybrid();
    expect(screen.getByLabelText("Week 1 start date").value).toBe("2026-11-30");
    fireEvent.change(screen.getByLabelText("Hybrid race target"), { target: { value: "trail15k" } });
    expect(screen.getByText("Trail 15K on Sat, Jan 23.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /How to train on this plan/ }));
    expect(screen.getByRole("link", { name: /plan and its research/ }).getAttribute("href")).toBe("/training-guide.html#roadTrailHybrid");
    fireEvent.click(screen.getByRole("button", { name: "Load Road & Trail Hybrid" }));
    expect(onSaveProgram).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(onSaveProgram).not.toHaveBeenCalled();
    await switchTo("Road & Trail Hybrid");
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    const saved = onSaveProgram.mock.calls[0][0];
    expect(saved.__hybridBlock).toEqual({ id: "roadTrailHybrid", startMonday: "2026-11-30", raceTarget: "trail15k" });
    expect(saved.Tuesday.sessions.map(s => s.id)).toEqual(["am", "pm"]);
  });

  it("lets an athlete start a fresh block if an imported start date is invalid", async () => {
    const program = { ...PROGRAM_PRESETS.roadTrailHybrid.program,
      __hybridBlock: { id: "roadTrailHybrid", startMonday: "invalid" } };
    const onSaveProgram = pickHybrid(program);
    await switchTo("Road & Trail Hybrid");
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    expect(onSaveProgram.mock.calls[0][0].__hybridBlock.startMonday).toBe("2026-11-30");
  });

  it("requires a current or future Monday and lets the athlete join the current week explicitly", async () => {
    const onSaveProgram = pickHybrid();
    const start = screen.getByLabelText("Week 1 start date");
    const load = screen.getByRole("button", { name: "Load Road & Trail Hybrid" });
    for (const value of ["", "2026-12-01", "2026-11-16"]) {
      fireEvent.change(start, { target: { value } });
      expect(start.getAttribute("aria-invalid")).toBe("true");
      fireEvent.click(load);
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    expect(onSaveProgram).not.toHaveBeenCalled();
    fireEvent.change(start, { target: { value: "2026-11-23" } });
    expect(screen.getByText(/Join midweek and skip the sessions already past/)).toBeTruthy();
    await switchTo("Road & Trail Hybrid");
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    expect(onSaveProgram.mock.calls[0][0].__hybridBlock.startMonday).toBe("2026-11-23");
  });

  it.each(["keep", "hybrid"])("respects the athlete’s running-calendar choice (%s)", async choice => {
    const onSaveProgram = pickHybrid({ ...DEFAULT_PROGRAM, __raceBuild: SPEC });
    const calendars = screen.getByLabelText("Running calendar");
    expect(calendars.value).toBe("keep");
    fireEvent.change(calendars, { target: { value: choice } });
    await switchTo("Road & Trail Hybrid");
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    const next = onSaveProgram.mock.calls[0][0];
    expect(next.__raceBuild).toBe(choice === "keep" ? SPEC : undefined);
    expect(next.__hybridBlock.startMonday).toBe("2026-11-30");
  });
});

describe("Program editor", () => {
  async function editWednesday(change) {
    const onSaveProgram = vi.fn(async () => true);
    render(
      <ThemeProvider>
        <ProgramEditor program={PROGRAM_PRESETS.hybrid.program} onSaveProgram={onSaveProgram} onDone={vi.fn()} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Wednesday" }));
    change();
    fireEvent.click(screen.getByRole("button", { name: "Save program" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    return onSaveProgram.mock.calls[0][0].Wednesday.cardio;
  }

  it("rewriting a session's notes drops its timer steps, so the timer reads the new notes", async () => {
    const cardio = await editWednesday(() => {
      fireEvent.change(screen.getByLabelText("Notes, shown on Today"), { target: { value: "8 × 90 s hard w/ 60 s easy jog" } });
    });
    expect(cardio.notes).toBe("8 × 90 s hard w/ 60 s easy jog");
    expect(cardio.steps).toBeUndefined();
    expect(PROGRAM_PRESETS.hybrid.program.Wednesday.cardio.steps).toBeTruthy(); // the preset itself is untouched
  });

  it("changing only the miles keeps them", async () => {
    const cardio = await editWednesday(() => {
      fireEvent.change(screen.getByLabelText("Target miles"), { target: { value: "6" } });
    });
    expect(cardio.miles).toBe(6);
    expect(cardio.steps).toEqual(PROGRAM_PRESETS.hybrid.program.Wednesday.cardio.steps);
  });
});
