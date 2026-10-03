import { describe, expect, it } from "vitest";
import { WEEKDAYS } from "../../domain/dates";
import { plannedDay, trainingDaysPerWeek } from "../../domain/program/revisions";
import { bodyweightKgFrom, firstProgram, ONBOARDING_DEFAULTS, presetProgram, previewWeek } from "./plan";

describe("onboarding plan", () => {
  it("previews the generated week with the chosen number of training days", () => {
    const week = previewWeek({ ...ONBOARDING_DEFAULTS, daysPerWeek: 4 });
    expect(trainingDaysPerWeek(week)).toBe(4);
    expect(WEEKDAYS.every((d) => week[d] !== undefined)).toBe(true);
  });

  it("saves revision 1 effective today with the builder input", () => {
    const { program, startedOn } = firstProgram(ONBOARDING_DEFAULTS, "2026-10-05");
    expect(startedOn).toBe("2026-10-05");
    expect(program.revisions).toHaveLength(1);
    expect(program.revisions[0]).toMatchObject({ effectiveFrom: "2026-10-05", source: "generator", builderInput: { goal: "basic_fitness", daysPerWeek: 3 } });
    expect(plannedDay(program, "2026-10-05")).toBeDefined();
  });

  it("offers presets as a first program and rejects unknown ids", () => {
    expect(presetProgram("beginner", "2026-10-05")?.program.revisions[0]?.source).toBe("preset:beginner");
    expect(presetProgram("nope", "2026-10-05")).toBeNull();
  });

  it("stores bodyweight in kg from either unit", () => {
    expect(bodyweightKgFrom("80", "metric")).toBe(80);
    expect(bodyweightKgFrom("176.4", "imperial")).toBe(80);
    expect(bodyweightKgFrom("", "metric")).toBeUndefined();
    expect(bodyweightKgFrom("-3", "metric")).toBeUndefined();
  });
});
