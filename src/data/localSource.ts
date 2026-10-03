// The guest data source: everything in one JSON envelope in localStorage.
//
// Writes are synchronous under the hood (the promise only carries the
// outcome), so a flush on pagehide really lands before the page goes. A
// corrupt envelope is never thrown away: the text moves to `<key>.corrupt`
// and the app opens empty, so the data can still be recovered by hand. A
// full device rejects with a plain-words error the UI can show.

import { isDateKey } from "../domain/dates";
import { normalizeDay } from "../domain/day/normalize";
import type { DayMap, DayV2 } from "../domain/day/schema";
import { normalizeProgramPayload } from "../domain/program/normalize";
import type { ProgramPayloadV2 } from "../domain/program/types";
import { emptySnapshot, type DataSource, type Snapshot, type SnapshotData } from "./DataSource";
import { normalizeSettings, type SettingsV2 } from "./settings";

export const LOCAL_STORAGE_KEY = "ovt-v20-guest";
export const ENVELOPE_VERSION = 1;
export const CORRUPT_SUFFIX = ".corrupt";
export const STORAGE_FULL_MESSAGE = "This device's storage is full, so the last change could not be saved. Free some space or sign in to keep your progress online.";

interface Envelope {
  v: typeof ENVELOPE_VERSION;
  /** ISO timestamp of the last write, for support and future migrations. */
  savedAt: string;
  days: Record<string, unknown>;
  program: unknown;
  settings: unknown;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The browser's "storage full" signal, in its modern and legacy spellings. */
export function isQuotaError(err: unknown): boolean {
  if (!isObj(err)) return false;
  const name = err.name;
  const code = err.code;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

function parseEnvelope(text: string): Envelope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.v !== ENVELOPE_VERSION || !isObj(raw.days)) return null;
  return {
    v: ENVELOPE_VERSION,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    days: raw.days,
    program: raw.program ?? null,
    settings: raw.settings,
  };
}

function toSnapshot(envelope: Envelope | null): Snapshot {
  if (!envelope) return emptySnapshot(true);
  const days: DayMap = {};
  for (const [key, value] of Object.entries(envelope.days)) {
    if (isDateKey(key)) days[key] = normalizeDay(value);
  }
  return {
    days,
    program: normalizeProgramPayload(envelope.program),
    settings: normalizeSettings(envelope.settings),
    historyComplete: true,
  };
}

export function createLocalSource(storage: Storage = window.localStorage, key: string = LOCAL_STORAGE_KEY): DataSource {
  const corruptKey = `${key}${CORRUPT_SUFFIX}`;

  /** The stored envelope, or null when there is none or it cannot be read. */
  function read(): Envelope | null {
    const text = storage.getItem(key);
    if (text === null) return null;
    const envelope = parseEnvelope(text);
    if (!envelope) {
      try {
        storage.setItem(corruptKey, text);
      } catch {
        // Keeping the corrupt copy is best effort; the app must still open.
      }
    }
    return envelope;
  }

  function write(envelope: Omit<Envelope, "v" | "savedAt">): void {
    const full: Envelope = { v: ENVELOPE_VERSION, savedAt: new Date().toISOString(), ...envelope };
    try {
      storage.setItem(key, JSON.stringify(full));
    } catch (err) {
      if (isQuotaError(err)) throw new Error(STORAGE_FULL_MESSAGE, { cause: err });
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  function current(): Omit<Envelope, "v" | "savedAt"> {
    const envelope = read();
    return envelope ? { days: envelope.days, program: envelope.program, settings: envelope.settings } : { days: {}, program: null, settings: undefined };
  }

  return {
    kind: "local",

    async load(): Promise<Snapshot> {
      return toSnapshot(read());
    },

    async saveDay(dateKey: string, day: DayV2): Promise<void> {
      const envelope = current();
      write({ ...envelope, days: { ...envelope.days, [dateKey]: day } });
    },

    async deleteDay(dateKey: string): Promise<void> {
      const envelope = current();
      if (!(dateKey in envelope.days)) return;
      const days = { ...envelope.days };
      delete days[dateKey];
      write({ ...envelope, days });
    },

    async saveProgram(program: ProgramPayloadV2 | null): Promise<void> {
      write({ ...current(), program });
    },

    async saveSettings(settings: SettingsV2): Promise<void> {
      write({ ...current(), settings });
    },

    async replaceAll(snapshot: SnapshotData): Promise<void> {
      write({ days: snapshot.days, program: snapshot.program, settings: snapshot.settings });
    },

    async clear(): Promise<void> {
      // The corrupt stash (if any) stays: it exists so nothing is lost silently.
      storage.removeItem(key);
    },
  };
}
