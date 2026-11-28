import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QualifiedIncline } from "./ClimbEquipment";
import { armTreadmill, disarmTreadmill, requestTreadmillIncline } from "./hardware";

vi.mock("./hardware", async (original) => ({
  ...await original(),
  armTreadmill: vi.fn(async () => ({})),
  disarmTreadmill: vi.fn(async () => ({})),
  requestTreadmillIncline: vi.fn(async () => ({})),
}));

const props = () => ({
  owner:"athlete", recordingId:"session", target:8, cap:10, confirm:vi.fn(async () => true),
  reading:{inclineFollowerVersion:1,controlStage:"manual"},
});
afterEach(() => {cleanup(); vi.clearAllMocks(); vi.useRealTimers();});

it("keeps older native shells on manual incline", () => {
  render(<QualifiedIncline {...props()} reading={{controlStage:"manual"}} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(armTreadmill).not.toHaveBeenCalled();
});

it("renews sustained grades and replaces a target while the deck is settling", async () => {
  vi.useFakeTimers();
  const setup = props();
  const view = render(<QualifiedIncline {...setup} />);
  await act(async () => {fireEvent.click(screen.getByRole("button",{name:"Enable auto incline"}));});
  expect(armTreadmill).toHaveBeenCalledTimes(1);
  const live = {inclineFollowerVersion:1,armToken:"generation",controlStage:"armed"};
  view.rerender(<QualifiedIncline {...setup} reading={live} />);
  await act(async () => {vi.advanceTimersByTime(4000);});
  view.rerender(<QualifiedIncline {...setup} reading={{...live,controlStage:"settling"}} target={14} />);
  expect(requestTreadmillIncline.mock.calls.map(([{grade,sequence}]) => [grade,sequence]))
    .toEqual([[8,1],[8,2],[8,3],[10,4]]);
  view.unmount();
  expect(disarmTreadmill).toHaveBeenCalledTimes(1);
  await act(async () => {vi.advanceTimersByTime(10_000);});
  expect(requestTreadmillIncline).toHaveBeenCalledTimes(4);
});

it("ignores a delayed consent result after pausing or leaving the workout", async () => {
  let respond;
  const confirm = () => new Promise(resolve => { respond = resolve; });
  const view = render(<QualifiedIncline {...props()} confirm={confirm} />);
  fireEvent.click(screen.getByRole("button",{name:"Enable auto incline"}));
  view.unmount();
  await act(async () => { respond(true); });
  expect(armTreadmill).not.toHaveBeenCalled();
  expect(requestTreadmillIncline).not.toHaveBeenCalled();
});
