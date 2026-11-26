// src/__tests__/controlHaptics.test.jsx
// In the iPhone app, tabs, switches and segments give a light tap when they
// change, and stay quiet when the runner has turned haptics off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Seg, Switch, TabBar } from "../ui/ledger";
import { setUiHaptics } from "../native";

describe("control haptics in the app", () => {
  let haptic;
  beforeEach(() => {
    haptic = vi.fn(async () => {});
    window.Capacitor = { isNativePlatform: () => true, Plugins: { OTDevice: { haptic } } };
    setUiHaptics(true);
  });
  afterEach(() => {
    cleanup();
    delete window.Capacitor;
    setUiHaptics(true);
  });

  it("taps when the tab changes, not on the current tab", () => {
    const onChange = vi.fn();
    render(<TabBar tabs={["Today", "Train", "Fuel", "Progress"]} current="Today" onChange={onChange} onLog={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(haptic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Train" }));
    expect(haptic).toHaveBeenCalledWith({ kind: "select" });
    expect(onChange).toHaveBeenLastCalledWith("Train");
  });

  it("taps when a switch or a segment changes", () => {
    render(<>
      <Switch checked={false} onChange={vi.fn()} label="Rest audio" />
      <Seg label="Units" options={[{ value: "lb", label: "lb" }, { value: "kg", label: "kg" }]} value="lb" onChange={vi.fn()} />
    </>);
    fireEvent.click(screen.getByRole("switch", { name: "Rest audio" }));
    fireEvent.click(screen.getByRole("radio", { name: "lb" }));
    fireEvent.click(screen.getByRole("radio", { name: "kg" }));
    expect(haptic).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when the runner's haptics are off, and for a disabled switch", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Off one" disabled />);
    fireEvent.click(screen.getByRole("switch", { name: "Off one" }));
    setUiHaptics(false);
    render(<Switch checked={false} onChange={vi.fn()} label="On one" />);
    fireEvent.click(screen.getByRole("switch", { name: "On one" }));
    expect(haptic).not.toHaveBeenCalled();
  });
});
