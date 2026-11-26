// src/__tests__/native.test.js
// The iPhone app's plugins are reached through window.Capacitor. In a
// browser every helper does nothing and reports false; in the app the
// runner's cues go to the phone's haptics, keep-awake and rest alerts.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabaseClient", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import {
  cancelRestAlert,
  hapticKind,
  isNativeApp,
  nativeHaptic,
  nativeKeepAwake,
  hideRestTimer,
  scheduleRestAlert,
  selectionHaptic,
  setNativeBarStyle,
  setUiHaptics,
  showRestTimer,
} from "../native";
import { triggerHaptic } from "../sessionDevice";
import { pushSupportState } from "../push";

function installApp(overrides = {}) {
  const plugins = {
    OTDevice: { haptic: vi.fn(async () => {}), keepAwake: vi.fn(async () => {}) },
    OTRestAlert: {
      schedule: vi.fn(async () => ({ scheduled: true })),
      cancel: vi.fn(async () => {}),
      showTimer: vi.fn(async () => {}),
      hideTimer: vi.fn(async () => {}),
    },
    SystemBars: { setStyle: vi.fn(async () => {}) },
    ...overrides,
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: plugins };
  return plugins;
}

afterEach(() => {
  delete window.Capacitor;
  vi.restoreAllMocks();
});

describe("in a browser", () => {
  it("is not the app, and every helper is a no-op", () => {
    expect(isNativeApp()).toBe(false);
    expect(nativeHaptic(10)).toBe(false);
    expect(nativeKeepAwake(true)).toBe(false);
    expect(scheduleRestAlert(90)).toBe(false);
    expect(cancelRestAlert()).toBe(false);
    expect(setNativeBarStyle("dark")).toBe(false);
    expect(showRestTimer(90, "Set 2")).toBe(false);
    expect(hideRestTimer()).toBe(false);
    expect(selectionHaptic()).toBe(false);
  });

  it("still vibrates where the browser can", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    expect(triggerHaptic(10)).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(10);
    delete navigator.vibrate;
  });

  it("treats a page that only looks like the app as a browser", () => {
    window.Capacitor = { isNativePlatform: () => false, Plugins: { OTDevice: { haptic: vi.fn() } } };
    expect(isNativeApp()).toBe(false);
    expect(nativeHaptic(10)).toBe(false);
  });
});

describe("in the iPhone app", () => {
  it("reads the runner's patterns as what they mean", () => {
    expect(hapticKind(10)).toBe("tap");
    expect(hapticKind([200, 100, 200])).toBe("done");
    expect(hapticKind([80, 40, 80])).toBe("error");
    expect(hapticKind([100, 60, 100])).toBe("error");
  });

  it("sends the runner's haptics to the phone", () => {
    const plugins = installApp();
    expect(triggerHaptic([200, 100, 200])).toBe(true);
    expect(plugins.OTDevice.haptic).toHaveBeenCalledWith({ kind: "done" });
    expect(triggerHaptic(10, false)).toBe(false);
    expect(plugins.OTDevice.haptic).toHaveBeenCalledTimes(1);
  });

  it("keeps the screen on and lets it go", () => {
    const plugins = installApp();
    nativeKeepAwake(true);
    nativeKeepAwake(false);
    expect(plugins.OTDevice.keepAwake.mock.calls).toEqual([[{ on: true }], [{ on: false }]]);
  });

  it("schedules the rest alert in whole seconds and cancels a rest already over", () => {
    const plugins = installApp();
    expect(scheduleRestAlert(89.6, { body: "Next: set 2 of 3" })).toBe(true);
    expect(plugins.OTRestAlert.schedule).toHaveBeenCalledWith({ seconds: 90, title: "Rest over", body: "Next: set 2 of 3" });
    scheduleRestAlert(0.2);
    expect(plugins.OTRestAlert.cancel).toHaveBeenCalledTimes(1);
  });

  it("gives a light tap when a control changes, unless the runner's haptics are off", () => {
    const plugins = installApp();
    expect(selectionHaptic()).toBe(true);
    expect(plugins.OTDevice.haptic).toHaveBeenCalledWith({ kind: "select" });
    setUiHaptics(false);
    expect(selectionHaptic()).toBe(false);
    setUiHaptics(true);
    expect(plugins.OTDevice.haptic).toHaveBeenCalledTimes(1);
  });

  it("puts the rest on the Lock Screen in whole seconds, and takes it off", () => {
    const plugins = installApp();
    expect(showRestTimer(89.6, "Bench Press · Set 2")).toBe(true);
    expect(plugins.OTRestAlert.showTimer).toHaveBeenCalledWith({ seconds: 90, next: "Bench Press · Set 2" });
    expect(showRestTimer(0.3)).toBe(false);
    expect(plugins.OTRestAlert.showTimer).toHaveBeenCalledTimes(1);
    expect(hideRestTimer()).toBe(true);
    expect(plugins.OTRestAlert.hideTimer).toHaveBeenCalledTimes(1);
  });

  it("leaves the Lock Screen alone in an app build without the timer", () => {
    installApp({ OTRestAlert: { schedule: vi.fn(async () => ({})), cancel: vi.fn(async () => {}) } });
    expect(showRestTimer(90)).toBe(false);
    expect(hideRestTimer()).toBe(false);
  });

  it("matches the status bar to the theme", () => {
    const plugins = installApp();
    setNativeBarStyle("dark");
    setNativeBarStyle("light");
    expect(plugins.SystemBars.setStyle.mock.calls).toEqual([[{ style: "DARK" }], [{ style: "LIGHT" }]]);
  });

  it("shrugs off a plugin that fails or is missing", async () => {
    installApp({ OTDevice: { haptic: vi.fn(async () => { throw new Error("no engine"); }) } });
    expect(nativeHaptic(10)).toBe(true);
    expect(nativeKeepAwake(true)).toBe(false);
    await Promise.resolve();
  });

  it("says plainly that the app doesn't send reminders", () => {
    installApp();
    const state = pushSupportState();
    expect(state.supported).toBe(false);
    expect(state.reason).toMatch(/iPhone app doesn't send reminders/);
    expect(state.reason).not.toMatch(/Share →/);
  });
});
