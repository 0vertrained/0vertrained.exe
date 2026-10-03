// The one place app data lives at runtime. On mount it loads a snapshot from
// the given DataSource; every action updates the in-memory state through a
// pure reducer and queues a debounced save of just the piece that changed
// (one slot per day, one for settings, one for the program). Saves are
// flushed when the page is hidden or unloaded and retried when the device
// comes back online; the queue's status feeds the status strip. Nothing
// here knows which source it is talking to.

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { isDateKey, type DateKey } from "../domain/dates";
import { normalizeDay } from "../domain/day/normalize";
import { emptyDay, type DayMap, type DayV2 } from "../domain/day/schema";
import { normalizeProgramPayload } from "../domain/program/normalize";
import { appendRevision } from "../domain/program/revisions";
import type { ProgramPayloadV2, ProgramWeek } from "../domain/program/types";
import { emptySnapshot, type DataSource, type Snapshot, type SnapshotData } from "./DataSource";
import { createSaveQueue, type SyncStatus } from "./saveQueue";
import { DEFAULT_SETTINGS, normalizeSettings, patchSettings, type DeepPartial, type SettingsV2 } from "./settings";
import { AppDataContext, type AppDataActions, type AppDataState, type AppDataValue, type RevisionOptions } from "./useAppData";

export { AppDataContext } from "./useAppData";

export type AppDataAction =
  | { type: "loaded"; snapshot: Snapshot }
  | { type: "loadFailed"; error: string }
  | { type: "updateDay"; dateKey: DateKey; fn: (day: DayV2) => DayV2 }
  | { type: "deleteDay"; dateKey: DateKey }
  | { type: "patchSettings"; patch: DeepPartial<SettingsV2> }
  | { type: "replaceSettings"; settings: SettingsV2 }
  | { type: "appendRevision"; week: ProgramWeek; options: RevisionOptions }
  | { type: "replaceProgram"; program: ProgramPayloadV2 | null }
  | { type: "replaceAll"; snapshot: Snapshot }
  | { type: "sync"; sync: SyncStatus };

export function initialState(): AppDataState {
  const empty = emptySnapshot(false);
  return { status: "booting", days: empty.days, program: empty.program, settings: empty.settings, historyComplete: false, sync: { state: "synced", queued: 0 }, rev: 0 };
}

function ready(state: AppDataState, snapshot: Snapshot): AppDataState {
  // Dropping `error` on purpose: the data is usable again.
  const { error: _error, ...rest } = state;
  return { ...rest, status: "ready", ...snapshot, rev: state.rev + 1 };
}

const sameSync = (a: SyncStatus, b: SyncStatus): boolean => a.state === b.state && a.queued === b.queued && a.lastError === b.lastError;

/** Pure: the next state for an action. Exported for tests. */
export function reduce(state: AppDataState, action: AppDataAction): AppDataState {
  switch (action.type) {
    case "loaded":
    case "replaceAll":
      return ready(state, action.snapshot);
    case "loadFailed":
      return { ...state, status: "error", error: action.error };
    case "updateDay": {
      const day = action.fn(state.days[action.dateKey] ?? emptyDay());
      return { ...state, days: { ...state.days, [action.dateKey]: day }, rev: state.rev + 1 };
    }
    case "deleteDay": {
      if (!(action.dateKey in state.days)) return state;
      const days = { ...state.days };
      delete days[action.dateKey];
      return { ...state, days, rev: state.rev + 1 };
    }
    case "patchSettings":
      return { ...state, settings: patchSettings(state.settings, action.patch), rev: state.rev + 1 };
    case "replaceSettings":
      return { ...state, settings: action.settings, rev: state.rev + 1 };
    case "appendRevision":
      return { ...state, program: appendRevision(state.program, action.week, action.options), rev: state.rev + 1 };
    case "replaceProgram":
      return { ...state, program: action.program, rev: state.rev + 1 };
    case "sync":
      return sameSync(state.sync, action.sync) ? state : { ...state, sync: action.sync };
  }
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const dayKey = (dateKey: DateKey): string => `day:${dateKey}`;
const SETTINGS_KEY = "settings";
const PROGRAM_KEY = "program";

/** An imported snapshot read through the same boundaries as a stored one. */
function cleanSnapshot(snapshot: SnapshotData): Snapshot {
  const days: DayMap = {};
  for (const [key, value] of Object.entries(snapshot.days)) if (isDateKey(key)) days[key] = normalizeDay(value);
  return { days, program: normalizeProgramPayload(snapshot.program), settings: normalizeSettings(snapshot.settings), historyComplete: true };
}

export interface AppDataProviderProps {
  source: DataSource;
  children?: ReactNode;
}

/**
 * Loads from `source` on mount and serves the data and actions to the tree.
 * To switch sources (guest → signed in), remount with a different `key`
 * rather than changing the prop, so the old source's saves settle first.
 */
export function AppDataProvider({ source, children }: AppDataProviderProps) {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);

  // The latest committed state and source, read by actions and save jobs at
  // call time (never during render), so back-to-back actions see each other.
  const stateRef = useRef(state);
  const sourceRef = useRef(source);
  useLayoutEffect(() => {
    stateRef.current = state;
    sourceRef.current = source;
  });

  const queue = useMemo(() => createSaveQueue({ onChange: (sync) => dispatch({ type: "sync", sync }) }), []);

  useEffect(() => {
    let cancelled = false;
    source.load().then(
      (snapshot) => {
        if (!cancelled) dispatch({ type: "loaded", snapshot });
      },
      (err: unknown) => {
        if (!cancelled) dispatch({ type: "loadFailed", error: describe(err) });
      },
    );
    const flush = () => {
      void queue.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const refresh = () => queue.refresh();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", flush);
    window.addEventListener("offline", refresh);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", refresh);
      flush();
    };
  }, [source, queue]);

  const actions = useMemo<AppDataActions>(() => {
    const read = (): AppDataState => stateRef.current;
    const actions: AppDataActions = {
      updateDay(dateKey, fn) {
        dispatch({ type: "updateDay", dateKey, fn });
        const target = sourceRef.current;
        queue.enqueue(dayKey(dateKey), () => {
          const day = read().days[dateKey];
          return day ? target.saveDay(dateKey, day) : Promise.resolve();
        });
      },
      deleteDay(dateKey) {
        dispatch({ type: "deleteDay", dateKey });
        const target = sourceRef.current;
        queue.enqueue(dayKey(dateKey), () => target.deleteDay(dateKey));
      },
      patchSettings(patch) {
        dispatch({ type: "patchSettings", patch });
        const target = sourceRef.current;
        queue.enqueue(SETTINGS_KEY, () => target.saveSettings(read().settings));
      },
      replaceSettings(settings) {
        dispatch({ type: "replaceSettings", settings });
        const target = sourceRef.current;
        queue.enqueue(SETTINGS_KEY, () => target.saveSettings(read().settings));
      },
      saveProgramRevision(week, options) {
        if (!isDateKey(options.effectiveFrom)) throw new RangeError(`Invalid effectiveFrom: ${String(options.effectiveFrom)}`);
        dispatch({ type: "appendRevision", week, options });
        const target = sourceRef.current;
        queue.enqueue(PROGRAM_KEY, () => target.saveProgram(read().program));
      },
      replaceProgram(program) {
        dispatch({ type: "replaceProgram", program });
        const target = sourceRef.current;
        queue.enqueue(PROGRAM_KEY, () => target.saveProgram(read().program));
      },
      async importSnapshot(snapshot) {
        const clean = cleanSnapshot(snapshot);
        queue.cancel();
        await sourceRef.current.replaceAll(clean);
        dispatch({ type: "replaceAll", snapshot: clean });
      },
      exportSnapshot() {
        const { days, program, settings, historyComplete } = read();
        return { days, program, settings, historyComplete };
      },
      async reset() {
        queue.cancel();
        await sourceRef.current.clear();
        dispatch({ type: "replaceAll", snapshot: emptySnapshot(true) });
      },
      async seedDemo(todayKey) {
        const { seed, DEMO_BODYWEIGHT_KG } = await import("./demo/seed");
        const demo = seed(todayKey);
        await actions.importSnapshot({
          days: demo.days,
          program: demo.program,
          settings: { ...DEFAULT_SETTINGS, onboarded: true, bodyweightKg: DEMO_BODYWEIGHT_KG, game: demo.settings },
        });
      },
    };
    return actions;
  }, [queue]);

  const value = useMemo<AppDataValue>(() => ({ ...actions, state }), [state, actions]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
