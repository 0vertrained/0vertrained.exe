// src/__tests__/frontDoorV19_4.test.jsx
// @vitest-environment jsdom
// The front door, walked end to end through the real App: a brand-new
// account signs in, finishes setup, and banks its first set. Through v19.3
// this was impossible. Today showed a sample until a workout was logged, and
// the workout loggers live inside the Today tab the sample replaced.
// After setup: tap 1 opens the day's workout, tap 2 starts the session (the
// logger), and tap 3 banks the first set once the weight and reps are in.
//
// Only the edges are faked: Supabase (a signed-in session and an empty
// database), the data layer's network calls (an in-memory store), and fetch.
// Everything between them is the shipped app: App, Tutorial, TodayTab,
// SessionMode, the Day Zero detector, Settings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  user: { id: "user-new", email: "new@example.com" },
  authCb: null, // the app's auth listener, so a test can sign another account in
  store: { entries: {}, program: null, settings: null, failSettingsSaves: 0, failSettingsReads: 0, failProgramReads: 0, missingProfile: false, historyIncomplete: false, failEntrySaves: false, settingsReadDelay: 0 },
}));

vi.mock("../supabaseClient", () => {
  const chain = {};
  for (const m of ["select", "order", "range", "gte", "gt", "lte", "lt", "eq", "neq", "in", "is", "not", "or", "filter", "match", "limit", "update", "upsert", "insert", "delete"]) chain[m] = () => chain;
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve, reject) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
  const session = { user: h.user, access_token: "test-token" };
  return {
    supabase: {
      auth: {
        onAuthStateChange: (cb) => { h.authCb = cb; setTimeout(() => cb("INITIAL_SESSION", session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
        getSession: async () => ({ data: { session } }),
        getUser: async () => ({ data: { user: h.user } }),
        signOut: async () => ({ error: null }),
      },
      from: () => chain,
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

vi.mock("../data", async (importOriginal) => {
  const actual = await importOriginal();
  const { store } = h;
  return {
    ...actual,
    loadRecentEntries: vi.fn(async () => ({ ...store.entries })),
    loadOlderEntries: vi.fn(async () => 0),
    loadAllEntries: vi.fn(async () => ({ ...store.entries })),
    loadAllEntriesChecked: vi.fn(async () => ({ entries: { ...store.entries }, complete: !store.historyIncomplete })),
    // A failed read answers what the real loaders answer (defaults / null) plus the error.
    loadProgramChecked: vi.fn(async () => {
      if (store.failProgramReads > 0) { store.failProgramReads -= 1; return { program: null, error: "network down" }; }
      return { program: store.program, error: null };
    }),
    loadSettingsChecked: vi.fn(async () => {
      if (store.settingsReadDelay) await new Promise((r) => setTimeout(r, store.settingsReadDelay));
      if (store.failSettingsReads > 0) { store.failSettingsReads -= 1; return { settings: { ...actual.DEFAULT_SETTINGS, username: null }, error: "network down", missing: false }; }
      if (store.missingProfile) return { settings: { ...actual.DEFAULT_SETTINGS, username: null }, error: null, missing: true };
      return { settings: { ...actual.DEFAULT_SETTINGS, ...(store.settings || {}), username: store.settings?.username || "athlete" }, error: null, missing: false };
    }),
    saveProgram: vi.fn(async (payload) => { store.program = payload; return { ok: true }; }),
    saveSettings: vi.fn(async (settings) => {
      if (store.failSettingsSaves > 0) { store.failSettingsSaves -= 1; return { error: "network down" }; }
      store.settings = settings;
      return { ok: true };
    }),
    // Server-side merge into the stored profile (data.js patchSettings).
    patchSettings: vi.fn(async (patch) => {
      if (store.failSettingsSaves > 0) { store.failSettingsSaves -= 1; return { error: "network down" }; }
      store.settings = { ...(store.settings || {}), ...patch };
      return { ok: true };
    }),
    saveEntry: vi.fn(async (date, payload) => {
      if (store.failEntrySaves) return { error: "network down" };
      store.entries[date] = payload;
      return { ok: true };
    }),
  };
});

vi.mock("../auth", async (importOriginal) => ({
  ...(await importOriginal()),
  ensureProfileExists: vi.fn(async () => ({ ok: true, existed: true })),
}));

vi.mock("../funnel", () => ({ logFunnelEvent: vi.fn() }));

import App from "../App";
import * as dataLayer from "../data";
import * as authLayer from "../auth";
import { DEFAULT_PROGRAM } from "../constants";
import { THEMES } from "../theme";

const MONDAY = new Date("2026-10-26T09:00:00"); // a lifting day in the Strength split

beforeEach(() => {
  h.store.entries = {};
  h.store.program = null;
  h.store.settings = null;
  h.store.failSettingsSaves = 0;
  h.store.failSettingsReads = 0;
  h.store.failProgramReads = 0;
  h.store.missingProfile = false;
  h.store.historyIncomplete = false;
  h.store.failEntrySaves = false;
  h.store.settingsReadDelay = 0;
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MONDAY);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({}), text: async () => "{}" })));
  window.matchMedia = window.matchMedia || ((query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.scrollTo = vi.fn();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const WAIT = { timeout: 5000 };

async function finishSetup({ dataMode = /^Manual only\./ } = {}) {
  fireEvent.click(await screen.findByRole("button", { name: /Skip the welcome tour/ }, WAIT));
  const next = () => fireEvent.click(screen.getByRole("button", { name: /Continue →|Finish setup →/ }));
  fireEvent.click(screen.getByRole("radio", { name: /^Strength\./ }));
  next();
  fireEvent.click(screen.getByRole("radio", { name: dataMode }));
  next();
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Equipment" })).getByRole("radio", { name: "Full gym" }));
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Experience level" })).getByRole("radio", { name: "Intermediate" }));
  next(); // program
  next(); // macros (preset chosen from the goal)
  next(); // privacy → Finish setup
}

const tab = (name) => fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));

describe("V19.4 front door — a new account reaches a logger", () => {
  it("signs in → setup → Today is live → a logger in two taps → the first set banked on the third", async () => {
    render(<App />);
    await finishSetup();

    // Setup saved (merged into the stored profile), and the account now counts as set up.
    await waitFor(() => expect(dataLayer.patchSettings).toHaveBeenCalled(), WAIT);
    expect(dataLayer.saveSettings).not.toHaveBeenCalled();
    expect(h.store.settings).toMatchObject({ onboarded: true, setup: { dataMode: "manual" } });
    const lifts = h.store.program?.Monday?.lifting || [];
    expect(lifts.length).toBeGreaterThan(0); // the fixed date really is a lifting day

    // Today is the live tab, not the sample.
    const workout = await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    expect(screen.queryByTestId("specimen-stamp")).toBeNull();

    // Tap 1 opens the day's workout, tap 2 starts the session: that's the logger.
    fireEvent.click(workout);
    fireEvent.click(await screen.findByRole("button", { name: "Start session →" }, WAIT));
    const runner = await screen.findByRole("dialog", { name: /workout session/ }, WAIT);
    // The numbers, then tap 3 banks the set.
    fireEvent.change(within(runner).getByLabelText("Load"), { target: { value: "135" } });
    fireEvent.change(within(runner).getByLabelText("Reps"), { target: { value: "5" } });
    fireEvent.click(within(runner).getByRole("button", { name: "Bank set 1" }));

    // The first set reaches the save path (700 ms debounce).
    await waitFor(() => expect(dataLayer.saveEntry).toHaveBeenCalled(), WAIT);
    const [date, payload] = dataLayer.saveEntry.mock.calls.at(-1);
    expect(date).toBe("2026-10-26");
    const logged = Object.values(payload.workout.exercises);
    expect(logged.some((ex) => ex.sets?.some((s) => s.done && s.weight === "135" && s.reps === "5"))).toBe(true);
  }, 20000);

  it("after setup, Fuel and Recovery are live too: a manual setup gets the manual check-in, not a sample", async () => {
    render(<App />);
    await finishSetup();
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);

    tab("Fuel");
    await waitFor(() => expect(screen.queryByTestId("specimen-stamp")).toBeNull(), WAIT);

    tab("Recovery");
    expect(await screen.findByText("Manual check-in is primary.", {}, WAIT)).toBeTruthy();
    expect(screen.queryByTestId("specimen-stamp")).toBeNull();
  }, 20000);

  it("a wearable setup shows Recovery's sample until it connects, and its one action opens Integrations", async () => {
    render(<App />);
    await finishSetup({ dataMode: /^Wearable connected\./ });
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);

    tab("Recovery");
    expect(await screen.findByTestId("specimen-stamp", {}, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect Oura" }));
    expect(await screen.findByText(/Fig\. 5 · Data sources/, {}, WAIT)).toBeTruthy();
  }, 20000);

  it("a failed setup save keeps the wizard open, and Finish retries", async () => {
    h.store.failSettingsSaves = 1;
    render(<App />);
    await finishSetup();

    expect(await screen.findByText("Setup didn't save. Check your connection and tap Finish again.", {}, WAIT)).toBeTruthy();
    const finish = await screen.findByRole("button", { name: "Finish setup →" }, WAIT);
    expect(h.store.settings).toBeNull();

    fireEvent.click(finish);
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    expect(h.store.settings).toMatchObject({ onboarded: true });
  }, 20000);
});

describe("V19.4 wearable OAuth return finishes in the app", () => {
  it("lands on Settings → Integrations with the result, and cleans the address", async () => {
    h.store.settings = { onboarded: true, setup: { goal: "strength", dataMode: "oura", macroPreset: "balanced", completedAt: "2026-10-01T00:00:00.000Z" } };
    window.history.replaceState(null, "", "/settings?oura_error=access_denied");
    render(<App />);

    const notice = await screen.findByTestId("integrations-notice", {}, WAIT);
    expect(notice.textContent).toBe("Oura didn't connect: access wasn't granted. You can try again below.");
    expect(window.location.pathname + window.location.search).toBe("/");
  }, 20000);

  it("leaves an ordinary launch alone", async () => {
    h.store.settings = { onboarded: true, setup: { dataMode: "manual" } };
    render(<App />);
    await screen.findByRole("tab", { name: /^Today/ }, WAIT);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByText(/Fig\. 5 · Data sources/)).toBeNull();
  }, 20000);
});

// ── V19.4 review fixes ──────────────────────────────────────────────────────
// The independent review of this release found the OAuth return could write
// default settings over a real profile after a failed read, and was skipped
// on cached launches whose saved theme differs from the phone's. These pin the
// fixes, plus the offline launch that used to open setup for an existing account.

// The Oura status endpoint says "connected"; every other call answers {}.
const ouraConnectedFetch = () => vi.stubGlobal("fetch", vi.fn(async (url) => ({
  ok: true, status: 200, headers: new Map(),
  json: async () => (String(url).includes("/api/oura/status") ? { connected: true, isExpired: false } : {}),
  text: async () => "{}",
})));

const PROFILE = {
  onboarded: true,
  theme: "whitepaperLight",
  setup: { goal: "strength", dataMode: "oura", macroPreset: "balanced", completedAt: "2026-10-01T00:00:00.000Z" },
  goals: { calories: 2400, protein: 180, carbs: 250, fats: 70, water: 128 },
};

const seedCache = (settings, program = null) => {
  localStorage.setItem(`ovt-cache-${h.user.id}`, JSON.stringify({
    version: "1", timestamp: Date.now(), entries: {}, program,
    settings: { ...dataLayer.DEFAULT_SETTINGS, ...settings, username: "athlete" }, myUsername: "athlete",
  }));
};

describe("V19.4 review fixes · returns and reads that fail", () => {
  it("a confirmed connection saves quietly: Integrations stays open and the flag is merged into the stored profile", async () => {
    h.store.settings = { ...PROFILE };
    ouraConnectedFetch();
    window.history.replaceState(null, "", "/settings?oura_connected=true");
    render(<App />);

    await screen.findByTestId("integrations-notice", {}, WAIT);
    await waitFor(() => expect(dataLayer.patchSettings).toHaveBeenCalledWith({ ouraConnected: true }), WAIT);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(screen.getByTestId("integrations-notice")).toBeTruthy(); // the full Save path would have closed Settings
    expect(dataLayer.saveSettings).not.toHaveBeenCalled();
    expect(h.store.settings).toMatchObject({ ...PROFILE, ouraConnected: true });
  }, 20000);

  it("with nothing cached, a failed settings read shows the retry panel: no setup, no samples, no writes; Try again loads the account", async () => {
    h.store.settings = { ...PROFILE };
    h.store.failSettingsReads = 1; // the launch read errors; the server still holds the real profile
    ouraConnectedFetch();
    window.history.replaceState(null, "", "/settings?oura_connected=true");
    render(<App />);

    const panel = await screen.findByTestId("account-unavailable", {}, WAIT);
    expect(panel.textContent).toMatch(/Couldn't reach your account/);
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); }); // setup is a lazy chunk; give it time to appear if it's coming
    expect(screen.queryByRole("button", { name: /Skip the welcome tour/ })).toBeNull();
    expect(screen.queryByTestId("specimen-stamp")).toBeNull();
    expect(screen.queryByTestId("integrations-notice")).toBeNull(); // Settings would show defaults; the return waits
    expect(window.location.search).toBe("?oura_connected=true");
    expect(dataLayer.saveSettings).not.toHaveBeenCalled();
    expect(dataLayer.patchSettings).not.toHaveBeenCalled();

    // Profile shows the same panel (with Log out), so Settings can't be reached either.
    fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
    expect(screen.getByTestId("account-unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("integrations-notice", {}, WAIT);
    await waitFor(() => expect(dataLayer.patchSettings).toHaveBeenCalledWith({ ouraConnected: true }), WAIT);
    expect(dataLayer.saveSettings).not.toHaveBeenCalled();
    expect(h.store.settings).toMatchObject({ onboarded: true, goals: PROFILE.goals, setup: PROFILE.setup, ouraConnected: true });
  }, 20000);

  it("an account with no profile row gets the panel, never setup it can't save", async () => {
    h.store.missingProfile = true;
    authLayer.ensureProfileExists.mockImplementationOnce(async () => ({ ok: false, reason: "cap" }));
    render(<App />);

    expect((await screen.findByTestId("account-unavailable", {}, WAIT)).textContent).toMatch(/user limit/);
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(screen.queryByRole("button", { name: /Skip the welcome tour/ })).toBeNull();
    expect(dataLayer.saveProgram).not.toHaveBeenCalled();
  }, 20000);

  it("nothing from one account carries into the next after logout → login", async () => {
    h.store.settings = { ...PROFILE, username: "alice", goals: { ...PROFILE.goals, calories: 2400 } };
    render(<App />);
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);

    fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Log out/ }, WAIT));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /^Today/ })).toBeNull(), WAIT);

    // A second account signs in on the same page; its first read fails and it has no cache.
    h.store.settings = { ...PROFILE, username: "bea", goals: { ...PROFILE.goals, calories: 3000 } };
    h.store.failSettingsReads = 1;
    await act(async () => { h.authCb("SIGNED_IN", { user: { id: "user-b", email: "b@example.com" }, access_token: "t2" }); });
    const panel = await screen.findByTestId("account-unavailable", {}, WAIT);
    expect(panel).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/alice/);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Settings/ }, WAIT));
    expect((await screen.findByDisplayValue("3000", {}, WAIT))).toBeTruthy(); // the second account's own targets
    expect(screen.queryByDisplayValue("2400")).toBeNull();
    expect(dataLayer.saveSettings).not.toHaveBeenCalled();
  }, 20000);

  it("an unsent day from one account is never saved into the next account after logout → login", async () => {
    h.store.settings = { ...PROFILE };
    h.store.failEntrySaves = true; // the first account's save fails and queues
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT));
    fireEvent.click(await screen.findByRole("button", { name: "Start session →" }, WAIT));
    const runner = await screen.findByRole("dialog", { name: /workout session/ }, WAIT);
    fireEvent.change(within(runner).getByLabelText("Load"), { target: { value: "135" } });
    fireEvent.change(within(runner).getByLabelText("Reps"), { target: { value: "5" } });
    fireEvent.click(within(runner).getByRole("button", { name: "Bank set 1" }));
    await screen.findByText("Save pending — will retry", {}, WAIT); // queued for the first account
    fireEvent.click(within(runner).getByRole("button", { name: /Exit/ }));

    fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Log out/ }, WAIT));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /^Today/ })).toBeNull(), WAIT);
    const callsBefore = dataLayer.saveEntry.mock.calls.length;

    h.store.failEntrySaves = false;
    await act(async () => { h.authCb("SIGNED_IN", { user: { id: "user-b", email: "b@example.com" }, access_token: "t2" }); });
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); }); // past the 700 ms save debounce and the queue flush
    const leaked = dataLayer.saveEntry.mock.calls.slice(callsBefore)
      .filter(([, payload]) => Object.values(payload?.workout?.exercises || {}).some((ex) => ex.sets?.some((set) => set.weight === "135")));
    expect(leaked).toEqual([]);
  }, 20000);

  it("behind the retry panel, a queued day doesn't flush into the cache with default settings, and Try again doesn't come back on defaults", async () => {
    h.store.settings = { ...PROFILE };
    h.store.failSettingsReads = 2; // the launch read and the first retry both fail
    const queued = { workout: { exercises: { Bench: { sets: [{ done: true, weight: "135", reps: "5" }] } }, cardio: {} } };
    localStorage.setItem(`ovt-pending-saves-v1-${h.user.id}`, JSON.stringify({ "2026-10-25": queued }));
    render(<App />);

    await screen.findByTestId("account-unavailable", {}, WAIT);
    await act(async () => { await new Promise((r) => setTimeout(r, 1000)); }); // past the 700 ms save debounce
    expect(localStorage.getItem(`ovt-cache-${h.user.id}`)).toBeNull();
    expect(dataLayer.saveEntry).not.toHaveBeenCalled(); // the queue waits for the account

    // Coming back online retries the queue (it's this account's own data), but
    // still writes nothing to the cache while the settings are unknown.
    await act(async () => { window.dispatchEvent(new Event("online")); await new Promise((r) => setTimeout(r, 1000)); });
    expect(localStorage.getItem(`ovt-cache-${h.user.id}`)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("account-unavailable", {}, WAIT)).toBeTruthy(); // still unreachable: the panel again, not samples
    expect(screen.queryByTestId("specimen-stamp")).toBeNull();
    expect(JSON.parse(localStorage.getItem(`ovt-pending-saves-v1-${h.user.id}`))).toHaveProperty("2026-10-25"); // the queued day is kept
  }, 20000);

  it("while the account is still loading, Profile waits and Settings can't open", async () => {
    h.store.settings = { ...PROFILE };
    h.store.settingsReadDelay = 800;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /^Profile/ }, WAIT));
    expect(screen.getByText("Loading your account…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Settings/ })).toBeNull();
    // Once loaded, Profile is the real one.
    expect(await screen.findByRole("button", { name: /^Settings/ }, WAIT)).toBeTruthy();
    expect(dataLayer.saveSettings).not.toHaveBeenCalled();
  }, 20000);

  it("signed out from another tab with Settings open: the next sign-in doesn't reopen Settings on defaults", async () => {
    h.store.settings = { ...PROFILE };
    render(<App />);
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Settings/ }, WAIT));
    await screen.findByText("Targets & Sources", {}, WAIT);

    await act(async () => { h.authCb("SIGNED_OUT", null); });
    await waitFor(() => expect(screen.queryByText("Targets & Sources")).toBeNull(), WAIT);
    await act(async () => { h.authCb("SIGNED_IN", { user: h.user, access_token: "t3" }); });
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    expect(screen.queryByText("Targets & Sources")).toBeNull();
    expect(dataLayer.saveSettings).not.toHaveBeenCalled();
  }, 20000);

  it("signed out from another tab with the export or import screen open: the next sign-in sees neither", async () => {
    h.store.settings = { ...PROFILE };
    h.store.entries = { "2026-10-20": { body: { weight: "201.5" } } };
    render(<App />);
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Export Full Backup/ }, WAIT));
    await screen.findByText(/JSON Backup/, {}, WAIT);
    expect(document.body.textContent).toMatch(/201\.5/);

    await act(async () => { h.authCb("SIGNED_OUT", null); });
    h.store.entries = {};
    await act(async () => { h.authCb("SIGNED_IN", { user: { id: "user-b", email: "b@example.com" }, access_token: "t4" }); });
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    expect(screen.queryByText(/JSON Backup/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/201\.5/);

    fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Import From Pasted Text/ }, WAIT));
    await screen.findByText(/Paste Backup/, {}, WAIT);
    await act(async () => { h.authCb("SIGNED_OUT", null); });
    await act(async () => { h.authCb("SIGNED_IN", { user: h.user, access_token: "t5" }); });
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    expect(screen.queryByText(/Paste Backup/)).toBeNull();
  }, 20000);

  it("a failed program read with nothing cached shows the panel, not the default program", async () => {
    h.store.settings = { ...PROFILE };
    h.store.program = { ...DEFAULT_PROGRAM, Monday: { type: "Real Monday", code: "RM", lifting: [{ name: "Front Squat", sets: 3, reps: 5 }], cardio: null } };
    h.store.failProgramReads = 1;
    render(<App />);

    expect(await screen.findByTestId("account-unavailable", {}, WAIT)).toBeTruthy();
    expect(localStorage.getItem(`ovt-cache-${h.user.id}`)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const workout = await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    expect(workout.textContent).toMatch(/Real Monday/);
  }, 20000);

  it("an offline launch keeps this device's settings and program: no setup wizard, no default program", async () => {
    const program = { ...DEFAULT_PROGRAM, Monday: { type: "Cached Monday", code: "CM", lifting: [{ name: "Front Squat", sets: 3, reps: 5 }], cardio: null } };
    seedCache({ ...PROFILE, setup: { ...PROFILE.setup, dataMode: "manual" } }, program);
    h.store.failSettingsReads = 1;
    h.store.failProgramReads = 1;
    render(<App />);

    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);
    await waitFor(() => expect(dataLayer.loadSettingsChecked).toHaveBeenCalled(), WAIT);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(screen.queryByRole("button", { name: /Skip the welcome tour/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Workout — Monday/ }).textContent).toMatch(/Cached Monday/);
    const cached = JSON.parse(localStorage.getItem(`ovt-cache-${h.user.id}`));
    expect(cached.settings.onboarded).toBe(true);
    expect(cached.program.Monday.type).toBe("Cached Monday");
  }, 20000);

  it("a cached launch whose saved theme differs from the phone's still revalidates and handles the return", async () => {
    // The phone is light (matchMedia → no match); the saved theme is dark. The
    // cached launch switches the theme, which used to cancel the revalidation.
    const dark = { ...PROFILE, theme: "whitepaperDark" };
    h.store.settings = dark;
    seedCache(dark);
    authLayer.ensureProfileExists.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { ok: true, existed: true };
    });
    window.history.replaceState(null, "", "/settings?oura_error=access_denied");
    render(<App />);

    expect((await screen.findByTestId("integrations-notice", {}, WAIT)).textContent).toMatch(/^Oura didn't connect/);
    expect(window.location.pathname + window.location.search).toBe("/");
    expect(dataLayer.loadSettingsChecked).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/Refreshing latest data in background/)).toBeNull(), WAIT);
  }, 20000);

  it("switches back to the server's theme when the cached paint went the other way", async () => {
    // Phone light, cache dark, server light (changed on another device).
    expect(THEMES.whitepaperLight.text).not.toBe(THEMES.whitepaperDark.text);
    const ink = () => document.documentElement.style.getPropertyValue("--ovt-focus");
    seedCache({ ...PROFILE, theme: "whitepaperDark" });
    h.store.settings = { ...PROFILE, theme: "whitepaperLight" };
    authLayer.ensureProfileExists.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 300)); // hold the fresh read so the cached paint is observable
      return { ok: true, existed: true };
    });
    render(<App />);

    await waitFor(() => expect(ink()).toBe(THEMES.whitepaperDark.text), WAIT); // the cached paint
    await waitFor(() => expect(dataLayer.loadSettingsChecked).toHaveBeenCalled(), WAIT);
    await waitFor(() => expect(ink()).toBe(THEMES.whitepaperLight.text), WAIT); // the server's answer wins
  }, 20000);

  it("an export that couldn't reach the server says so on the export screen", async () => {
    h.store.settings = { ...PROFILE };
    h.store.historyIncomplete = true;
    render(<App />);
    await screen.findByRole("button", { name: /^Workout — Monday/ }, WAIT);

    fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Export Full Backup/ }, WAIT));
    expect(await screen.findByText("The server couldn't be reached, so this has only what's on this device.", {}, WAIT)).toBeTruthy();
  }, 20000);
});
