// The app-data context and its hooks: what every screen reads (days,
// program, settings, sync status) and the actions that change it. The
// provider that fills it lives in AppDataProvider.tsx; tests can supply
// their own value through AppDataContext.

import { createContext, useContext } from "react";
import type { DateKey } from "../domain/dates";
import type { DayMap, DayV2 } from "../domain/day/schema";
import type { BuilderInput, ProgramPayloadV2, ProgramWeek } from "../domain/program/types";
import type { Snapshot, SnapshotData } from "./DataSource";
import type { SyncStatus } from "./saveQueue";
import type { DeepPartial, SettingsV2 } from "./settings";

export type AppDataStatus = "booting" | "ready" | "error";

export interface AppDataState {
  /** "booting" until the source has loaded; "error" when it could not (the data is then not usable). */
  status: AppDataStatus;
  days: DayMap;
  program: ProgramPayloadV2 | null;
  settings: SettingsV2;
  /** False while a remote source is still paging older history in. */
  historyComplete: boolean;
  sync: SyncStatus;
  /** Bumps on every data change, for memoised derivations. */
  rev: number;
  /** The load failure, when status is "error". */
  error?: string;
}

export interface RevisionOptions {
  effectiveFrom: DateKey;
  /** 'preset:<id>' | 'generator' | 'custom' | 'imported' */
  source: string;
  builderInput?: BuilderInput;
}

export interface AppDataActions {
  /** Edit one day: `fn` gets the stored day (or an empty one) and returns the new one. Saved after a short debounce. */
  updateDay(dateKey: DateKey, fn: (day: DayV2) => DayV2): void;
  deleteDay(dateKey: DateKey): void;
  /** Deep-partial patch of the settings; nested objects merge, arrays replace, `undefined` clears. */
  patchSettings(patch: DeepPartial<SettingsV2>): void;
  replaceSettings(settings: SettingsV2): void;
  /** Record `week` as the plan from `options.effectiveFrom` on. Throws RangeError on an invalid date key. */
  saveProgramRevision(week: ProgramWeek, options: RevisionOptions): void;
  replaceProgram(program: ProgramPayloadV2 | null): void;
  /** Replace everything stored with `snapshot` (an import). Rejects, leaving state unchanged, if the source cannot write. */
  importSnapshot(snapshot: SnapshotData): Promise<void>;
  /** The current data, for export. */
  exportSnapshot(): Snapshot;
  /** Wipe the source and start empty. */
  reset(): Promise<void>;
  /** Load the demo character for `todayKey` (replaces everything). */
  seedDemo(todayKey: DateKey): Promise<void>;
}

/** What the context serves: the state under `state`, the actions alongside (stable identities). */
export type AppDataValue = AppDataActions & { state: AppDataState };

export const AppDataContext = createContext<AppDataValue | null>(null);

/** The data (`state`) and the actions. Must be used inside <AppDataProvider>. */
export function useAppData(): AppDataValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside <AppDataProvider>.");
  return value;
}

/** Just the state, for screens that only display. */
export function useAppDataState(): AppDataState {
  return useAppData().state;
}
