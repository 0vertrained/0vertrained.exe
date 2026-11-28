import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LiveLiftMirror from "../watch/LiveLiftMirror";

function setup() {
  let listener;
  const now = Date.now();
  const response = {
    connected: true, receivedAt: now,
    state: {
      cursor: { owner: "a", workoutID: "1", revision: "x", section: "lift", exercise: "Press", index: 0, lastSetID: "prev" },
      display: "Bench press", title: "Upper", total: 3, sampledAt: now / 1000, startedAt: now - 120000, restUntil: now + 45000,
      values: { reps: 8, weight: 100 }, heartRate: 120, next: "Row",
      fields: [{ prop: "weight", label: "Weight in pounds", unit: "lb", max: 1500, step: 2.5 },
        { prop: "reps", label: "Reps", unit: "reps", max: 100, step: 1, required: true }],
    },
  };
  const watch = {
    mirrorStatus: vi.fn(async () => structuredClone(response)), mirrorCommand: vi.fn(async () => {}),
    addListener: vi.fn((_, callback) => { listener = callback; return { remove: vi.fn() }; }),
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTWatch: watch } };
  const view = render(<LiveLiftMirror owner="a" />);
  return { response, watch, change: () => act(async () => { await listener(); }), ...view };
}

afterEach(() => { cleanup(); delete window.Capacitor; });

it("scopes two-way set edits to the displayed workout, preserves drafts across heartbeats and waits for the Watch", async () => {
  const { response, watch, change } = setup();
  fireEvent.click(await screen.findByRole("button", { name: /Live Watch workout/ }));
  expect(screen.getByText("Set 1 of 3")).toBeTruthy();
  expect(screen.getByText("Next exercise · Row")).toBeTruthy();
  const weight = screen.getByLabelText("Weight in pounds");
  fireEvent.change(weight, { target: { value: "107.5" } });
  response.state.heartRate = 132;
  await change();
  expect(weight.value).toBe("107.5");
  fireEvent.click(screen.getByText("Update Watch target"));
  await screen.findByText("Watch target updated.");
  const { owner, payload } = watch.mirrorCommand.mock.calls[0][0];
  expect(owner).toBe("a");
  expect(JSON.parse(payload)).toMatchObject({ action: "setTarget", cursor: response.state.cursor, values: { reps: 8, weight: 107.5 } });
  response.state.values.weight = 107.5;
  response.state.cursor.revision = "y";
  await change();
  expect(screen.queryByText("Update Watch target")).toBeNull();
  fireEvent.click(screen.getByText("Log set on Watch"));
  await screen.findByText("Set logged on Watch.");
  expect(JSON.parse(watch.mirrorCommand.mock.calls[1][0].payload).action).toBe("logSet");
  fireEvent.click(screen.getByText("Undo last set"));
  await screen.findByText("Last set undone.");
  expect(JSON.parse(watch.mirrorCommand.mock.calls[2][0].payload).action).toBe("undo");
});

it("locks edits during motion counting and after signal loss, and hides a previous athlete's session", async () => {
  const { response, change, watch, rerender } = setup();
  fireEvent.click(await screen.findByRole("button", { name: /Live Watch workout/ }));
  response.state.liveReps = 3;
  await change();
  expect(screen.getByText("reps detected")).toBeTruthy();
  expect(screen.getByText("Log set on Watch").disabled).toBe(true);
  response.state.liveReps = null;
  response.receivedAt = Date.now() - 15000;
  await change();
  expect(screen.getByText(/keep logging on your wrist/)).toBeTruthy();
  fireEvent.click(screen.getByText("Undo last set"));
  expect(watch.mirrorCommand).not.toHaveBeenCalled();
  rerender(<LiveLiftMirror owner="b" />);
  await waitFor(() => expect(screen.queryByText("Live Watch workout")).toBeNull());
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("hides the display on the web or when the installed Watch bridge predates mirroring", () => {
  const view = render(<LiveLiftMirror owner="a" />);
  expect(screen.queryByRole("button")).toBeNull();
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTWatch: {} } };
  view.rerender(<LiveLiftMirror owner="a" />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows cardio intervals and rehearsal checkpoints without lifting commands", async () => {
  const { response, change, watch } = setup();
  response.state.cardio = { kind: "cardio", name: "Hill repeats", distanceMeters: 2850, stepLabel: "Hill rep", stepIndex: 3, stepCount: 6, stepTargetSeconds: 120, stepStartedAt: Date.now() - 32_000 };
  await change();
  fireEvent.click(await screen.findByRole("button", { name: /Live Watch workout/ }));
  expect(screen.getByRole("dialog", { name: "Cardio display" })).toBeTruthy();
  expect(screen.getByText("Step 3 of 6")).toBeTruthy();
  expect(screen.getByText("Target duration · 2:00")).toBeTruthy();
  expect(screen.queryByText("Log set on Watch")).toBeNull();
  expect(screen.queryByText("Undo last set")).toBeNull();
  response.state.cardio = { kind: "rehearsal", name: "Creek loop", distanceMeters: 2850, checkpointName: "Water stop", checkpointMeters: 3200, checkpointTargetSeconds: 1080, checkpointInstruction: "Refill flask" };
  await change();
  expect(screen.getByRole("dialog", { name: "Rehearsal display" })).toBeTruthy();
  expect(screen.getByText("0.35 km to checkpoint")).toBeTruthy();
  expect(screen.getByText("Refill flask")).toBeTruthy();
  response.connected = false;
  await change();
  expect(screen.queryByText("0.35 km to checkpoint")).toBeNull();
  expect(watch.mirrorCommand).not.toHaveBeenCalled();
});
