import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { CurrentSetComposer, LoggedSets } from "../workout/CurrentSetComposer";
import {
  TRACKING_MODES,
  defaultWeightIncrement,
  firstIncompleteExerciseIndex,
  firstIncompleteSetIndex,
  isExerciseHandled,
  isSessionHandled,
  reconcileExerciseSets,
  resolveTrackingMode,
  validateSet,
} from "../workoutLogging";

describe("V18 Set Flow · shared logging rules", () => {
  it("does not count an empty loaded set as complete", () => {
    const exercise = { name: "Bench Press", sets: 1, reps: 8 };
    const data = { sets: [{ weight: "", reps: "8", done: true }] };
    expect(validateSet(data.sets[0], exercise).valid).toBe(false);
    expect(isExerciseHandled(exercise, data)).toBe(false);
  });

  it("supports bodyweight, timed hold, and carry validation", () => {
    const pushup = { name: "Push-Up", sets: 1, reps: 12 };
    const plank = { name: "Plank", sets: 1, reps: 45 };
    const carry = { name: "Farmer Carry", sets: 1, reps: 40 };
    expect(resolveTrackingMode(pushup)).toBe(TRACKING_MODES.BODYWEIGHT_REPS);
    expect(resolveTrackingMode(plank)).toBe(TRACKING_MODES.TIMED_HOLD);
    expect(resolveTrackingMode(carry)).toBe(TRACKING_MODES.CARRY);
    expect(validateSet({ reps: "12" }, pushup).valid).toBe(true);
    expect(validateSet({ duration: "45" }, plank).valid).toBe(true);
    expect(validateSet({ weight: "80", distance: "40" }, carry).valid).toBe(true);
  });


  it("keeps prescriptions separate from performed values", () => {
    const exercise = { name: "Bench Press", sets: 2, reps: "6–8" };
    const sets = reconcileExerciseSets(exercise, []);
    expect(sets[0].reps).toBe("");
    expect(validateSet({ weight: "185", reps: "6–8" }, exercise).valid).toBe(false);
  });

  it("treats a recorded skip as handled and resumes the first real gap", () => {
    const lifting = [
      { name: "Press", sets: 1, reps: 8 },
      { name: "Row", sets: 1, reps: 8 },
      { name: "Curl", sets: 1, reps: 10 },
    ];
    const workout = { exercises: {
      Press: { skipped: "equipment" },
      Row: { sets: [{ weight: "100", reps: "8", done: true }] },
      Curl: { sets: [{ weight: "", reps: "10", done: false }] },
    } };
    expect(firstIncompleteExerciseIndex(lifting, workout)).toBe(2);
    expect(isSessionHandled(lifting, workout)).toBe(false);
  });

  it("reconciles changed prescriptions without deleting existing work", () => {
    const exercise = { name: "Row", sets: 3, reps: 10 };
    const sets = reconcileExerciseSets(exercise, [{ weight: "100", reps: "10", done: true }]);
    expect(sets).toHaveLength(3);
    expect(sets[0].weight).toBe("100");
    expect(firstIncompleteSetIndex(sets, exercise)).toBe(1);
  });
});

describe("V18 Set Flow · current set composer", () => {
  it("shows the set filled from the set before it, on steppers, with logged sets open to edit", () => {
    const onReplaceSet = vi.fn();
    const onSelect = vi.fn();
    const exercise = { name: "Chest-Supported Row", sets: 2, reps: 8 };
    const sets = [
      { weight: "180", reps: "9", rir: "2", done: true },
      { weight: "", reps: "", rir: "", done: false },
    ];
    const view = render(
      <ThemeProvider>
        <LoggedSets exercise={exercise} sets={sets} onSelect={onSelect} />
        <CurrentSetComposer exercise={exercise} sets={sets} setIndex={1} onReplaceSet={onReplaceSet} lastRaw={null} error="" />
      </ThemeProvider>
    );
    expect(view.getByTestId("current-set-composer")).toBeTruthy();
    expect(view.getByText("Set 2 of 2")).toBeTruthy();
    // Nothing entered yet: the set shows what set 1 was and says so.
    expect(view.getByText("Filled from set 1")).toBeTruthy();
    expect(view.getByRole("radio", { name: /^Set 1 180/ }).getAttribute("aria-checked")).toBe("true");
    expect(view.getByRole("spinbutton", { name: "Weight in pounds" }).value).toBe("180");
    expect(view.getByRole("spinbutton", { name: "Reps" }).value).toBe("9");
    // The first nudge keeps the other number.
    fireEvent.click(view.getByRole("button", { name: "More weight" }));
    expect(onReplaceSet).toHaveBeenLastCalledWith(1, expect.objectContaining({ weight: String(180 + defaultWeightIncrement(exercise)), reps: "9" }));
    // Reps in reserve is the lifter's own report: it does not take the proposal with it.
    fireEvent.click(within(view.getByRole("group", { name: "Reps in reserve (RIR)" })).getByRole("button", { name: "2" }));
    expect(onReplaceSet).toHaveBeenLastCalledWith(1, expect.objectContaining({ rir: "2", weight: "" }));
    // A logged set is one line and opens for edit.
    fireEvent.click(view.getByRole("button", { name: /^Set 1, logged: 180\u00a0lb\u00a0×\u00a09 · RIR\u00a02\. Open to edit\.$/ }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});

describe("V18.2 Set Flow · adaptive target and feedback", () => {
  it("fills from the prescribed target and captures technique feedback without requiring it", () => {
    const onReplaceSet = vi.fn();
    const onAcceptPrescription = vi.fn();
    const view = render(
      <ThemeProvider>
        <CurrentSetComposer
          exercise={{ name: "Incline Dumbbell Press", sets: 3, reps: "8–10" }}
          sets={[{ weight: "", reps: "", rir: "", done: false }, { weight: "", reps: "", rir: "", done: false }, { weight: "", reps: "", rir: "", done: false }]}
          setIndex={0}
          onReplaceSet={onReplaceSet}
          lastRaw={null}
          prescription={{
            kind: "add_load",
            confidence: "high",
            targetWeight: 80,
            targetReps: [8, 8, 8],
            targetSets: 3,
            repRange: { min: 8, max: 10 },
            rationale: "All prior sets reached the upper target cleanly.",
          }}
          onAcceptPrescription={onAcceptPrescription}
          error=""
        />
      </ThemeProvider>
    );
    // This file's renders stay mounted, so look inside this one only.
    const ui = within(view.container);
    expect(ui.getByTestId("progression-prescription")).toBeTruthy();
    expect(ui.getByText("Filled from target")).toBeTruthy();
    expect(ui.getByRole("spinbutton", { name: "Weight in pounds" }).value).toBe("80");
    fireEvent.click(ui.getByRole("radio", { name: /^Target 80/ }));
    expect(onReplaceSet).toHaveBeenCalledWith(0, expect.objectContaining({ weight: "80", reps: "8" }));
    expect(onAcceptPrescription).toHaveBeenCalled();
    // The details are optional and sit behind More.
    expect(ui.queryByText("Clean")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "More: set type, how it felt, pain flag" }));
    fireEvent.click(ui.getByRole("button", { name: "Clean" }));
    expect(onReplaceSet).toHaveBeenCalledWith(0, expect.objectContaining({ quality: "clean" }));
    fireEvent.click(ui.getByRole("switch", { name: "Pain on this set" }));
    expect(onReplaceSet).toHaveBeenCalledWith(0, expect.objectContaining({ pain: true }));
  });
});
