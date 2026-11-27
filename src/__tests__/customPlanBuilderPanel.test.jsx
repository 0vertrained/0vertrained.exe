import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProgramBuilderPanel } from "../ProgramBuilderPanel";
import { DAYS } from "../programBuilder";
import { exerciseTargetSummary } from "../workoutLogging";

afterEach(cleanup);
const next = () => fireEvent.click(screen.getByRole("button", { name: /^Next:/ }));
const radio = name => fireEvent.click(screen.getByRole("radio", { name }));
const weekdays = () => within(screen.getByRole("group", { name: "Training days" }));
const apply = () => fireEvent.click(screen.getByRole("button", { name: "Use this program" }));

describe("custom plan builder", () => {
  it("previews the saved days and prescriptions and can apply a fixed schedule", async () => {
    const onApply = vi.fn();
    const settings = { programBuilder: { goal: "strength", equipment: "dumbbells", trainingDaysPerWeek: 3,
      restDays: ["Tuesday", "Thursday", "Saturday", "Sunday"] } };
    render(<ProgramBuilderPanel settings={settings} onApply={onApply} />);
    next();
    fireEvent.click(weekdays().getByRole("button", { name: "Tuesday" }));
    fireEvent.click(weekdays().getByRole("button", { name: "Friday" }));
    next();
    expect(onApply).not.toHaveBeenCalled();
    const preview = within(screen.getByRole("region", { name: "Your week" }));
    expect(preview.getByText("Friday · Rest")).toBeTruthy();
    fireEvent.click(preview.getByRole("button", { name: /^Tuesday/ }));
    const adjustable = screen.getByRole("switch", { name: "Adjust lifting targets" });
    expect(adjustable.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(adjustable);
    apply();
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    const { program, preferences } = onApply.mock.calls[0][0];
    expect(preferences).toMatchObject({ goal: "strength", equipment: "dumbbells", adaptiveTraining: false,
      trainingDaysPerWeek: 3, restDays: ["Thursday", "Friday", "Saturday", "Sunday"] });
    const lift = program.Tuesday.lifting[0];
    expect(preview.getByText(lift.name)).toBeTruthy();
    expect(preview.getAllByText(exerciseTargetSummary(lift)).length).toBeGreaterThan(0);
    expect(program.Tuesday.adaptivePlan).toBeUndefined();
    expect(screen.getByRole("link", { name: /training evidence/ }).getAttribute("href")).toContain("training-guide.html#barbellStrength");
  });

  it("lets an athlete with a race schedule apply only their chosen weekdays", async () => {
    const onApply = vi.fn();
    render(<ProgramBuilderPanel hasRacePlan settings={{}} onApply={onApply} />);
    next();
    next();
    const keep = screen.getByRole("switch", { name: "Keep my race plan" });
    expect(keep.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(keep);
    apply();
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ keepExistingRace: false })));
  });

  it("remembers disabled adjustments and enables them only after apply", async () => {
    const onApply = vi.fn();
    render(<ProgramBuilderPanel settings={{ programBuilder: { goal: "strength", adaptiveTraining: false } }} onApply={onApply} />);
    next();
    next();
    const adjustable = screen.getByRole("switch", { name: "Adjust lifting targets" });
    expect(adjustable.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(adjustable);
    expect(onApply).not.toHaveBeenCalled();
    apply();
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    const { program, preferences } = onApply.mock.calls[0][0];
    expect(preferences.adaptiveTraining).toBe(true);
    expect(DAYS.filter(day => program[day].lifting.length).every(day => program[day].adaptivePlan.version === 1)).toBe(true);
  });

  it("starts a new equipment combination empty and persists the items chosen", async () => {
    const onApply = vi.fn();
    render(<ProgramBuilderPanel initialGoal="strength" onApply={onApply} />);
    next();
    radio("Choose my equipment");
    const available = within(screen.getByRole("group", { name: "Available equipment" }));
    expect(available.getAllByRole("button").every(button => button.getAttribute("aria-pressed") === "false")).toBe(true);
    fireEvent.click(available.getByRole("button", { name: "Dumbbells only" }));
    fireEvent.click(available.getByRole("button", { name: "Calisthenics bars" }));
    next();
    apply();
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0][0].preferences).toMatchObject({ equipment: "mixed", equipmentChoices: ["dumbbells", "calisthenics"] });
  });

  it("restores a legacy mixed-equipment setup with its original gym access", () => {
    render(<ProgramBuilderPanel settings={{ programBuilder: { goal: "strength", equipment: "mixed" } }} onApply={vi.fn()} />);
    next();
    const equipment = within(screen.getByRole("group", { name: "Available equipment" }));
    expect(equipment.getByRole("button", { name: "Machines and cables" }).getAttribute("aria-pressed")).toBe("true");
    expect(equipment.getByRole("button", { name: "Free weights with rack and bench" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("builds a cardio-only week for the chosen machine without a lifting adjustment control", async () => {
    const onApply = vi.fn();
    render(<ProgramBuilderPanel settings={{ programBuilder: { goal: "cardio_only", trainingDaysPerWeek: 3, experience: "intermediate" } }} onApply={onApply} />);
    next();
    radio("Rowing");
    next();
    expect(screen.queryByRole("switch", { name: "Adjust lifting targets" })).toBeNull();
    apply();
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    const { program, preferences } = onApply.mock.calls[0][0];
    const sessions = DAYS.map(day => program[day]).filter(day => day.cardio);
    expect(sessions).toHaveLength(3);
    expect(sessions.every(day => !day.lifting.length && day.cardio.modality === "row" && day.cardio.minutes > 0)).toBe(true);
    expect(preferences.cardioModality).toBe("row");
  });
});
