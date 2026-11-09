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
import { MoreTab } from "../MoreTab";
import { DEFAULT_PROGRAM, PROGRAM_PRESETS, PRESET_LINEUP } from "../constants";
import { readSupersetPref } from "../liftLogPrefs";
import { flattenProgramLifting } from "../programSessions";

afterEach(() => { cleanup(); localStorage.clear(); });

const SPEC = {
  kind: "runPlan", raceName: "Chilly Willy 10K", distance: "10k", raceDate: "2027-01-16", startDate: "2026-10-26",
  runsPerWeek: 4, longRunDay: "Saturday", qualityDay: "Tuesday", crossTraining: "vest_walk", startLongRunMin: 35,
  benchmark: null, benchmarkTest: "2026-11-26",
};
const LINEUP_NAMES = PRESET_LINEUP.map((id) => PROGRAM_PRESETS[id].name);
const UNLISTED_NAMES = ["highIntensityHybrid", "ramiHybridCut", "raceEdition50k", "powerlifting", "beginner"].map((id) => PROGRAM_PRESETS[id].name);

function openPicker({ program = DEFAULT_PROGRAM } = {}) {
  const onSaveProgram = vi.fn(async () => true);
  render(
    <ThemeProvider>
      <MoreTab program={program} onSaveProgram={onSaveProgram} onApplyGeneratedProgram={vi.fn()} settings={{}} allData={{}} showToast={vi.fn()} myUsername="athlete" />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByText("Switch preset").closest("button"));
  return { onSaveProgram };
}

async function switchTo(name) {
  fireEvent.click(screen.getByText(name).closest("button"));
  fireEvent.click(screen.getByRole("button", { name: "Switch to This Program" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Switch program" }));
  return dialog;
}

describe("Switch preset", () => {
  it("lists the five-plan lineup, in order, and nothing else", () => {
    openPicker();
    const shown = screen.getAllByText((text) => LINEUP_NAMES.includes(text) || UNLISTED_NAMES.includes(text)).map((el) => el.textContent);
    expect(shown).toEqual(LINEUP_NAMES);
    for (const name of UNLISTED_NAMES) expect(screen.queryByText(name)).toBeNull();
  });

  it("previews a plan's own week, with holds in seconds and lifts in reps", () => {
    openPicker();
    fireEvent.click(screen.getByText("Calisthenics").closest("button"));
    expect(screen.getAllByText("Upper A — Pull + Push").length).toBeGreaterThan(0);
    const hold = screen.getByText("Hollow Body Hold").parentElement;
    expect(within(hold).getByText("3×30s")).toBeTruthy();
    const pullUp = screen.getByText("Pull-Up").parentElement;
    expect(within(pullUp).getByText("4×6")).toBeTruthy();
  });

  it("previews Hybrid Athlete as its own program, not the default one", () => {
    openPicker();
    fireEvent.click(screen.getByText("Hybrid Athlete").closest("button"));
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

describe("Program editor", () => {
  async function editWednesday(change) {
    const onSaveProgram = vi.fn(async () => true);
    render(
      <ThemeProvider>
        <MoreTab program={PROGRAM_PRESETS.hybrid.program} onSaveProgram={onSaveProgram} onApplyGeneratedProgram={vi.fn()} settings={{}} allData={{}} showToast={vi.fn()} myUsername="athlete" />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText("Edit weekly program").closest("button"));
    fireEvent.click(screen.getByRole("button", { name: "Wed" }));
    change();
    fireEvent.click(screen.getByRole("button", { name: "Save Program" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledTimes(1));
    return onSaveProgram.mock.calls[0][0].Wednesday.cardio;
  }

  it("rewriting a session's notes drops its timer steps, so the timer reads the new notes", async () => {
    const cardio = await editWednesday(() => {
      fireEvent.change(screen.getByPlaceholderText("coaching note shown on Today tab"), { target: { value: "8 × 90 s hard w/ 60 s easy jog" } });
    });
    expect(cardio.notes).toBe("8 × 90 s hard w/ 60 s easy jog");
    expect(cardio.steps).toBeUndefined();
    expect(PROGRAM_PRESETS.hybrid.program.Wednesday.cardio.steps).toBeTruthy(); // the preset itself is untouched
  });

  it("changing only the miles keeps them", async () => {
    const cardio = await editWednesday(() => {
      fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "6" } });
    });
    expect(cardio.miles).toBe(6);
    expect(cardio.steps).toEqual(PROGRAM_PRESETS.hybrid.program.Wednesday.cardio.steps);
  });
});
