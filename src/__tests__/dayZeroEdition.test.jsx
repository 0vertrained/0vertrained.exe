// src/__tests__/dayZeroEdition.test.jsx
// @vitest-environment jsdom
// Day Zero Edition. The conversion surface: every tab renders a
// designed specimen with ONE action when — and only when — it has no real
// data. Pins: (1) the detector's meaningful-content rules (a blank defaultDay
// shell never defeats zero; one logged set/meal/weigh-in always does);
// (2) demo mode counts as real everywhere; (3) mounted specimens carry the
// SPECIMEN stamp, the sample caption, and exactly one action button (zero for
// Progress, which shows its honest unlock countdown instead); (4) App wiring
// gates on `loaded` and swaps the whole tab; (5) the wizard (Tutorial)
// survives — it collects goals/macros at signup; specimens are the per-tab
// activation layer after it. Complementary, not duplicates.
// (6) A specimen never hides the only way past it. V17 cleared Today
// on a logged workout and Fuel on a logged meal (or a macroTargets key nothing
// wrote), but those loggers live inside the tabs the specimens replace, so a
// new account could never reach one. Finished setup now clears Today and
// Fuel, a check-in or a connection clears Recovery (manual setups never see
// it), and each action opens the step that clears it. The app-level walk
// through signup → setup → first banked set is frontDoorV19_4.test.jsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { DayZeroSpecimen } from "../DayZeroSpecimen";
import { detectDayZero, dayHasContent, countLoggedDays, PROGRESS_UNLOCK_DAYS } from "../dayZero";
import { defaultDay } from "../constants";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

vi.mock("../funnel", () => ({ logFunnelEvent: vi.fn() }));

afterEach(cleanup);

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("V17.0 detector — meaningful content, not key existence", () => {
  it("a blank defaultDay shell never defeats the zero state", () => {
    const data = { "2026-07-15": defaultDay() };
    const z = detectDayZero({ data, settings: {} });
    expect(dayHasContent(defaultDay())).toBe(false);
    expect(z.today.isZero).toBe(true);
    expect(z.fuel.isZero).toBe(true);
    expect(z.progress.daysHave).toBe(0);
  });

  it("one logged set flips Today; one meal flips Fuel; a weigh-in counts a day", () => {
    const set = { ...defaultDay(), workout: { exercises: { Bench: { sets: [{ done: true }] } }, cardio: {} } };
    expect(detectDayZero({ data: { d: set } }).today.isZero).toBe(false);

    const meal = { ...defaultDay(), nutrition: { meals: [{ name: "eggs" }], calories: "" } };
    expect(detectDayZero({ data: { d: meal } }).fuel.isZero).toBe(false);

    const weigh = { ...defaultDay(), body: { ...defaultDay().body, weight: "184.5" } };
    expect(countLoggedDays({ d: weigh })).toBe(1);
    expect(detectDayZero({ data: { d: weigh } }).today.isZero).toBe(true); // a weigh-in is not a workout
  });

  it("V19.4 · finished setup clears Today and Fuel: setup is where the program and targets are chosen", () => {
    const before = detectDayZero({ data: {}, settings: { onboarded: false } });
    expect(before.today.isZero).toBe(true);
    expect(before.fuel.isZero).toBe(true);
    const after = detectDayZero({ data: {}, settings: { onboarded: true, setup: { dataMode: "manual" } } });
    expect(after.today.isZero).toBe(false);
    expect(after.fuel.isZero).toBe(false);
    // Default goals ride on every account, so goals alone are no signal, and
    // the V17 macroTargets key was never written by anything.
    expect(detectDayZero({ data: {}, settings: { goals: { protein: 200, calories: 2600 } } }).fuel.isZero).toBe(true);
    expect(detectDayZero({ data: {}, settings: { macroTargets: { protein: 200 } } }).fuel.isZero).toBe(true);
  });

  it("Recovery: either connection clears it", () => {
    expect(detectDayZero({ data: {}, settings: {} }).recovery.isZero).toBe(true);
    expect(detectDayZero({ data: {}, settings: {}, ouraConnected: true }).recovery.isZero).toBe(false);
    expect(detectDayZero({ data: {}, settings: { whoopConnected: true } }).recovery.isZero).toBe(false);
  });

  it("V19.4 · Recovery: manual setups get the live manual view; a wearable setup keeps the sample until a connection or a check-in", () => {
    for (const dataMode of ["manual", "later"]) {
      expect(detectDayZero({ data: {}, settings: { onboarded: true, setup: { dataMode } } }).recovery.isZero).toBe(false);
    }
    // Onboarded before setup recorded an answer: manual is the default.
    expect(detectDayZero({ data: {}, settings: { onboarded: true } }).recovery.isZero).toBe(false);

    const wearable = { onboarded: true, setup: { dataMode: "oura" } };
    expect(detectDayZero({ data: { d: defaultDay() }, settings: wearable }).recovery.isZero).toBe(true);
    const checkin = { ...defaultDay(), body: { ...defaultDay().body, sleep: "7.5", energy: "7" } };
    expect(detectDayZero({ data: { d: checkin }, settings: wearable }).recovery.isZero).toBe(false);
    expect(detectDayZero({ data: {}, settings: wearable, ouraConnected: true }).recovery.isZero).toBe(false);
    // A weigh-in isn't a check-in.
    const weigh = { ...defaultDay(), body: { ...defaultDay().body, weight: "184.5" } };
    expect(detectDayZero({ data: { d: weigh }, settings: wearable }).recovery.isZero).toBe(true);
  });

  it("Progress counts logged days honestly toward its unlock", () => {
    const days = {};
    for (let i = 1; i <= 5; i++) days[`2026-07-0${i}`] = { ...defaultDay(), body: { ...defaultDay().body, weight: "180" } };
    const z = detectDayZero({ data: days });
    expect(z.progress.isZero).toBe(true);
    expect(z.progress.daysHave).toBe(5);
    expect(z.progress.daysNeeded).toBe(PROGRESS_UNLOCK_DAYS - 5);
    for (let i = 6; i <= 7; i++) days[`2026-07-0${i}`] = { ...defaultDay(), body: { ...defaultDay().body, weight: "180" } };
    expect(detectDayZero({ data: days }).progress.isZero).toBe(false);
  });

  it("demo mode counts as real data everywhere", () => {
    const z = detectDayZero({ data: {}, settings: {}, demoMode: true });
    expect(z.today.isZero).toBe(false);
    expect(z.recovery.isZero).toBe(false);
    expect(z.fuel.isZero).toBe(false);
    expect(z.progress.isZero).toBe(false);
  });
});

describe("V17.0 specimens (mounted) — stamp, caption, one action", () => {
  it.each(["Today", "Recovery", "Fuel"])("%s: SPECIMEN stamp, sample caption, exactly ONE action that fires", (tab) => {
    const onAction = vi.fn();
    const { container, getByTestId, getByText } = wrap(<DayZeroSpecimen tab={tab} onAction={onAction} />);
    expect(getByTestId("specimen-stamp").textContent).toBe("SPECIMEN");
    expect(getByText(/Sample week — yours replaces this/)).toBeTruthy();
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(1); // choice paralysis is the enemy of minute one
    fireEvent.click(buttons[0]);
    expect(onAction).toHaveBeenCalledTimes(1);
    // Every action carries an honest what-happens-next line:
    expect(container.textContent).toMatch(/minute|two minutes|two numbers/i);
  });

  it("Progress: zero buttons; the unlock countdown in the calibration voice", () => {
    const { container, getByText } = wrap(
      <DayZeroSpecimen tab="Progress" progressInfo={{ daysHave: 4, daysNeeded: 3 }} />
    );
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(getByText(/UNLOCKS AFTER 7 LOGGED DAYS — 3 TO GO/)).toBeTruthy();
  });

  it("plates render the curated specimen content, not empty frames", () => {
    const { getByText, rerender } = wrap(<DayZeroSpecimen tab="Today" onAction={() => {}} />);
    expect(getByText("Incline DB Press")).toBeTruthy();
    expect(getByText(/Last time · 70 lb/)).toBeTruthy();
    rerender(<ThemeProvider><DayZeroSpecimen tab="Recovery" onAction={() => {}} /></ThemeProvider>);
    expect(getByText("Push day. Load the bar.")).toBeTruthy();
    expect(getByText("FRESH")).toBeTruthy();
  });
});

describe("V17.0 App wiring (source guards)", () => {
  const app = read("src/App.jsx");

  it("every tab swap gates on loaded && its zero flag — no boot flash, whole-tab swap", () => {
    for (const t of ["today", "fuel", "recovery", "progress"]) {
      expect(app).toContain(`loaded && dayZero.${t}.isZero`);
    }
  });

  it("populated layouts are untouched: the original tab renders live in the false branch", () => {
    expect(app).toMatch(/dayZero\.recovery\.isZero[\s\S]{0,220}DayZeroSpecimen[\s\S]{0,420}RecoveryDashboard/);
  });

  it("V19.4 · each action opens the step that clears its specimen (setup, or Integrations), never Profile", () => {
    expect(app).toContain('<DayZeroSpecimen tab="Today" onAction={() => setShowTutorial(true)} />');
    expect(app).toContain('<DayZeroSpecimen tab="Fuel" onAction={() => setShowTutorial(true)} />');
    expect(app).toContain('<DayZeroSpecimen tab="Recovery" onAction={() => openSettings("integrations")} />');
    expect(app).not.toMatch(/DayZeroSpecimen tab="\w+" onAction=\{\(\) => setOverlay\("profile"\)\}/);
  });

  it("the setup wizard survives — specimens complement it, they don't replace it", () => {
    expect(app).toContain('import("./Tutorial")');
    expect(app).toContain("handleTutorialComplete");
  });

  it("funnel terminus fires at the first rendered verdict", () => {
    expect(read("src/RecoveryDashboard.jsx")).toContain('logFunnelEvent("first_verdict_rendered")');
  });

  it("connected-but-empty Recovery frames the first sync instead of looking broken", () => {
    expect(read("src/RecoveryDashboard.jsx")).toContain("First sync running");
  });
});
