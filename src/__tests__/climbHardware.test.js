import { afterEach, expect, it, vi } from "vitest";
import {
  armTreadmill, climbHardwareAvailable, connectTreadmill, disconnectTreadmill, disarmTreadmill,
  getTreadmill, healthRoutesAvailable, importHealthRoute, listHealthRoutes, requestTreadmillIncline,
  scanTreadmills, subscribeTreadmill,
} from "../climb/hardware";

afterEach(() => { delete window.Capacitor; });

it("supports web and older shells with manual cues", async () => {
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTRuns: { recentRuns: vi.fn() } } };
  expect(climbHardwareAvailable()).toBe(false);
  expect(healthRoutesAvailable()).toBe(false);
  expect(await getTreadmill()).toMatchObject({ status: "unavailable", autoIncline: false, fresh: false });
  expect(await scanTreadmills()).toMatchObject({ devices: [] });
  await expect(connectTreadmill("belt")).rejects.toThrow(/updated iPhone/);
  await expect(listHealthRoutes("a")).rejects.toThrow(/updated iPhone/);
  const stopListening = await subscribeTreadmill(vi.fn());
  stopListening();
});

it("uses explicit health reads, the selected device, and detachable live notifications", async () => {
  const remove = vi.fn(async () => {});
  const belt = {
    status: vi.fn(async () => ({ status: "idle" })), scan: vi.fn(), connect: vi.fn(),
    disconnect: vi.fn(), addListener: vi.fn(async () => ({ remove })),
    arm: vi.fn(), requestIncline: vi.fn(), disarm: vi.fn(),
  };
  const runs = {
    climbRouteList: vi.fn(async () => ({ runs: [{ id: "run" }] })),
    climbRoute: vi.fn(async () => ({ gpx: "<gpx/>" })),
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTClimb: belt, OTRuns: runs } };
  expect(climbHardwareAvailable()).toBe(true);
  expect(healthRoutesAvailable()).toBe(true);
  const listener = vi.fn();
  const detach = await subscribeTreadmill(listener);
  expect(belt.addListener).toHaveBeenCalledWith("treadmillState", listener);
  expect(runs.climbRouteList).not.toHaveBeenCalled();
  expect(belt.scan).not.toHaveBeenCalled();
  await scanTreadmills();
  await scanTreadmills("peloton");
  expect(belt.scan.mock.calls).toEqual([[], [{ mode: "peloton" }]]);
  expect(belt.connect).not.toHaveBeenCalled();
  expect(belt.arm).not.toHaveBeenCalled();
  expect(belt.requestIncline).not.toHaveBeenCalled();
  await connectTreadmill("AA");
  expect(belt.connect).toHaveBeenCalledWith({ id: "AA" });
  await expect(listHealthRoutes("athlete")).resolves.toEqual([{ id: "run" }]);
  await listHealthRoutes("athlete", "2025-09-20");
  expect(runs.climbRouteList).toHaveBeenCalledWith({ owner: "athlete", nearDate: "2025-09-20" });
  await expect(importHealthRoute("run", "athlete")).resolves.toBe("<gpx/>");
  expect(runs.climbRoute).toHaveBeenCalledWith({ id: "run", owner: "athlete" });
  const consent = { owner: "a", recordingId: "r", capPercent: 4, confirmed: true };
  const intent = { owner: "a", recordingId: "r", armToken: "generation", grade: 3 };
  await armTreadmill(consent);
  await requestTreadmillIncline(intent);
  expect(belt.arm).toHaveBeenCalledWith(consent);
  expect(belt.requestIncline).toHaveBeenCalledWith(intent);
  detach();
  await disarmTreadmill();
  await disconnectTreadmill();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(belt.disarm).toHaveBeenCalledTimes(1);
  await disconnectTreadmill({ forget: true });
  expect(belt.disconnect.mock.calls).toEqual([[], [{ forget: true }]]);
});
