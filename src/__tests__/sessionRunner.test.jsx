// The session runner, mounted: a set done as planned is one tap, logging
// starts the rest timer, and a clinician stop rule pauses logging.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { SessionMode } from "../SessionMode";
import { WORKOUT_PANES_QUERY } from "../ui/useMediaQuery";

const done = (weight, reps, extra = {}) => ({ weight: String(weight), reps: String(reps), rir: "", done: true, ...extra });
const HISTORY = { "2026-07-13": { workout: { exercises: { Bench: { sets: [done(185, 8), done(185, 8)] } } } } };
const LIFTING = [{ name: "Bench", sets: 2, reps: 8 }, { name: "Dip", sets: 1, reps: 10 }];

function setPath(object, keys, value) {
  if (!keys.length) return value;
  const [head, ...rest] = keys;
  return { ...(object || {}), [head]: setPath(object?.[head], rest, value) };
}

function mountRunner({ workout = { exercises: {}, sessionState: {} }, settings = {}, lifting = LIFTING, onClose = vi.fn(), onFinish = vi.fn() } = {}) {
  const updates = vi.fn();
  function Harness() {
    const [state, setState] = useState(workout);
    const onUpdate = (path, value) => { updates(path, value); setState((prev) => setPath(prev, path.split(".").slice(1), value)); };
    return (
      <ThemeProvider>
        <SessionMode open onClose={onClose} onFinish={onFinish} lifting={lifting} workoutData={state} onUpdate={onUpdate} todayKey="2026-07-20" allData={HISTORY} todayName="Monday" settings={settings} sessionLabel="Push" />
      </ThemeProvider>
    );
  }
  const view = render(<Harness />);
  const runner = within(view.container).getByRole("dialog", { name: "Push workout session" });
  return { view, runner, ui: within(runner), updates, onClose, onFinish };
}

describe("the session runner", () => {
  it("logs the frozen recovery-adjusted weight instead of recalculating a heavier target", () => {
    const lift = { ...LIFTING[0], sets: 1, adaptivePrescription: { exerciseName: "Bench", mode: "loaded_reps", kind: "hold_for_quality",
      repRange: { min: 6, max: 8 }, targetSets: 1, targetWeight: 165, targetReps: [6], targetRir: 3, sourceDate: "2026-07-13", rationale: "Lighter targets today." } };
    const { ui, updates } = mountRunner({ lifting: [lift] });
    fireEvent.click(ui.getByRole("button", { name: "Log set" }));
    const [, saved] = updates.mock.calls.findLast(([key]) => key === "workout.exercises.Bench");
    expect(saved.sets).toHaveLength(1);
    expect(saved.sets[0]).toMatchObject({ weight: "165", reps: "6", done: true, progressionTarget: { weight: 165, rir: 3 } });
  });

  it.each([
    [{ name: "Push-Up", sets: 3, repMin: 6, reps: 12, rir: 0, restSeconds: 90 }, "3 × 6–12 reps · 0 reps in reserve · 90 s rest"],
    [{ name: "Side Plank", sets: 2, repMin: 20, reps: 40, restSeconds: 60, notes: "Seconds per side." }, "2 × 20–40 s per side · 60 s rest"],
    [{ name: "Bench", sets: 2, reps: 8 }, "2 × 8 reps"],
  ])("shows the current prescription for $name", (exercise, summary) => {
    const { ui } = mountRunner({ lifting: [exercise] });
    expect(ui.getByText(summary)).toBeTruthy();
  });

  it("keeps the active set, focused draft, rest and edits when the window changes width", () => {
    const medium = Object.assign(new EventTarget(), { matches: false });
    const other = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", (query) => query === WORKOUT_PANES_QUERY ? medium : other);
    const widen = (matches) => act(() => {
      medium.matches = matches;
      medium.dispatchEvent(Object.assign(new Event("change"), { matches }));
    });
    try {
      const { ui, updates } = mountRunner();
      const weight = ui.getByRole("spinbutton", { name: "Weight in pounds" });
      weight.focus();
      fireEvent.change(weight, { target: { value: "190" } });
      widen(true);
      expect(ui.getByRole("complementary", { name: "Session queue" })).toBeTruthy();
      expect(ui.getByRole("spinbutton", { name: "Weight in pounds" })).toBe(weight);
      expect(document.activeElement).toBe(weight);
      expect(weight.value).toBe("190");

      fireEvent.click(ui.getByRole("button", { name: "Log set" }));
      const timer = ui.getByRole("timer");
      const written = updates.mock.calls.length;
      widen(false);
      expect(ui.queryByRole("complementary", { name: "Session queue" })).toBeNull();
      expect(ui.getByRole("timer")).toBe(timer);
      expect(ui.getByRole("button", { name: "Pause" })).toBeTruthy();
      expect(updates.mock.calls.length).toBe(written);

      fireEvent.click(ui.getByRole("button", { name: "Skip rest, start set 2" }));
      fireEvent.click(ui.getByRole("button", { name: /^Set 1, logged/ }));
      const edit = ui.getByRole("button", { name: "Done editing" });
      widen(true);
      expect(ui.getByRole("button", { name: "Done editing" })).toBe(edit);
      expect(ui.getByText("Set 1 of 2")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("protects the lift identity of completed sets when reopening exercise options", () => {
    const lifting = [{ name: "Bench Press", sets: 2, reps: 8 }];
    for (const performedName of [undefined, "Incline Dumbbell Press"]) {
      const workout = { exercises: { "Bench Press": { performedName, sets: [done(135, 8)] } } };
      const { ui, view, updates } = mountRunner({ lifting, workout });
      fireEvent.click(ui.getByRole("button", { name: /^Exercise options/ }));
      const options = within(view.container);
      const swap = options.getByRole("button", { name: performedName ? "Undo swap" : /^Swap exercise/ });
      expect(swap.disabled).toBe(true);
      fireEvent.click(swap);
      expect(updates.mock.calls.some(([path]) => path === "workout.exercises.Bench Press")).toBe(false);
      view.unmount();
    }
  });

  it("logs a set done as planned in one tap, then rests without starting the next set", () => {
    const { ui, updates } = mountRunner();
    expect(ui.getByText("Set 1 of 2")).toBeTruthy();
    // Filled before anything is typed, and the source is named.
    expect(ui.getByRole("spinbutton", { name: "Weight in pounds" }).value).not.toBe("");
    expect(ui.getByText(/^Filled from /)).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Log set" }));
    const [path, saved] = updates.mock.calls.findLast(([p]) => p === "workout.exercises.Bench");
    expect(path).toBe("workout.exercises.Bench");
    expect(saved.sets[0]).toMatchObject({ done: true, reps: "8" });
    expect(Number(saved.sets[0].weight)).toBeGreaterThan(0);
    // Rest: a timer with pause and two ways to extend it; the next set waits for a tap.
    expect(ui.getByRole("timer")).toBeTruthy();
    expect(ui.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(ui.getByRole("button", { name: "Add 15 seconds" })).toBeTruthy();
    expect(ui.getByTestId("rest-glance").textContent).toMatch(/^Next: set 2 of 2/);
    expect(ui.queryByRole("button", { name: "Log set" })).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Skip rest, start set 2" }));
    expect(ui.getByText("Set 2 of 2")).toBeTruthy();
    expect(ui.getByRole("button", { name: "Log set" })).toBeTruthy();
    // The logged set is one line and opens for edit.
    fireEvent.click(ui.getByRole("button", { name: /^Set 1, logged/ }));
    expect(ui.getByText("Logged")).toBeTruthy();
    expect(ui.getByRole("button", { name: "Done editing" })).toBeTruthy();
  });

  it("refuses an empty set with a plain reason", () => {
    // A lift with no history has a rep target and no load to fill from.
    const { ui, updates } = mountRunner({ lifting: [{ name: "Cable Fly", sets: 2, reps: 12 }] });
    expect(ui.getByRole("heading", { name: "Cable Fly" })).toBeTruthy();
    expect(ui.getByRole("spinbutton", { name: "Weight in pounds" }).value).toBe("");
    fireEvent.click(ui.getByRole("button", { name: "Log set" }));
    expect(ui.getByRole("alert").textContent).toBe("Enter the weight before you log this set.");
    expect(updates.mock.calls.some(([path]) => path === "workout.exercises.Cable Fly")).toBe(false);
    // Entering it clears the message.
    fireEvent.change(ui.getByRole("spinbutton", { name: "Weight in pounds" }), { target: { value: "40" } });
    expect(ui.queryByRole("alert")).toBeNull();
  });

  it("finishes to the Box Score only once every exercise is done or skipped", () => {
    const workout = { exercises: { Bench: { sets: [done(185, 8), done(185, 8)] }, Dip: { sets: [done(0, 10)] } }, sessionState: {} };
    const { ui, onClose, onFinish } = mountRunner({ workout });
    fireEvent.click(ui.getByRole("button", { name: "Finish session" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops on a pain flag when clinician guardrails are on, and clears on request", () => {
    const settings = { coachingSystem: { clinicianGuardrails: { enabled: true, stopRules: "Stop for chest pain.", emergencyInstructions: "Call 911." } } };
    const workout = { exercises: { Bench: { sets: [done(185, 8, { pain: true }), { weight: "", reps: "" }] } }, sessionState: {} };
    const { ui, updates, onClose } = mountRunner({ workout, settings });
    expect(ui.getByRole("alert").textContent).toMatch(/Stop here\./);
    expect(ui.getByText("Raised by: pain flagged on set 1 of Bench.")).toBeTruthy();
    expect(ui.getByText("Stop for chest pain.")).toBeTruthy();
    expect(ui.getByText("Call 911.")).toBeTruthy();
    expect(ui.queryByRole("button", { name: "Log set" })).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "That flag was a mistake" }));
    const [, cleared] = updates.mock.calls.findLast(([p]) => p === "workout.exercises.Bench");
    expect(cleared.sets[0].pain).toBe(false);
    expect(ui.queryByRole("alert")).toBeNull();
    expect(ui.getByRole("button", { name: "Log set" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves a pain flag as a note when no guardrails are set", () => {
    const workout = { exercises: { Bench: { sets: [done(185, 8, { pain: true }), { weight: "", reps: "" }] } }, sessionState: {} };
    const { ui } = mountRunner({ workout });
    expect(ui.queryByText("Stop here.")).toBeNull();
    expect(ui.getByRole("button", { name: "Log set" })).toBeTruthy();
  });

  it("adds an exercise for today from the queue, without changing the program", () => {
    const { view, ui, updates } = mountRunner();
    fireEvent.click(ui.getByRole("button", { name: /^Queue/ }));
    const queue = within(view.baseElement).getByRole("dialog", { name: "Queue" });
    fireEvent.click(within(queue).getByRole("button", { name: "Add an exercise" }));
    const sheet = within(view.baseElement).getByRole("dialog", { name: "Add an exercise" });
    fireEvent.change(within(sheet).getByLabelText("Exercise"), { target: { value: "Half-Kneeling Landmine Press" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add “Half-Kneeling Landmine Press”" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Add to today" }));
    expect(updates).toHaveBeenCalledWith("workout.added", [{ name: "Half-Kneeling Landmine Press", sets: 3, reps: 10, session: "main" }]);
    // Back to the queue, where it joins the end.
    expect(within(view.baseElement).getByRole("dialog", { name: "Queue" })).toBeTruthy();
  });
});
