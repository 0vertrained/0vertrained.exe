// v19.2.1 · Data-safety hotfixes. Settings and program are written as whole
// payloads, so a failed read must never turn into a default that later
// overwrites the athlete's real data. Also covers the full-backup envelope.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  settingsResult: null,
  programResult: null,
  entriesPages: [],
  updates: [],
  upserts: [],
};

vi.mock("../supabaseClient", () => {
  function makeQuery(table) {
    const q = {};
    q.select = () => q;
    q.eq = () => q;
    q.order = () => q;
    q.range = (from) => {
      const page = db.entriesPages[Math.floor(from / 1000)];
      if (page instanceof Error) return Promise.resolve({ data: null, error: { message: page.message } });
      return Promise.resolve({ data: page || [], error: null });
    };
    q.single = () => Promise.resolve(table === "profiles" ? db.settingsResult : db.programResult);
    q.update = (patch) => {
      db.updates.push({ table, patch });
      return { eq: () => Promise.resolve({ error: null }) };
    };
    q.upsert = (row) => {
      db.upserts.push({ table, row });
      return Promise.resolve({ error: null });
    };
    return q;
  }
  return { supabase: { from: (table) => makeQuery(table), auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } } };
});

import {
  BACKUP_FORMAT,
  buildBackupEnvelope,
  entriesFromImport,
  loadBackupSnapshot,
  loadProgram,
  loadSettings,
  programLoadFailed,
  saveProgram,
  saveSettings,
  setCachedUserId,
} from "../data";

const okProfile = { data: { settings: { onboarded: true, goals: { protein: 180 } }, username: "athlete" }, error: null };
const networkError = { data: null, error: { code: "08006", message: "connection failure" } };
const noRow = { data: null, error: { code: "PGRST116", message: "no rows" } };

beforeEach(() => {
  db.settingsResult = okProfile;
  db.programResult = { data: { payload: { Monday: { type: "lift" } } }, error: null };
  db.entriesPages = [];
  db.updates = [];
  db.upserts = [];
  setCachedUserId("user-1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("settings: a failed read never becomes a default write", () => {
  it("returns null (not defaults) when the server read fails", async () => {
    db.settingsResult = networkError;
    expect(await loadSettings()).toBeNull();
  });

  it("refuses a whole-blob save until a read has succeeded", async () => {
    db.settingsResult = networkError;
    await loadSettings();
    const res = await saveSettings({ onboarded: false });
    expect(res.error).toMatch(/haven't loaded/);
    expect(db.updates).toHaveLength(0);
  });

  it("saves normally after a successful read", async () => {
    const loaded = await loadSettings();
    expect(loaded.goals.protein).toBe(180);
    expect(loaded.username).toBe("athlete");
    expect(await saveSettings({ ...loaded, theme: "whitepaperDark" })).toEqual({ ok: true });
    expect(db.updates).toHaveLength(1);
  });

  it("a later failed read blocks saves again", async () => {
    await loadSettings();
    db.settingsResult = networkError;
    await loadSettings();
    expect((await saveSettings({})).error).toBeTruthy();
  });
});

describe("program: 'no program yet' is not an error, a failed read is", () => {
  it("treats PGRST116 (no row) as a loaded, empty program", async () => {
    db.programResult = noRow;
    expect(await loadProgram()).toBeNull();
    expect(programLoadFailed("user-1")).toBe(false);
    expect(await saveProgram({ Monday: {} })).toEqual({ ok: true });
  });

  it("flags a real failure and blocks program saves", async () => {
    db.programResult = networkError;
    expect(await loadProgram()).toBeNull();
    expect(programLoadFailed("user-1")).toBe(true);
    const res = await saveProgram({ Monday: {} });
    expect(res.error).toMatch(/hasn't loaded/);
    expect(db.upserts).toHaveLength(0);
  });

  it("recovers once a read succeeds", async () => {
    db.programResult = networkError;
    await loadProgram();
    db.programResult = { data: { payload: { Monday: { type: "lift" } } }, error: null };
    expect(await loadProgram()).toEqual({ Monday: { type: "lift" } });
    expect(programLoadFailed("user-1")).toBe(false);
    expect(await saveProgram({ Monday: {} })).toEqual({ ok: true });
  });
});

describe("full backup", () => {
  it("reads every entry page plus program and settings", async () => {
    const page = (start, count) => Array.from({ length: count }, (_, i) => ({
      entry_date: `2025-01-${String(((start + i) % 28) + 1).padStart(2, "0")}-${start + i}`,
      payload: { n: start + i },
    }));
    db.entriesPages = [page(0, 1000), page(1000, 3)];
    const snap = await loadBackupSnapshot();
    expect(snap.ok).toBe(true);
    expect(Object.keys(snap.entries)).toHaveLength(1003);
    expect(snap.program).toEqual({ Monday: { type: "lift" } });
    expect(snap.settings.goals.protein).toBe(180);
    expect(snap.username).toBe("athlete");
  });

  it("fails instead of returning a partial backup when a page errors", async () => {
    db.entriesPages = [[{ entry_date: "2025-01-01", payload: {} }], new Error("timeout")];
    db.entriesPages[0] = Array.from({ length: 1000 }, (_, i) => ({ entry_date: `d${i}`, payload: {} }));
    const snap = await loadBackupSnapshot();
    expect(snap.ok).toBeUndefined();
    expect(snap.error).toBe("timeout");
  });

  it("allows a missing program row", async () => {
    db.programResult = noRow;
    const snap = await loadBackupSnapshot();
    expect(snap.ok).toBe(true);
    expect(snap.program).toBeNull();
  });

  it("wraps everything in a versioned envelope with a day count", () => {
    const envelope = buildBackupEnvelope({
      entries: { "2025-01-01": {}, "2025-01-02": {} },
      program: { Monday: {} },
      settings: { onboarded: true },
      username: "athlete",
      appVersion: "V19.2.1",
      exportedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(envelope).toMatchObject({
      format: BACKUP_FORMAT,
      v: 1,
      appVersion: "V19.2.1",
      username: "athlete",
      counts: { days: 2 },
      program: { Monday: {} },
      settings: { onboarded: true },
    });
  });

  it("import accepts the envelope and the older raw date map", () => {
    const entries = { "2025-01-01": { body: {} } };
    expect(entriesFromImport(buildBackupEnvelope({ entries }))).toBe(entries);
    expect(entriesFromImport(entries)).toBe(entries);
  });
});
