// The save queue the AppDataProvider drives: one slot per key ("day:<date>",
// "settings", "program"). An edit replaces the slot's job and restarts its
// debounce, so a burst of taps on one day lands as one write while other
// days save on their own clocks. `flush` runs everything at once (on
// pagehide, on coming back online). A save that fails stays queued, with the
// error kept for the status strip, until the next flush or edit of that key.
// No React, no clock reads: only timers, so it is testable with fake timers.

export type SyncState = "synced" | "saving" | "offline";

export interface SyncStatus {
  /** "saving" while anything is queued or in flight; "offline" when that is so and the device is offline. */
  state: SyncState;
  /** Keys not yet confirmed saved (debouncing, failed or in flight). */
  queued: number;
  /** The message of the most recent failure, until a save succeeds. */
  lastError?: string;
}

export type SaveJob = () => Promise<void>;

export interface SaveQueueOptions {
  /** Debounce per key; default SAVE_DELAY_MS. */
  delayMs?: number;
  /** Default: navigator.onLine, true where there is no navigator. */
  isOnline?: () => boolean;
  /** Called whenever the status changes. */
  onChange?: (status: SyncStatus) => void;
}

export interface SaveQueue {
  /** Queue `job` under `key`, replacing any job already waiting there, and restart its debounce. */
  enqueue(key: string, job: SaveJob): void;
  /** Run every queued job now, failed ones included; resolves when all have settled. */
  flush(): Promise<void>;
  /** Drop every queued job without running it (saves in flight complete). */
  cancel(): void;
  /** Re-evaluate the status (after an online/offline event) and report it if it changed. */
  refresh(): void;
  status(): SyncStatus;
  /** Keys not yet confirmed saved. */
  pendingKeys(): string[];
  /** Stop all timers; the queue accepts nothing after this. */
  dispose(): void;
}

export const SAVE_DELAY_MS = 700;

interface Entry {
  job: SaveJob;
  timer: ReturnType<typeof setTimeout> | null;
  failed: boolean;
}

const defaultIsOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createSaveQueue(options: SaveQueueOptions = {}): SaveQueue {
  const delay = options.delayMs ?? SAVE_DELAY_MS;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const pending = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<void>>();
  let lastError: string | undefined;
  let last: SyncStatus | undefined;
  let disposed = false;

  function pendingKeys(): string[] {
    return [...new Set([...pending.keys(), ...inFlight.keys()])];
  }

  function status(): SyncStatus {
    const queued = pendingKeys().length;
    const state: SyncState = queued === 0 ? "synced" : isOnline() ? "saving" : "offline";
    return lastError === undefined ? { state, queued } : { state, queued, lastError };
  }

  function notify(): void {
    const next = status();
    if (last && last.state === next.state && last.queued === next.queued && last.lastError === next.lastError) return;
    last = next;
    options.onChange?.(next);
  }

  async function execute(key: string, entry: Entry): Promise<void> {
    let ok = false;
    try {
      await entry.job();
      ok = true;
      lastError = undefined;
    } catch (err) {
      lastError = describe(err);
    }
    inFlight.delete(key);
    const next = pending.get(key);
    if (!ok) {
      // Keep the work: this job unless a newer edit already replaced it.
      if (!next) pending.set(key, { job: entry.job, timer: null, failed: true });
      else if (next.timer === null) next.failed = true;
    } else if (next && next.timer === null && !next.failed) {
      // An edit landed while this save was in flight: save it now.
      start(key);
    }
    notify();
  }

  /** Run `key`'s queued job now; a key already in flight runs again when that save settles. */
  function start(key: string): void {
    const entry = pending.get(key);
    if (!entry) return;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (inFlight.has(key)) return;
    pending.delete(key);
    // The job is invoked synchronously here, so a synchronous source (the
    // local one) has written before this returns.
    inFlight.set(key, execute(key, entry));
    notify();
  }

  function fire(key: string): void {
    const entry = pending.get(key);
    if (!entry) return;
    entry.timer = null;
    start(key);
  }

  function enqueue(key: string, job: SaveJob): void {
    if (disposed) return;
    const prev = pending.get(key);
    if (prev?.timer !== null && prev?.timer !== undefined) clearTimeout(prev.timer);
    pending.set(key, { job, timer: setTimeout(() => fire(key), delay), failed: false });
    notify();
  }

  async function flush(): Promise<void> {
    for (const entry of pending.values()) entry.failed = false;
    for (;;) {
      for (const key of [...pending.keys()]) start(key);
      if (inFlight.size === 0) return;
      await Promise.all([...inFlight.values()]);
      if (![...pending.values()].some((entry) => !entry.failed)) return;
    }
  }

  function cancel(): void {
    for (const entry of pending.values()) if (entry.timer !== null) clearTimeout(entry.timer);
    pending.clear();
    notify();
  }

  function dispose(): void {
    cancel();
    disposed = true;
  }

  return { enqueue, flush, cancel, refresh: notify, status, pendingKeys, dispose };
}
