// src/__tests__/simplificationV19_6.test.jsx
// @vitest-environment jsdom
// Less on every screen. Pins:
//   · Recovery reads the morning once: check-in + verdict, what changed, data
//     trust, then everything else under Technical details (source guard — the
//     connected dashboard's mount is a fixture project; the demo build is the
//     runtime check).
//   · Fuel is Log and Recipes; the Factor tab (a personal meal block) is gone.
//   · Settings: no "coming soon" cards or sprint promises; About carries the
//     beta note and the demo link instead of load diagnostics.
//   · The Profile hub lost its duplicate Theme row, the inline feedback form
//     and the demo link; Coach memory is collapsed.
//   · Nothing Hyrox-branded is left on a user-facing surface, and the old
//     localStorage race block (station ledger, "Set race target") is gone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../supabaseClient", () => {
  const chain = {};
  for (const m of ["select", "order", "range", "gte", "gt", "lte", "lt", "eq", "neq", "in", "is", "not", "or", "filter", "match", "limit", "update", "upsert", "insert", "delete"]) chain[m] = () => chain;
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve, reject) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }), getSession: async () => ({ data: { session: null } }) }, from: () => chain, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("../oura", () => ({
  getOuraAuthUrl: vi.fn(async () => "/api/oura/auth"),
  disconnectOura: vi.fn(async () => ({ ok: true })),
  getOuraSyncEvents: vi.fn(async () => ({ events: [] })),
  getOuraTokenStatus: vi.fn(async () => ({ connected: true, isExpired: false, lastSynced: null })),
  getOuraSyncCounts: vi.fn(async () => ({})),
  syncOuraNow: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../whoop", () => ({
  getWhoopAuthUrl: vi.fn(async () => "/api/whoop/auth"),
  getWhoopTokenStatus: vi.fn(async () => ({ connected: true, isExpired: false })),
  syncWhoopNow: vi.fn(async () => ({ ok: true })),
  disconnectWhoop: vi.fn(async () => ({ ok: true })),
  getWhoopSyncCounts: vi.fn(async () => ({})),
  getWhoopSyncEvents: vi.fn(async () => ({ events: [] })),
}));

import { ThemeProvider } from "../theme";
import { DEFAULT_SETTINGS } from "../data";
import { SettingsScreen } from "../SettingsScreen";
import { MoreTab } from "../MoreTab";
import { FuelTab } from "../FuelTab";
import { CARDIO_PRESETS } from "../cardioSession";
import { PERIODIZATION_GOAL_PRESETS, normalizePeriodizationSettings } from "../periodizationSettings";
import { DEFAULT_PROGRAM } from "../constants";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
afterEach(() => { cleanup(); localStorage.clear(); });
const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("Recovery · one verdict", () => {
  const src = read("src/RecoveryDashboard.jsx");
  const mobile = src.slice(src.indexOf(") : (<>"), src.indexOf("</>)}\n    </div>\n  );\n}"));

  it("mobile: reconnect → check-in + verdict → what changed → data trust → the fold", () => {
    const order = ["{blkReconnect}", "{blkSliceC}", "{blkWhatchangedtoday}", "{blkDatatrust}", "{blkTechnicaldetailsdisclosure}", "{techOpen && (<>"];
    const positions = order.map((token) => mobile.indexOf(token));
    expect(positions.every((p) => p >= 0), positions.join(",")).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("the other readings of the same morning wait under Technical details", () => {
    const fold = mobile.slice(mobile.indexOf("{techOpen && (<>"));
    const above = mobile.slice(0, mobile.indexOf("{techOpen && (<>"));
    for (const token of ["{blkSignals}", "{blkMixedsignalday}", "{blkWearablereadinesscheck}", "{blkReadiness}", "{blkCoachinterpretation}", "{blkComponentledger}", "{blkTrainingLoad}"]) {
      expect(fold, token).toContain(token);
      expect(above, token).not.toContain(token);
    }
    expect(src).toContain('"▾ signals · score · interpretation · ledger · load"');
  });

  it("the reconnect banner is its own block, above the verdict, and the verdict still carries the limiter", () => {
    expect(src).toMatch(/const blkReconnect = \(<>\s*\{tokenStatus\?\.isExpired &&/);
    expect(src).toContain("{verdict.limiter && <LimiterRule");
  });
});

describe("Fuel · Log and Recipes", () => {
  it("has two sub-tabs and no Factor view", () => {
    wrap(<FuelTab settings={{ ...DEFAULT_SETTINGS }} todayData={{ nutrition: {} }} updateToday={vi.fn()} showToast={vi.fn()} todayKey="2026-10-27" loaded data={{}} />);
    expect(screen.getByRole("button", { name: "Log" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recipes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Factor" })).toBeNull();
    const src = read("src/FuelTab.jsx");
    expect(src).not.toMatch(/factorCutPlan|FactorCutView|fuelView === "factor"/);
  });
});

describe("Settings", () => {
  const renderSettings = (extra = {}) => wrap(
    <SettingsScreen settings={{ ...DEFAULT_SETTINGS, ouraConnected: true, whoopConnected: true }} onSave={vi.fn()} onClose={vi.fn()} busy={false} onThemeChange={vi.fn()} currentTheme="system" loggedDays={12} currentTab="Progress" {...extra} />,
  );

  it("Integrations has no 'coming soon' card and no sprint promise", async () => {
    renderSettings();
    fireEvent.click(screen.getByText("Integrations"));
    await screen.findByText("Whoop");
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/Fitbit/i)).toBeNull();
    expect(screen.queryByText(/next sprint/i)).toBeNull();
    expect(screen.getByText(/the recovery score is still computed by the app/)).toBeTruthy();
  });

  it("Theme makes no promises either", () => {
    renderSettings();
    fireEvent.click(screen.getByText("Theme"));
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("About carries the beta note and the demo link, not load diagnostics", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    renderSettings();
    fireEvent.click(screen.getByText("About"));
    expect(screen.queryByText(/Load diagnostics/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.getByText("View / share the demo page →").getAttribute("href")).toBe("#/demo");
    fireEvent.change(screen.getByLabelText("Beta feedback note"), { target: { value: "The Recovery tab was long." } });
    fireEvent.click(screen.getByRole("button", { name: "Copy beta feedback note" }));
    await screen.findByText(/Copied/);
    const text = writeText.mock.calls[0][0];
    expect(text).toMatch(/^0vertrained beta feedback — V19\./);
    expect(text).toContain("Current tab: Progress");
    expect(text).toContain("Logged days: 12");
    expect(text).toContain("The Recovery tab was long.");
  });
});

describe("Profile hub", () => {
  const mount = () => wrap(
    <MoreTab program={DEFAULT_PROGRAM} onSaveProgram={vi.fn()} onApplyGeneratedProgram={vi.fn()} settings={{}} allData={{}} showToast={vi.fn()} myUsername="athlete" onSettings={vi.fn()} onLogout={vi.fn()} exportJSON={vi.fn()} exportCSV={vi.fn()} fileRef={{ current: null }} onPasteImport={vi.fn()} onSaveCoachPreferences={vi.fn()} />,
  );

  it("lost the duplicate Theme row, the feedback form and the demo link", () => {
    mount();
    expect(screen.queryByText(/Theme & preferences/i)).toBeNull();
    expect(screen.queryByText(/Copy beta feedback note/i)).toBeNull();
    expect(screen.queryByText(/share demo page/i)).toBeNull();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Log out")).toBeTruthy();
    expect(screen.getByText("Social boards")).toBeTruthy();
  });

  it("Coach memory is collapsed until opened", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Save Coach Prefs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Coach Memory/ }));
    expect(screen.getByRole("button", { name: "Save Coach Prefs" })).toBeTruthy();
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
  });
});

describe("Hyrox is gone", () => {
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); }
      else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
    }
    return out;
  };

  it("no user-facing Hyrox copy anywhere in src (classifier keywords may stay)", () => {
    const hits = [];
    for (const file of walk(resolve(root, "src"))) {
      const code = stripComments(readFileSync(file, "utf8"));
      // Lowercase "hyrox" inside a regex is a text classifier reading a user's own day names; anything capitalised is copy.
      for (const line of code.split("\n")) if (/Hyrox|HYROX/.test(line)) hits.push(`${file.replace(root + "/", "")}: ${line.trim().slice(0, 80)}`);
    }
    expect(hits).toEqual([]);
  });

  it("the timer presets, the block goal presets and the demo page say so", () => {
    expect(CARDIO_PRESETS.map((p) => p.key)).toEqual(["4x4", "8x1", "30_30", "emom10"]);
    expect(Object.keys(PERIODIZATION_GOAL_PRESETS)).toContain("race_prep");
    expect(Object.keys(PERIODIZATION_GOAL_PRESETS)).not.toContain("hyrox_prep");
    // A block saved with the old preset still normalizes, keeping its own goal text.
    const s = normalizePeriodizationSettings({ goalPreset: "hyrox_prep", goal: "Sharpen the engine" });
    expect(s.goalPreset).toBe("hybrid_base");
    expect(s.goal).toBe("Sharpen the engine");
    expect(read("src/DemoPage.jsx")).toContain('["Race plan",');
  });

  it("the old localStorage race block is deleted", () => {
    expect(existsSync(resolve(root, "src/raceBlock.js"))).toBe(false);
    const src = read("src/RaceBlockSection.jsx");
    const code = stripComments(src);
    expect(code).not.toMatch(/localStorage|HYROX_STATIONS|Set race target|raceBlock"/);
  });
});
