// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { APP_FOREGROUND_EVENT, installAppForegroundSignals } from "../integrations/appForeground";
import { useAppIntegrationSync } from "../integrations/useAppIntegrationSync";
import { syncCloudOnOpen } from "../integrations/cloudSync";

vi.mock("../integrations/cloudSync", () => ({ syncCloudOnOpen: vi.fn() }));

afterEach(() => {
  delete window.Capacitor;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("returning to 0vertrained", () => {
  it("coalesces native activation, a visible web view and a network return, and removes each listener", async () => {
    vi.useFakeTimers();
    let nativeOpen;
    const remove = vi.fn();
    window.Capacitor = { isNativePlatform: () => true, Plugins: { OTDevice: {
      addListener: async (_, listener) => { nativeOpen = listener; return { remove }; },
    } } };
    const opened = vi.fn();
    window.addEventListener(APP_FOREGROUND_EVENT, opened);
    const stop = installAppForegroundSignals();
    try {
      await vi.advanceTimersByTimeAsync(0);
      nativeOpen();
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(250);
      expect(opened).toHaveBeenCalledTimes(1);
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(250);
      expect(opened).toHaveBeenCalledTimes(1);
      nativeOpen(); // UIKit can precede WebKit's visibility signal.
      await vi.advanceTimersByTimeAsync(250);
      expect(opened).toHaveBeenCalledTimes(2);
      nativeOpen();
      stop();
      await vi.advanceTimersByTimeAsync(250);
      expect(remove).toHaveBeenCalledOnce();
      expect(opened).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener(APP_FOREGROUND_EVENT, opened); }
  });

  it("waits for the athlete and network, refreshes mounted views after import, and honors a quiet cooldown", async () => {
    const network = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    syncCloudOnOpen.mockResolvedValueOnce({ oura: "synced", strava: "retry" }).mockResolvedValue({});
    const hook = renderHook(({ ready }) => useAppIntegrationSync({ owner: "A", ready }), { initialProps: { ready: false } });
    hook.rerender({ ready: true });
    expect(syncCloudOnOpen).not.toHaveBeenCalled();
    network.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await waitFor(() => expect(hook.result.current).toBe(1));
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await waitFor(() => expect(syncCloudOnOpen).toHaveBeenCalledTimes(2));
    expect(hook.result.current).toBe(1);
    hook.unmount();
  });

  it("refreshes mounted connection indicators once when a connected provider unlinks", async () => {
    syncCloudOnOpen.mockResolvedValueOnce({ strava: "fresh" }).mockResolvedValue({ strava: "disconnected" });
    const hook = renderHook(() => useAppIntegrationSync({ owner: "A", ready: true }));
    await waitFor(() => expect(hook.result.current).toBe(1));
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await waitFor(() => expect(hook.result.current).toBe(2));
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    await waitFor(() => expect(syncCloudOnOpen).toHaveBeenCalledTimes(3));
    expect(hook.result.current).toBe(2);
    hook.unmount();
  });

  it("ignores the previous account's late reply after an account switch", async () => {
    let finishA;
    syncCloudOnOpen.mockImplementation(({ owner }) => owner === "A" ? new Promise(resolve => { finishA = resolve; }) : Promise.resolve({}));
    const hook = renderHook(({ owner }) => useAppIntegrationSync({ owner, ready: true }), { initialProps: { owner: "A" } });
    await waitFor(() => expect(finishA).toBeDefined());
    const { signal } = syncCloudOnOpen.mock.calls[0][0];
    hook.rerender({ owner: "B" });
    expect(signal.aborted).toBe(true);
    await act(async () => finishA({ whoop: "synced" }));
    await waitFor(() => expect(syncCloudOnOpen).toHaveBeenCalledTimes(2));
    expect(hook.result.current).toBe(0);
    hook.unmount();
  });
});
