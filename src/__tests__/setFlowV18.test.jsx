import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { CurrentSetComposer } from "../workout/CurrentSetComposer";
import {
  TRACKING_MODES,
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
  it("renders one-thumb controls, RIR chips, and a selectable ledger", () => {
    const onReplaceSet = vi.fn();
    const onBankSet = vi.fn();
    const onSelectSet = vi.fn();
    const exercise = { name: "Chest-Supported Row", sets: 2, reps: 8 };
    const sets = [
      { weight: "180", reps: "9", rir: "2", done: true },
      { weight: "", reps: "8", rir: "", done: false },
    ];
    const view = render(
      <ThemeProvider>
        <CurrentSetComposer
          exercise={exercise}
          sets={sets}
          setIndex={1}
          onSelectSet={onSelectSet}
          onReplaceSet={onReplaceSet}
          onBankSet={onBankSet}
          lastRaw={null}
          error=""
        />
      </ThemeProvider>
    );
    expect(view.getByTestId("current-set-composer")).toBeTruthy();
    expect(view.getByText("Set 2 of 2")).toBeTruthy();
    expect(view.getByText("Repeat set 1")).toBeTruthy();
    expect(view.getByText("Bank set 2")).toBeTruthy();
    fireEvent.click(view.getByText("Repeat set 1"));
    expect(onReplaceSet).toHaveBeenCalled();
    fireEvent.click(view.getByText("Bank set 2"));
    expect(onBankSet).toHaveBeenCalledWith(1);
    fireEvent.click(view.getByText("180 × 9 @2"));
    expect(onSelectSet).toHaveBeenCalledWith(0);
  });
});

describe("V18.2 Set Flow · adaptive target and feedback", () => {
  it("applies a prescribed set target and captures technique feedback without requiring it", () => {
    const onReplaceSet = vi.fn();
    const onAcceptPrescription = vi.fn();
    const view = render(
      <ThemeProvider>
        <CurrentSetComposer
          exercise={{ name: "Incline Dumbbell Press", sets: 3, reps: "8–10" }}
          sets={[{ weight: "", reps: "", rir: "", done: false }, { weight: "", reps: "", rir: "", done: false }, { weight: "", reps: "", rir: "", done: false }]}
          setIndex={0}
          onSelectSet={vi.fn()}
          onReplaceSet={onReplaceSet}
          onBankSet={vi.fn()}
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
    expect(view.getByTestId("progression-prescription")).toBeTruthy();
    fireEvent.click(view.getByText("Use target"));
    expect(onReplaceSet).toHaveBeenCalledWith(0, expect.objectContaining({ weight: "80", reps: "8" }));
    expect(onAcceptPrescription).toHaveBeenCalled();
    fireEvent.click(view.getAllByText("Clean").at(-1));
    expect(onReplaceSet).toHaveBeenCalledWith(0, expect.objectContaining({ quality: "clean" }));
    fireEvent.click(view.getAllByText("Pain").at(-1));
    expect(onReplaceSet).toHaveBeenCalledWith(0, expect.objectContaining({ pain: true }));
  });
});
