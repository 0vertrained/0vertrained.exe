// src/native.js
// What the iPhone app adds to the web app. The app registers its own plugins
// on window.Capacitor.Plugins (ios/App/App/*Plugin.swift); in a browser there
// is no window.Capacitor, and every call here returns false and does nothing.

export function isNativeApp() {
  try {
    return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function nativePlugin(name) {
  if (!isNativeApp()) return null;
  return window.Capacitor?.Plugins?.[name] || null;
}

// Native calls are cues, not work the page waits on: a failure is ignored.
function call(pluginName, method, options) {
  const plugin = nativePlugin(pluginName);
  if (typeof plugin?.[method] !== "function") return false;
  try {
    Promise.resolve(plugin[method](options)).catch(() => {});
  } catch {
    return false;
  }
  return true;
}

// The runner's vibration patterns, read as what they mean: one short pulse
// is a logged set, a long double is the end of a rest, and anything else is
// a set that couldn't be logged.
export function hapticKind(pattern) {
  if (typeof pattern === "number") return "tap";
  if (Array.isArray(pattern) && pattern[0] >= 150) return "done";
  return "error";
}

export function nativeHaptic(pattern) {
  return call("OTDevice", "haptic", { kind: hapticKind(pattern) });
}

// A light tap when a control changes: a tab, a switch, a segment, a step of
// a number. It follows the runner's haptics setting (setUiHaptics), and does
// nothing outside the app. A build without the "select" kind gives its
// usual tap instead.
let uiHaptics = true;

export function setUiHaptics(on) {
  uiHaptics = on !== false;
}

export function selectionHaptic() {
  if (!uiHaptics) return false;
  return call("OTDevice", "haptic", { kind: "select" });
}

export function nativeKeepAwake(on) {
  return call("OTDevice", "keepAwake", { on: Boolean(on) });
}

// A notification at the end of a rest, for when the phone is locked and the
// page's own timer has stopped. Scheduling again replaces the last one.
export function scheduleRestAlert(seconds, { body = "Time for your next set." } = {}) {
  const whole = Math.round(Number(seconds) || 0);
  if (whole < 1) return cancelRestAlert();
  return call("OTRestAlert", "schedule", { seconds: whole, title: "Rest over", body });
}

export function cancelRestAlert() {
  return call("OTRestAlert", "cancel");
}

// The rest as a timer on the Lock Screen and in the Dynamic Island, counting
// down to its end. Shown again, it moves the same timer on.
export function showRestTimer(seconds, next = "") {
  const whole = Math.round(Number(seconds) || 0);
  if (whole < 1) return false;
  return call("OTRestAlert", "showTimer", { seconds: whole, next: String(next || "") });
}

export function hideRestTimer() {
  return call("OTRestAlert", "hideTimer");
}

// Status bar text that reads on the theme's background: dark text on Paper,
// light text on Negative. SystemBars is built into Capacitor.
export function setNativeBarStyle(mode) {
  return call("SystemBars", "setStyle", { style: mode === "dark" ? "DARK" : "LIGHT" });
}
