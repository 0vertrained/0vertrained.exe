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

/**
 * Set by the create-account form just before it calls sign-up, so the data
 * root can tell a brand-new account from a sign-in by the time the session
 * arrives (which is before sign-up itself resolves: the recovery hash is
 * derived after the session exists). Session-scoped: one tab, one sign-up.
 */
export const JUST_SIGNED_UP_KEY = "ovt-v20-just-signed-up";

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export function markJustSignedUp(storage: Storage | null = session()): void {
  if (storage) write(storage, JUST_SIGNED_UP_KEY, true);
}
export function isJustSignedUp(storage: Storage | null = session()): boolean {
  return storage ? read(storage, JUST_SIGNED_UP_KEY) : false;
}
export function clearJustSignedUp(storage: Storage | null = session()): void {
  if (storage) write(storage, JUST_SIGNED_UP_KEY, false);
}
