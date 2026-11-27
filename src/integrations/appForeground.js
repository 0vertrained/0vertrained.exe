import { nativePlugin } from "../native";

export const APP_FOREGROUND_EVENT = "ovt:app-foreground";

// The native signal also covers iOS resuming its web view without changing
// document.visibilityState. Coalesce the native and DOM notifications for a
// single open. A restored connection can wake a previously offline refresh.
export function installAppForegroundSignals() {
  let closed = false;
  let timer;
  let nativeHandle;
  const wake = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      window.dispatchEvent(new Event(APP_FOREGROUND_EVENT));
    }, 150);
  };
  const visible = () => {
    if (document.visibilityState !== "hidden") wake();
  };
  const pageShown = event => { if (event.persisted) visible(); };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("pageshow", pageShown);
  window.addEventListener("online", visible);
  const device = nativePlugin("OTDevice");
  if (device?.addListener) {
    Promise.resolve().then(() => closed ? null : device.addListener("foreground", wake)).then(handle => {
      if (closed) return handle?.remove?.();
      nativeHandle = handle;
    }).catch(() => {});
  }
  return () => {
    closed = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("pageshow", pageShown);
    window.removeEventListener("online", visible);
    Promise.resolve(nativeHandle?.remove?.()).catch(() => {});
  };
}
