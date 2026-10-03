// The contract every data source implements: the local (guest) source now,
// the Supabase source later. The app only ever talks to this interface, so
// which one is in use is decided at runtime and nothing above it knows.
//
// A source stores three things: the days (one record per calendar day), the
// program and the settings. `load` returns all of it at once; the save
// methods persist one piece each; `replaceAll` and `clear` swap or drop the
// whole store (import, demo, reset).

import type { DateKey } from "../domain/dates";
import type { DayMap, DayV2 } from "../domain/day/schema";
import type { ProgramPayloadV2 } from "../domain/program/types";
import { DEFAULT_SETTINGS, type SettingsV2 } from "./settings";

export interface Snapshot {
  days: DayMap;
  program: ProgramPayloadV2 | null;
  settings: SettingsV2;
  /**
   * False while older history is still paging in from a remote source; the
   * game withholds records and level-ups until it is true. Always true for
   * the local source.
   */
  historyComplete: boolean;
}

/** What `replaceAll` takes: the data without the load-time flag. */
export type SnapshotData = Omit<Snapshot, "historyComplete">;

export interface DataSource {
  readonly kind: "local" | "supabase";
  load(): Promise<Snapshot>;
  saveDay(dateKey: DateKey, day: DayV2): Promise<void>;
  deleteDay(dateKey: DateKey): Promise<void>;
  saveProgram(program: ProgramPayloadV2 | null): Promise<void>;
  saveSettings(settings: SettingsV2): Promise<void>;
  replaceAll(snapshot: SnapshotData): Promise<void>;
  clear(): Promise<void>;
}

/** Nothing stored yet: no days, no program, default settings. */
export function emptySnapshot(historyComplete = true): Snapshot {
  return { days: {}, program: null, settings: { ...DEFAULT_SETTINGS, profile: {}, session: { ...DEFAULT_SETTINGS.session }, game: {} }, historyComplete };
}
