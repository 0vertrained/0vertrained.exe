// The provider over a MemoryStorage-backed local source: boot, every
// action, the debounced saves, flushing and the sync status.
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDay, type DayV2 } from "../domain/day/schema";
import { threeDayProgram, trainingDay, week } from "../test/gameFixtures";
import { MemoryStorage } from "../test/memoryStorage";
import { AppDataProvider } from "./AppDataProvider";
import type { DataSource } from "./DataSource";
import { createLocalSource } from "./localSource";
import { SAVE_DELAY_MS } from "./saveQueue";
import { DEFAULT_SETTINGS } from "./settings";
import { useAppData, useAppDataState } from "./useAppData";

const KEY = "test";
const DAY = "2026-10-07";
const OTHER = "2026-10-06";

interface StoredEnvelope {
  days: Record<string, DayV2>;
  program: { revisions: unknown[] } | null;
  settings: { units?: string; onboarded?: boolean; bodyweightKg?: number; game?: { title?: string } };
}

function stored(storage: MemoryStorage): StoredEnvelope | null {
  const text = storage.getItem(KEY);
  return text ? (JSON.parse(text) as StoredEnvelope) : null;
}

/** Let the boot promise and any save promises settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount(source: DataSource, strict = false) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    strict ? <StrictMode><AppDataProvider source={source}>{children}</AppDataProvider></StrictMode> : <AppDataProvider source={source}>{children}</AppDataProvider>;
  return renderHook(() => useAppData(), { wrapper });
}

async function ready(storage = new MemoryStorage()) {
  const source = createLocalSource(storage, KEY);
  const hook = mount(source);
  await settle();
  expect(hook.result.current.state.status).toBe("ready");
  return { ...hook, storage, source };
}

const withEnergy = (energy: number) => (day: DayV2): DayV2 => ({ ...day, checkin: { ...day.checkin, energy } });

describe("AppDataProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "onLine");
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("boots to ready with an empty snapshot", async () => {
    const source = createLocalSource(new MemoryStorage(), KEY);
    const { result } = mount(source);
    expect(result.current.state.status).toBe("booting");
    expect(result.current.state.historyComplete).toBe(false);
    await settle();
    expect(result.current.state).toMatchObject({ status: "ready", days: {}, program: null, settings: DEFAULT_SETTINGS, historyComplete: true, sync: { state: "synced", queued: 0 } });
    expect(result.current.state.rev).toBe(1);
  });

  it("boots the stored snapshot, under StrictMode too", async () => {
    const storage = new MemoryStorage();
    const seeded = createLocalSource(storage, KEY);
    await seeded.saveDay(DAY, withEnergy(5)(emptyDay()));
    const load = vi.spyOn(seeded, "load");
    const { result } = mount(seeded, true);
    await settle();
    expect(result.current.state.status).toBe("ready");
    expect(result.current.state.days[DAY]?.checkin.energy).toBe(5);
    expect(load).toHaveBeenCalled();
  });

  it("updateDay creates the day, bumps rev and persists after the debounce", async () => {
    const { result, storage } = await ready();
    const rev = result.current.state.rev;
    act(() => result.current.updateDay(DAY, withEnergy(7)));
    expect(result.current.state.days[DAY]).toEqual({ ...emptyDay(), checkin: { energy: 7 } });
    expect(result.current.state.rev).toBe(rev + 1);
    expect(result.current.state.sync).toEqual({ state: "saving", queued: 1 });
    await elapse(SAVE_DELAY_MS - 1);
    expect(stored(storage)).toBeNull();
    await elapse(1);
    expect(stored(storage)?.days[DAY]?.checkin.energy).toBe(7);
    expect(result.current.state.sync).toEqual({ state: "synced", queued: 0 });
  });

  it("applies back-to-back edits in order and coalesces them into one save per day", async () => {
    const { result, source } = await ready();
    const saveDay = vi.spyOn(source, "saveDay");
    act(() => {
      result.current.updateDay(DAY, withEnergy(3));
      result.current.updateDay(DAY, (d) => ({ ...d, checkin: { ...d.checkin, soreness: 4 } }));
      result.current.updateDay(OTHER, withEnergy(9));
    });
    expect(result.current.state.days[DAY]?.checkin).toEqual({ energy: 3, soreness: 4 });
    expect(result.current.state.sync.queued).toBe(2);
    await elapse(SAVE_DELAY_MS);
    expect(saveDay).toHaveBeenCalledTimes(2);
    expect(saveDay).toHaveBeenCalledWith(DAY, expect.objectContaining({ checkin: { energy: 3, soreness: 4 } }));
    expect(saveDay).toHaveBeenCalledWith(OTHER, expect.objectContaining({ checkin: { energy: 9 } }));
  });

  it("deleteDay removes the day and persists the removal", async () => {
    const { result, storage } = await ready();
    act(() => result.current.updateDay(DAY, withEnergy(7)));
    await elapse(SAVE_DELAY_MS);
    expect(stored(storage)?.days[DAY]).toBeDefined();
    act(() => result.current.deleteDay(DAY));
    expect(result.current.state.days[DAY]).toBeUndefined();
    await elapse(SAVE_DELAY_MS);
    expect(stored(storage)?.days).toEqual({});
  });

  it("patchSettings merges, persists after the debounce and keeps a stable identity", async () => {
    const { result, storage } = await ready();
    const patch = result.current.patchSettings;
    act(() => result.current.patchSettings({ units: "imperial", game: { startedOn: "2026-08-01" } }));
    act(() => result.current.patchSettings({ game: { title: "Initiate" } }));
    expect(result.current.state.settings).toMatchObject({ units: "imperial", game: { startedOn: "2026-08-01", title: "Initiate" } });
    expect(result.current.patchSettings).toBe(patch);
    await elapse(SAVE_DELAY_MS);
    expect(stored(storage)?.settings).toMatchObject({ units: "imperial", game: { startedOn: "2026-08-01", title: "Initiate" } });
  });

  it("replaceSettings swaps the whole document", async () => {
    const { result, storage } = await ready();
    const next = { ...DEFAULT_SETTINGS, onboarded: true, bodyweightKg: 70, profile: { name: "Ana" } };
    act(() => result.current.replaceSettings(next));
    expect(result.current.state.settings).toEqual(next);
    await elapse(SAVE_DELAY_MS);
    expect(stored(storage)?.settings).toEqual(next);
  });

  it("saveProgramRevision appends through the domain and persists", async () => {
    const { result, storage } = await ready();
    const first = week({ Monday: trainingDay("A", [{ id: "squat", name: "Back Squat" }]) });
    const second = week({ Wednesday: trainingDay("B", [{ id: "bench", name: "Barbell Bench Press" }]) });
    act(() => result.current.saveProgramRevision(second, { effectiveFrom: "2026-10-01", source: "custom" }));
    act(() => result.current.saveProgramRevision(first, { effectiveFrom: "2026-09-01", source: "preset:beginner", builderInput: { goal: "strength", daysPerWeek: 3, equipment: "full_gym", experience: "beginner" } }));
    const program = result.current.state.program;
    expect(program?.revisions.map((r) => r.effectiveFrom)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(program?.revisions[0]?.builderInput?.goal).toBe("strength");
    await elapse(SAVE_DELAY_MS);
    expect(stored(storage)?.program?.revisions).toHaveLength(2);
  });

  it("saveProgramRevision rejects an invalid effectiveFrom without touching state", async () => {
    const { result } = await ready();
    const rev = result.current.state.rev;
    expect(() => result.current.saveProgramRevision(week({}), { effectiveFrom: "2026-02-30", source: "custom" })).toThrow(RangeError);
    expect(result.current.state.rev).toBe(rev);
    expect(result.current.state.program).toBeNull();
  });

  it("replaceProgram sets or clears the program", async () => {
    const { result, storage } = await ready();
    const program = threeDayProgram();
    act(() => result.current.replaceProgram(program));
    expect(result.current.state.program).toBe(program);
    await elapse(SAVE_DELAY_MS);
    expect(stored(storage)?.program?.revisions).toHaveLength(1);
    act(() => result.current.replaceProgram(null));
    await elapse(SAVE_DELAY_MS);
    expect(stored(storage)?.program).toBeNull();
  });

  it("seedDemo populates the demo character and marks the athlete onboarded", async () => {
    const { result, storage } = await ready();
    await act(async () => {
      await result.current.seedDemo("2026-10-07");
    });
    const { state } = result.current;
    expect(state.status).toBe("ready");
    expect(Object.keys(state.days)).toHaveLength(69);
    expect(state.days["2026-10-07"]?.quest?.tier).toBe("REDUCED");
    expect(state.program?.revisions[0]?.source).toBe("preset:beginner");
    expect(state.settings).toMatchObject({ onboarded: true, bodyweightKg: 80, units: "metric", game: { title: "Initiate", bodyweightKg: 80 } });
    expect(state.settings.game.startedOn).toBe("2026-07-30"); // ten weeks ending today
    expect(state.sync).toEqual({ state: "synced", queued: 0 });
    const envelope = stored(storage);
    expect(Object.keys(envelope?.days ?? {})).toHaveLength(69);
    expect(envelope?.settings).toMatchObject({ onboarded: true, bodyweightKg: 80 });
  });

  it("reset wipes the source and starts empty", async () => {
    const { result, storage } = await ready();
    await act(async () => {
      await result.current.seedDemo("2026-10-07");
    });
    act(() => result.current.updateDay(DAY, withEnergy(1)));
    await act(async () => {
      await result.current.reset();
    });
    expect(storage.getItem(KEY)).toBeNull();
    expect(result.current.state).toMatchObject({ status: "ready", days: {}, program: null, settings: DEFAULT_SETTINGS, historyComplete: true });
    await elapse(SAVE_DELAY_MS);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("leaves status error with the message, and writes nothing, when the load fails", async () => {
    const storage = new MemoryStorage();
    const source: DataSource = { ...createLocalSource(storage, KEY), load: () => Promise.reject(new Error("boom")) };
    const { result } = mount(source);
    await settle();
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.error).toBe("boom");
    expect(result.current.state.days).toEqual({});
    expect(result.current.state.program).toBeNull();
    await elapse(SAVE_DELAY_MS);
    expect(storage.keys()).toEqual([]);
  });

  it("flushes pending saves when the page is hidden or unloaded", async () => {
    const { result, storage } = await ready();
    act(() => result.current.updateDay(DAY, withEnergy(7)));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(stored(storage)?.days[DAY]?.checkin.energy).toBe(7);

    act(() => result.current.updateDay(OTHER, withEnergy(2)));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(stored(storage)?.days[OTHER]?.checkin.energy).toBe(2);
    await settle();
    expect(result.current.state.sync).toEqual({ state: "synced", queued: 0 });
  });

  it("flushes pending saves on unmount", async () => {
    const { result, storage, unmount } = await ready();
    act(() => result.current.updateDay(DAY, withEnergy(7)));
    unmount();
    expect(stored(storage)?.days[DAY]?.checkin.energy).toBe(7);
  });

  it("keeps a failed save queued as offline and retries when the device comes back online", async () => {
    const { result, storage, source } = await ready();
    const saveDay = vi.spyOn(source, "saveDay").mockRejectedValueOnce(new Error("Failed to fetch"));
    let online = false;
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
    act(() => result.current.updateDay(DAY, withEnergy(7)));
    await elapse(SAVE_DELAY_MS);
    expect(saveDay).toHaveBeenCalledTimes(1);
    expect(result.current.state.sync).toEqual({ state: "offline", queued: 1, lastError: "Failed to fetch" });
    expect(stored(storage)).toBeNull();
    online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    expect(saveDay).toHaveBeenCalledTimes(2);
    expect(stored(storage)?.days[DAY]?.checkin.energy).toBe(7);
    expect(result.current.state.sync).toEqual({ state: "synced", queued: 0 });
  });

  it("re-evaluates the status on the offline event", async () => {
    const { result } = await ready();
    act(() => result.current.updateDay(DAY, withEnergy(7)));
    expect(result.current.state.sync.state).toBe("saving");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.state.sync.state).toBe("offline");
  });

  it("exportSnapshot returns the current data and importSnapshot replaces it", async () => {
    const { result, storage } = await ready();
    act(() => result.current.updateDay(OTHER, withEnergy(4)));
    const day = withEnergy(8)(emptyDay());
    const program = threeDayProgram();
    const settings = { ...DEFAULT_SETTINGS, onboarded: true, units: "imperial" as const };
    await act(async () => {
      await result.current.importSnapshot({ days: { [DAY]: day }, program, settings });
    });
    expect(result.current.state.days).toEqual({ [DAY]: day });
    expect(result.current.state.program).toEqual(program);
    expect(result.current.state.settings).toEqual(settings);
    expect(result.current.exportSnapshot()).toEqual({ days: { [DAY]: day }, program, settings, historyComplete: true });
    expect(Object.keys(stored(storage)?.days ?? {})).toEqual([DAY]);
    // The edit queued before the import was dropped, not written over the import.
    await elapse(SAVE_DELAY_MS);
    expect(Object.keys(stored(storage)?.days ?? {})).toEqual([DAY]);
  });

  it("importSnapshot rejects and leaves state unchanged when the source cannot write", async () => {
    const { result, source } = await ready();
    vi.spyOn(source, "replaceAll").mockRejectedValueOnce(new Error("full"));
    const before = result.current.state;
    await expect(result.current.importSnapshot({ days: {}, program: null, settings: DEFAULT_SETTINGS })).rejects.toThrow("full");
    expect(result.current.state).toBe(before);
  });

  it("useAppDataState serves just the state", async () => {
    const source = createLocalSource(new MemoryStorage(), KEY);
    const wrapper = ({ children }: { children: ReactNode }) => <AppDataProvider source={source}>{children}</AppDataProvider>;
    const { result } = renderHook(() => useAppDataState(), { wrapper });
    await settle();
    expect(result.current.status).toBe("ready");
    expect("updateDay" in result.current).toBe(false);
  });

  it("useAppData throws outside the provider", () => {
    // React re-throws through a DOM event in development; keep jsdom from reporting it as uncaught.
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener("error", swallow);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useAppData())).toThrow(/AppDataProvider/);
    } finally {
      error.mockRestore();
      window.removeEventListener("error", swallow);
    }
  });
});
