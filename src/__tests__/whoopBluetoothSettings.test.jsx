import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhoopBluetoothCard } from "../sections/WhoopBluetoothCard";
import { getWhoopBluetooth, setWhoopBluetoothOwner, subscribeWhoopBluetooth } from "../whoop/bluetooth";

const strap = { id: "device-1", name: "WHOOP 4.0 A1B2" };
const idle = { status: "idle", devices: [], device: null, savedDevice: null, lastSample: null, message: null };

function install(initial = idle) {
  let state = initial;
  let owner;
  const listeners = { state: new Set(), sample: new Set() };
  const emit = (event, value) => listeners[event].forEach(listener => listener({ owner, ...value }));
  const update = values => {
    state = { ...state, ...values };
    emit("state", state);
    return { owner, ...state };
  };
  const plugin = {
    setOwner: vi.fn(async payload => {
      if (owner && owner !== payload.owner) state = idle;
      owner = payload.owner;
    }),
    getState: vi.fn(async () => ({ owner, ...state })),
    addListener: vi.fn(async (event, listener) => {
      listeners[event].add(listener);
      return { remove: () => listeners[event].delete(listener) };
    }),
    scan: vi.fn(async () => update({ status: "scanning", devices: [] })),
    stopScan: vi.fn(async () => update({ status: "idle" })),
    connect: vi.fn(async ({ id }) => update({ status: "connecting", device: { ...strap, id } })),
    disconnect: vi.fn(async ({ forget } = {}) => update({ status: "disconnected", device: null, devices: [],
      savedDevice: forget ? null : state.savedDevice, lastSample: null })),
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { WhoopBluetooth: plugin } };
  return { plugin, emit, update, listeners };
}

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await setWhoopBluetoothOwner(null);
  delete window.Capacitor;
});

describe("native WHOOP strap in Integrations", () => {
  it("offers no pairing bridge in a browser, an older shell, or the seeded demo", async () => {
    expect(await setWhoopBluetoothOwner("athlete")).toBeNull();
    expect(getWhoopBluetooth()).toBeNull();
    window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    expect(await setWhoopBluetoothOwner("athlete")).toBeNull();
    expect(getWhoopBluetooth()).toBeNull();
    install();
    vi.stubEnv("VITE_DEMO_MODE", "true");
    expect(await setWhoopBluetoothOwner("athlete")).toBeNull();
    expect(getWhoopBluetooth()).toBeNull();
  });

  it("waits for an explicit scan and choice, shows fresh heart rate and clears it on disconnect", async () => {
    const { plugin, emit, update, listeners } = install();
    await setWhoopBluetoothOwner("athlete");
    const view = render(<WhoopBluetoothCard />);
    await act(async () => {});
    expect(plugin.scan).not.toHaveBeenCalled();
    expect(plugin.connect).not.toHaveBeenCalled();
    const area = within(screen.getByRole("region", { name: "WHOOP Bluetooth" }));
    await act(async () => fireEvent.click(area.getByRole("button", { name: "Find strap" })));
    expect(plugin.scan).toHaveBeenCalledTimes(1);
    expect(area.getByRole("button", { name: "Stop scan" })).toBeTruthy();
    act(() => update({ devices: [strap] }));
    await act(async () => fireEvent.click(area.getByRole("button", { name: "Connect to WHOOP 4.0 A1B2" })));
    expect(plugin.connect).toHaveBeenCalledWith({ id: strap.id, owner: "athlete" });
    expect(area.queryByLabelText("Live heart rate")).toBeNull();
    const sample = { timestamp: Date.now(), bpm: 129, rrMs: [465] };
    act(() => update({ status: "connected", savedDevice: strap, lastSample: sample }));
    expect(area.getByLabelText("Live heart rate").textContent).toBe("129 bpm");
    act(() => emit("sample", { ...sample, bpm: 164 }));
    expect(area.getByLabelText("Live heart rate").textContent).toBe("164 bpm");
    await act(async () => fireEvent.click(area.getByRole("button", { name: "Disconnect strap" })));
    expect(area.queryByLabelText("Live heart rate")).toBeNull();
    expect(area.getByRole("button", { name: "Reconnect strap" })).toBeTruthy();
    await act(async () => fireEvent.click(area.getByRole("button", { name: "Forget strap" })));
    expect(area.queryByRole("button", { name: "Reconnect strap" })).toBeNull();
    view.unmount();
    expect(listeners.state.size + listeners.sample.size).toBe(0);
  });

  it("expires old readings even while the strap is still connected", async () => {
    vi.useFakeTimers();
    const { emit } = install({ ...idle, status: "connected", device: strap,
      lastSample: { timestamp: Date.now() - 60_000, bpm: 88, rrMs: [] } });
    await setWhoopBluetoothOwner("athlete");
    render(<WhoopBluetoothCard />);
    await act(async () => {});
    expect(screen.getByLabelText("Live heart rate").textContent).toMatch(/waiting/i);
    act(() => emit("sample", { timestamp: Date.now(), bpm: 80, rrMs: [] }));
    expect(screen.getByLabelText("Live heart rate").textContent).toBe("80 bpm");
    act(() => vi.advanceTimersByTime(15_001));
    expect(screen.getByLabelText("Live heart rate").textContent).toMatch(/waiting/i);
  });

  it("surfaces Bluetooth permission guidance and leaves Find strap available for retry", async () => {
    const { plugin } = install();
    plugin.scan.mockRejectedValue(new Error("Allow Bluetooth in iPhone Settings."));
    await setWhoopBluetoothOwner("athlete");
    render(<WhoopBluetoothCard />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Find strap" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Allow Bluetooth/);
    expect(screen.getByRole("button", { name: "Find strap" }).disabled).toBe(false);
  });

  it("removes listeners even if the native bridge resolves after unmount", async () => {
    const { plugin } = install();
    const resolve = [];
    const remove = vi.fn();
    plugin.addListener.mockImplementation(() => new Promise(done => resolve.push(done)));
    const onState = vi.fn();
    await setWhoopBluetoothOwner("athlete");
    const unsubscribe = subscribeWhoopBluetooth({ onState, onSample: vi.fn() });
    unsubscribe();
    await act(async () => { for (const done of resolve) done({ remove }); });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(onState).not.toHaveBeenCalled();
    expect(plugin.getState).not.toHaveBeenCalled();
  });

  it("keeps a newer native event when a passive getState reply arrives late", async () => {
    const { plugin, update } = install();
    let deliver;
    plugin.getState.mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
    const onState = vi.fn();
    await setWhoopBluetoothOwner("athlete");
    const unsubscribe = subscribeWhoopBluetooth({ onState });
    await act(async () => {});
    update({ status: "connecting", device: strap });
    await act(async () => deliver({ ...idle, owner: "athlete" }));
    expect(onState.mock.calls.map(([state]) => state.status)).toEqual(["connecting"]);
    unsubscribe();
  });
  it("invalidates old samples, actions and in-flight results as soon as the account switches", async () => {
    const { plugin, emit } = install();
    expect(getWhoopBluetooth()).toBeNull();
    const first = await setWhoopBluetoothOwner("athlete-A");
    const onSample = vi.fn();
    const unsubscribe = subscribeWhoopBluetooth({ onSample });
    let deliver;
    plugin.getState.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    const pending = first.getState();
    const binding = setWhoopBluetoothOwner("athlete-B");
    expect(getWhoopBluetooth()).toBeNull();
    emit("sample", { owner: "athlete-A", bpm: 155 });
    expect(onSample).not.toHaveBeenCalled();
    deliver({ ...idle, owner: "athlete-A", device: strap });
    await expect(pending).rejects.toThrow("account changed");
    const second = await binding;
    await expect(first.scan()).rejects.toThrow("account changed");
    const reading = vi.fn();
    const stop = subscribeWhoopBluetooth({ onSample: reading });
    emit("sample", { owner: "athlete-A", bpm: 130 });
    emit("sample", { owner: "athlete-B", bpm: 115 });
    expect(reading.mock.calls.map(([value]) => value.bpm)).toEqual([115]);
    await second.scan();
    expect(plugin.scan).toHaveBeenCalledWith({ owner: "athlete-B" });
    await setWhoopBluetoothOwner(null);
    expect(getWhoopBluetooth()).toBeNull();
    expect(plugin.setOwner.mock.calls.map(([payload]) => payload.owner)).toEqual(["athlete-A", "athlete-B", null]);
    unsubscribe();
    stop();
  });

  it("keeps a valid binding across token refreshes and serializes overlapping auth changes", async () => {
    const { plugin } = install();
    const first = await setWhoopBluetoothOwner("athlete-A");
    await expect(setWhoopBluetoothOwner("athlete-A")).resolves.toBe(first);
    const logout = setWhoopBluetoothOwner(null);
    const login = setWhoopBluetoothOwner("athlete-B");
    const switchBack = setWhoopBluetoothOwner("athlete-A");
    expect(await logout).toBeNull();
    expect(await login).toBeNull();
    expect((await switchBack).owner).toBe("athlete-A");
    expect(plugin.setOwner.mock.calls.map(([payload]) => payload.owner)).toEqual(["athlete-A", null, "athlete-B", "athlete-A"]);
  });

});
