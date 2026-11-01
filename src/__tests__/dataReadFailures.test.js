// src/__tests__/dataReadFailures.test.js
// V19.4 · The data layer keeps a failed read visible. loadSettings() and
// loadProgram() answer defaults when the server can't be reached, which looks
// exactly like a new account; the checked loaders say which it was, and
// patchSettings() merges into the stored profile without ever writing over it
// blind. The plain loaders answer exactly what they did before.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  profiles: null, // { data, error } answered by .single()
  program: null,
  updates: [],
  updateError: null,
  entriesRows: [],
  entriesErrorFrom: null, // page offset at which the entries read fails
}));

vi.mock("../supabaseClient", () => {
  const query = (table) => {
    const q = {};
    q.select = () => q;
    q.eq = () => q;
    q.order = () => q;
    q.single = async () => db[table];
    q.update = (payload) => ({ eq: async () => { db.updates.push({ table, payload }); return { error: db.updateError }; } });
    q.range = async (from, to) => {
      if (db.entriesErrorFrom !== null && from >= db.entriesErrorFrom) return { data: null, error: { message: "Failed to fetch" } };
      return { data: db.entriesRows.slice(from, to + 1), error: null };
    };
    return q;
  };
  return { supabase: { from: (table) => query(table), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } } };
});

import {
  DEFAULT_SETTINGS, setCachedUserId,
  loadSettings, loadSettingsChecked, loadProgram, loadProgramChecked,
  loadAllEntries, loadAllEntriesChecked, patchSettings,
} from "../data";

const NETWORK = { data: null, error: { message: "TypeError: Failed to fetch", code: "" } };
const NO_ROW = { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };

beforeEach(() => {
  setCachedUserId("u1");
  db.profiles = { data: { settings: { onboarded: true, theme: "whitepaperDark", goals: { protein: 180 } }, username: "rami" }, error: null };
  db.program = { data: { payload: { Monday: { type: "Lower A" } } }, error: null };
  db.updates = [];
  db.updateError = null;
  db.entriesRows = [];
  db.entriesErrorFrom = null;
});

describe("settings reads", () => {
  it("a good read: normalized settings, no error (and loadSettings answers the same)", async () => {
    const r = await loadSettingsChecked();
    expect(r.error).toBeNull();
    expect(r.missing).toBe(false);
    expect(r.settings).toMatchObject({ onboarded: true, theme: "whitepaperDark", username: "rami", goals: { ...DEFAULT_SETTINGS.goals, protein: 180 } });
    expect(await loadSettings()).toEqual(r.settings);
  });

  it("no profile row is not a failed read, and is reported as missing", async () => {
    db.profiles = NO_ROW;
    const r = await loadSettingsChecked();
    expect(r.error).toBeNull();
    expect(r.missing).toBe(true);
    expect(r.settings.onboarded).toBe(false);
  });

  it("a failed read says so; loadSettings still answers the defaults it always did", async () => {
    db.profiles = NETWORK;
    const r = await loadSettingsChecked();
    expect(r.error).toMatch(/Failed to fetch/);
    expect(r.missing).toBe(false);
    expect(r.settings).toEqual({ ...DEFAULT_SETTINGS, username: null });
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, username: null });
  });
});

describe("program reads", () => {
  it("a good read, no row, and a failed read are three different answers", async () => {
    expect(await loadProgramChecked()).toEqual({ program: { Monday: { type: "Lower A" } }, error: null });
    db.program = NO_ROW;
    expect(await loadProgramChecked()).toEqual({ program: null, error: null });
    db.program = NETWORK;
    expect((await loadProgramChecked()).error).toMatch(/Failed to fetch/);
    expect(await loadProgram()).toBeNull(); // unchanged for existing callers
  });
});

describe("patchSettings", () => {
  it("merges the patch into the stored settings", async () => {
    expect(await patchSettings({ ouraConnected: true })).toEqual({ ok: true });
    expect(db.updates).toEqual([{ table: "profiles", payload: { settings: { onboarded: true, theme: "whitepaperDark", goals: { protein: 180 }, ouraConnected: true } } }]);
  });

  it("aborts on a failed read instead of writing the patch over an empty profile", async () => {
    db.profiles = NETWORK;
    expect((await patchSettings({ ouraConnected: true })).error).toMatch(/Failed to fetch/);
    db.profiles = NO_ROW;
    expect((await patchSettings({ ouraConnected: true })).error).toBeTruthy();
    expect(db.updates).toEqual([]);
  });

  it("reports a failed write", async () => {
    db.updateError = { message: "permission denied" };
    expect(await patchSettings({ ouraConnected: true })).toEqual({ error: "permission denied" });
  });
});

describe("full history", () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ entry_date: `2025-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, payload: { i } }));

  it("says whether every page arrived", async () => {
    db.entriesRows = rows(1200);
    const ok = await loadAllEntriesChecked();
    expect(ok.complete).toBe(true);
    expect(Object.keys(ok.entries)).toHaveLength(1200);
    db.entriesErrorFrom = 1000; // the second page fails
    const short = await loadAllEntriesChecked();
    expect(short.complete).toBe(false);
    expect(Object.keys(short.entries)).toHaveLength(1000);
    expect(Object.keys(await loadAllEntries())).toHaveLength(1000); // unchanged for existing callers
  });
});
