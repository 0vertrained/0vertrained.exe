// Health permissions belong to this iPhone. Each signed-in athlete controls
// whether 0VERTRAINED uses those permissions for their own training log.
// The same first pairing owns Watch events from builds without account IDs.
const LEGACY_OWNER = "0vt.watch.legacyOwner.v1";
const unsaved = new Map();

export function deviceHealthKey(key, owner) {
  if (!owner) return key;
  try {
    let first = localStorage.getItem(LEGACY_OWNER);
    if (!first) {
      first = owner;
      localStorage.setItem(LEGACY_OWNER, first);
    }
    if (first === owner) return key;
  } catch { /* Use a separate in-memory preference for this athlete. */ }
  return key + ".athlete." + owner;
}

export function readDeviceToggle(key, owner) {
  const scoped = deviceHealthKey(key, owner);
  if (unsaved.has(scoped)) return unsaved.get(scoped);
  try { return localStorage.getItem(scoped) === "1"; } catch { return false; }
}

export function writeDeviceToggle(key, owner, on, event) {
  const scoped = deviceHealthKey(key, owner);
  try {
    if (on) localStorage.setItem(scoped, "1");
    else localStorage.removeItem(scoped);
    unsaved.delete(scoped);
  } catch { unsaved.set(scoped, Boolean(on)); }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
}
