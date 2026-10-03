// Two small localStorage flags that outlive a page load: "upload the guest
// data on the next sign-in" and "this guest is the demo character" (never
// uploaded). Kept apart from the carry-over so the guest bundle stays small.
export const GUEST_UPLOAD_PENDING_KEY = "ovt-v20-guest-upload-pending";
export const GUEST_DEMO_KEY = "ovt-v20-guest-demo";

function read(storage: Storage, key: string): boolean {
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(storage: Storage, key: string, on: boolean): void {
  try {
    if (on) storage.setItem(key, "1");
    else storage.removeItem(key);
  } catch {
    // storage is a nicety
  }
}

export function markGuestUploadPending(storage: Storage = window.localStorage): void {
  write(storage, GUEST_UPLOAD_PENDING_KEY, true);
}
export function isGuestUploadPending(storage: Storage = window.localStorage): boolean {
  return read(storage, GUEST_UPLOAD_PENDING_KEY);
}
export function clearGuestUploadPending(storage: Storage = window.localStorage): void {
  write(storage, GUEST_UPLOAD_PENDING_KEY, false);
}
export function markDemo(storage: Storage = window.localStorage): void {
  write(storage, GUEST_DEMO_KEY, true);
}
export function isDemo(storage: Storage = window.localStorage): boolean {
  return read(storage, GUEST_DEMO_KEY);
}
export function clearDemo(storage: Storage = window.localStorage): void {
  write(storage, GUEST_DEMO_KEY, false);
}
