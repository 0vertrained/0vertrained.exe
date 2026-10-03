// The save queue, driven by fake timers: debounce and coalescing per key,
// flushing, failures that stay queued, and the status it reports.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_DELAY_MS, createSaveQueue, type SyncStatus } from "./saveQueue";

const ok = () => vi.fn(async () => {});

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("saveQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a job once the debounce elapses, then reports synced", async () => {
    const queue = createSaveQueue();
    const job = ok();
    queue.enqueue("a", job);
    expect(queue.status()).toEqual({ state: "saving", queued: 1 });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(job).toHaveBeenCalledTimes(1);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
    expect(queue.pendingKeys()).toEqual([]);
  });

  it("honours a custom delay", async () => {
    const queue = createSaveQueue({ delayMs: 50 });
    const job = ok();
    queue.enqueue("a", job);
    await vi.advanceTimersByTimeAsync(50);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("coalesces edits of one key into the last job, timed from the last edit", async () => {
    const queue = createSaveQueue();
    const [j1, j2, j3] = [ok(), ok(), ok()];
    queue.enqueue("a", j1);
    await vi.advanceTimersByTimeAsync(300);
    queue.enqueue("a", j2);
    await vi.advanceTimersByTimeAsync(300);
    queue.enqueue("a", j3);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(j1).not.toHaveBeenCalled();
    expect(j2).not.toHaveBeenCalled();
    expect(j3).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(j1).not.toHaveBeenCalled();
    expect(j2).not.toHaveBeenCalled();
    expect(j3).toHaveBeenCalledTimes(1);
  });

  it("saves different keys on their own clocks", async () => {
    const queue = createSaveQueue();
    const [a, b] = [ok(), ok()];
    queue.enqueue("a", a);
    await vi.advanceTimersByTimeAsync(300);
    queue.enqueue("b", b);
    expect(queue.status()).toEqual({ state: "saving", queued: 2 });
    await vi.advanceTimersByTimeAsync(400);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("invokes the job synchronously when its timer fires or on flush, so a synchronous source has written", () => {
    const queue = createSaveQueue();
    let written = 0;
    queue.enqueue("a", () => {
      written += 1;
      return Promise.resolve();
    });
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(written).toBe(1);
    queue.enqueue("b", () => {
      written += 1;
      return Promise.resolve();
    });
    void queue.flush();
    expect(written).toBe(2);
  });

  it("flush runs everything queued at once and clears the timers", async () => {
    const queue = createSaveQueue();
    const [a, b] = [ok(), ok()];
    queue.enqueue("a", a);
    queue.enqueue("b", b);
    await queue.flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("resolves flush at once when nothing is queued", async () => {
    await expect(createSaveQueue().flush()).resolves.toBeUndefined();
  });

  it("keeps a failed save queued with its error, does not retry on its own, and retries on flush", async () => {
    const queue = createSaveQueue();
    const job = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    queue.enqueue("a", job);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(job).toHaveBeenCalledTimes(1);
    expect(queue.status()).toEqual({ state: "saving", queued: 1, lastError: "boom" });
    expect(queue.pendingKeys()).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 10);
    expect(job).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect(job).toHaveBeenCalledTimes(2);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
  });

  it("stops retrying within one flush once a job fails again", async () => {
    const queue = createSaveQueue();
    const job = vi.fn(async () => {
      throw new Error("still down");
    });
    queue.enqueue("a", job);
    await queue.flush();
    expect(job).toHaveBeenCalledTimes(1);
    expect(queue.status()).toMatchObject({ queued: 1, lastError: "still down" });
  });

  it("reports offline while work is queued and the device is offline, and saving again once online", async () => {
    let online = false;
    const queue = createSaveQueue({ isOnline: () => online });
    const job = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(undefined);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
    queue.enqueue("a", job);
    expect(queue.status()).toEqual({ state: "offline", queued: 1 });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(queue.status()).toEqual({ state: "offline", queued: 1, lastError: "Failed to fetch" });
    online = true;
    const changes: SyncStatus[] = [];
    const watched = createSaveQueue({ isOnline: () => online, onChange: (s) => changes.push(s) });
    watched.refresh();
    expect(changes).toEqual([{ state: "synced", queued: 0 }]);
    await queue.flush();
    expect(job).toHaveBeenCalledTimes(2);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
  });

  it("lets a newer edit replace a failed job instead of retrying the old one", async () => {
    const queue = createSaveQueue();
    const j1 = vi.fn(async () => {
      throw new Error("boom");
    });
    const j2 = ok();
    queue.enqueue("a", j1);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(queue.status()).toMatchObject({ queued: 1, lastError: "boom" });
    queue.enqueue("a", j2);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(j1).toHaveBeenCalledTimes(1);
    expect(j2).toHaveBeenCalledTimes(1);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
  });

  it("runs an edit made during an in-flight save after that save settles, never overlapping", async () => {
    const queue = createSaveQueue();
    const first = deferred();
    const j1 = vi.fn(() => first.promise);
    const j2 = ok();
    queue.enqueue("a", j1);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(j1).toHaveBeenCalledTimes(1);
    queue.enqueue("a", j2);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(j2).not.toHaveBeenCalled();
    expect(queue.status()).toEqual({ state: "saving", queued: 1 });
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(j2).toHaveBeenCalledTimes(1);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
  });

  it("marks an edit made during a save that then fails as failed, so a flush picks it up", async () => {
    const queue = createSaveQueue();
    const first = deferred();
    const j1 = vi.fn(() => first.promise);
    const j2 = ok();
    queue.enqueue("a", j1);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    queue.enqueue("a", j2);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    first.reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);
    expect(j2).not.toHaveBeenCalled();
    expect(queue.status()).toEqual({ state: "saving", queued: 1, lastError: "boom" });
    await queue.flush();
    expect(j2).toHaveBeenCalledTimes(1);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
  });

  it("flush waits for a save already in flight", async () => {
    const queue = createSaveQueue();
    const first = deferred();
    queue.enqueue("a", () => first.promise);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    let done = false;
    const flushing = queue.flush().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    first.resolve();
    await flushing;
    expect(done).toBe(true);
  });

  it("reports each status change once", async () => {
    const changes: SyncStatus[] = [];
    const queue = createSaveQueue({ onChange: (s) => changes.push(s) });
    queue.enqueue("a", ok());
    queue.enqueue("a", ok());
    queue.enqueue("b", ok());
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(changes).toEqual([
      { state: "saving", queued: 1 },
      { state: "saving", queued: 2 },
      { state: "saving", queued: 1 },
      { state: "synced", queued: 0 },
    ]);
  });

  it("cancel drops queued work and dispose stops accepting more", async () => {
    const queue = createSaveQueue();
    const job = ok();
    queue.enqueue("a", job);
    queue.cancel();
    expect(queue.pendingKeys()).toEqual([]);
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(job).not.toHaveBeenCalled();
    queue.dispose();
    queue.enqueue("a", job);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(job).not.toHaveBeenCalled();
    expect(queue.status()).toEqual({ state: "synced", queued: 0 });
  });

  it("treats a job that throws synchronously like a rejected one", async () => {
    const queue = createSaveQueue();
    queue.enqueue("a", () => {
      throw new Error("sync boom");
    });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(queue.status()).toEqual({ state: "saving", queued: 1, lastError: "sync boom" });
  });
});
