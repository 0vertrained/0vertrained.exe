// src/__tests__/dayZeroEdition.test.jsx
// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// V17.0 · Day Zero Edition. The conversion surface: every tab renders a
// designed specimen with ONE action when — and only when — it has no real
// data. Pins: (1) the detector's meaningful-content rules (a blank defaultDay
// shell never defeats zero; one logged set/meal/weigh-in always does);
// (2) demo mode counts as real everywhere; (3) mounted specimens carry the
// SPECIMEN stamp, the sample caption, and exactly one action button (zero for
// Progress, which shows its honest unlock countdown instead); (4) App wiring
// gates on `loaded` and swaps the whole tab; (5) the wizard (Tutorial)
// survives — it collects goals/macros at signup; specimens are the per-tab
// activation layer after it. Complementary, not duplicates.
// ─────────────────────────────────────────────────────────────────────────────
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

  it("one logged set flips Today; one meal or target flips Fuel; a weigh-in counts a day", () => {
    const set = { ...defaultDay(), workout: { exercises: { Bench: { sets: [{ done: true }] } }, cardio: {} } };
    expect(detectDayZero({ data: { d: set } }).today.isZero).toBe(false);

    const meal = { ...defaultDay(), nutrition: { meals: [{ name: "eggs" }], calories: "" } };
    expect(detectDayZero({ data: { d: meal } }).fuel.isZero).toBe(false);
    expect(detectDayZero({ data: {}, settings: { macroTargets: { protein: 200 } } }).fuel.isZero).toBe(false);
    expect(detectDayZero({ data: {}, settings: { macroTargets: { protein: "" } } }).fuel.isZero).toBe(true);

    const weigh = { ...defaultDay(), body: { ...defaultDay().body, weight: "184.5" } };
    expect(countLoggedDays({ d: weigh })).toBe(1);
    expect(detectDayZero({ data: { d: weigh } }).today.isZero).toBe(true); // a weigh-in is not a workout
  });

  it("Recovery zero requires BOTH wearables absent; either connection clears it", () => {
    expect(detectDayZero({ data: {}, settings: {} }).recovery.isZero).toBe(true);
    expect(detectDayZero({ data: {}, settings: {}, ouraConnected: true }).recovery.isZero).toBe(false);
    expect(detectDayZero({ data: {}, settings: { whoopConnected: true } }).recovery.isZero).toBe(false);
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
