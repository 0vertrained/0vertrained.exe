// The session runner, mounted: a set done as planned is one tap, logging
// starts the rest timer, and a clinician stop rule pauses logging.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { SessionMode } from "../SessionMode";

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
});
