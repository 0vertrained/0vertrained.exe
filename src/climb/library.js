// Keep precise tracks on the device. Each course revision is written once and
// the frequently updated recording journal only references its revision.
const database = "0vertrained-climbs-v1";
const storeName = "records";
let opening;

const driverKey = database + "-driver";
function storedDriver() {
  try { return localStorage.getItem(driverKey); } catch { return null; }
}

function openDatabase() {
  const driver = storedDriver();
  if (driver === "local") return Promise.resolve(null);
  if (!driver) {
    // Earlier versions wrote directly to localStorage without marking the
    // driver when IndexedDB was unavailable.
    try {
      if (Object.keys(localStorage).some(key => key.startsWith("ot.climb/"))) {
        try { localStorage.setItem(driverKey, "local"); } catch { /* still readable when full */ }
        return Promise.resolve(null);
      }
    } catch { /* IndexedDB can be available with localStorage disabled. */ }
  }
  if (typeof indexedDB === "undefined") return driver === "indexedDB"
    ? Promise.reject(new Error("Your climb database is temporarily unavailable."))
    : Promise.resolve(null);
  if (!opening) opening = new Promise((resolve, reject) => {
    let decision = false;
    const timeout = setTimeout(() => unavailable(new Error("Climb storage did not open in time.")), 4500);
    function unavailable(error) {
      if (decision) return;
      decision = true; clearTimeout(timeout);
      // Preserve access to existing IndexedDB data on temporary failure.
      // An empty installation can select localStorage and stick to that driver.
      if (storedDriver() === "indexedDB") { opening = null; reject(error); return; }
      try { localStorage.setItem(driverKey, "local"); resolve(null); }
      catch { opening = null; reject(error); }
    }
    let req;
    try { req = indexedDB.open(database, 1); } catch (e) { unavailable(e); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(storeName);
    req.onsuccess = () => {
      const db = req.result;
      if (decision) { db.close(); return; }
      decision = true; clearTimeout(timeout);
      try { localStorage.setItem(driverKey, "indexedDB"); } catch { /* The database itself is writable. */ }
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => unavailable(req.error || new Error("Climb storage is unavailable."));
  }).catch(error => { opening = null; throw error; });
  return opening;
}

function scope(owner) {
  if (!owner || typeof owner !== "string") throw new Error("Open Race the Climb after your account loads.");
  return "ot.climb/" + encodeURIComponent(owner) + "/";
}

async function readAll(owner) {
  const prefix = scope(owner);
  const db = await openDatabase();
  if (!db) {
    return Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => [key.slice(prefix.length), JSON.parse(localStorage.getItem(key))]);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const rows = [];
    const cursor = tx.objectStore(storeName).openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (item) { rows.push([item.key.slice(prefix.length), item.value]); item.continue(); }
    };
    tx.oncomplete = () => resolve(rows);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("Could not open the climb library."));
  });
}

export async function readClimbLibrary(owner) {
  const rows = await readAll(owner);
  const courses = new Map(), results = [], checks = [], active = rows.find(([key]) => key === "active")?.[1];
  for (const [key, value] of rows) {
    if (key.startsWith("course/") && value?.revision) courses.set(value.revision, value);
    if (value?.version === 1 && key === "check/" + value.id && Array.isArray(value.samples)) checks.push(value);
    if (key.startsWith("result/") && value?.run?.owner === owner) results.push(value);
  }
  const recover = row => {
    const course = row?.course || courses.get(row?.revision);
    return row?.run?.owner === owner && course ? { ...row, course } : null;
  };
  const restored = recover(active);
  if (restored?.previousAttempts) {
    restored.previousAttempts = restored.previousAttempts.map(recover);
    if (restored.previousAttempts.some(row => !row)) throw new Error("A course needed to recover this workout is missing.");
  }
  return { courses: [...courses.values()], results, checks: checks.sort((a,b) => b.startedAt - a.startedAt), active: restored };

}

export function packActiveClimb(value, journalToken) {
  const compact = row => {
    const { course, ...rest } = row;
    return { ...rest, revision: course.revision };
  };
  return { ...compact(value), journalToken,
    ...(value.previousAttempts && { previousAttempts: value.previousAttempts.map(compact) }) };
}

const tokenOf = row => row?.journalToken ?? row?.run?.id ?? null;
const conflict = () => new Error("This climb was updated in another window. Reopen Race the Climb to load the latest workout.");

export async function changeClimbLibrary(owner, changes, expectedToken) {
  const prefix = scope(owner);
  const db = await openDatabase();
  const removed = new Set(changes.filter(([key, value]) => key.startsWith("course/") && value == null)
    .map(([key]) => key.slice("course/".length)));
  const mustCheck = expectedToken !== undefined || removed.size > 0;
  const checkJournal = current => {
    if (expectedToken !== undefined && tokenOf(current) !== expectedToken) throw conflict();
    if (removed.size === 0) return;
    const replacement = changes.findLast(([key]) => key === "active");
    const active = replacement ? replacement[1] : current;
    if (active && [active, ...(active.previousAttempts || [])].some(row => removed.has(row.revision ?? row.course?.revision))) {
      throw new Error("Finish the active climb before removing a course it uses.");
    }
  };
  if (!db) {
    if (mustCheck) checkJournal(JSON.parse(localStorage.getItem(prefix + "active")));
    const applied = [];
    try {
      for (const [key, value] of changes) {
        const path = prefix + key;
        const old = changes.length > 1 ? localStorage.getItem(path) : null;
        if (value == null) localStorage.removeItem(path);
        else localStorage.setItem(path, JSON.stringify(value));
        if (changes.length > 1) applied.push([path, old]);
      }
    } catch (error) {
      for (const [path, old] of applied.reverse()) {
        if (old === null) localStorage.removeItem(path);
        else localStorage.setItem(path, old);
      }
      throw error;
    }
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite"), store = tx.objectStore(storeName);
    let cause;
    const apply = journal => {
      try {
        if (mustCheck) checkJournal(journal);
        for (const [key, value] of changes) {
          if (value == null) store.delete(prefix + key);
          else store.put(value, prefix + key);
        }
      } catch (error) {
        cause = error;
        tx.abort();
      }
    };
    if (!mustCheck) apply();
    else {
      const current = store.get(prefix + "active");
      current.onsuccess = () => apply(current.result);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(cause || tx.error || new Error("Could not save the climb on this device."));
  });
}
