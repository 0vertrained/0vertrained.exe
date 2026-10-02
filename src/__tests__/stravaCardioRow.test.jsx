// src/__tests__/stravaCardioRow.test.jsx
// V13.3 · The Strava → cardio suggestion row: appears only for the
// unlogged-external-run case, applies through the caller's setter, dismisses
// per-day, and always carries the required Strava deep link. Plus the
// compliance lock: no Strava field ever reaches a coach payload.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import {
  StravaCardioRow,
  buildCardioFillFromActivities,
  hasManualCardio,
  formatMinutesAsTime,
} from "../sections/StravaCardioRow";
import { buildSlice } from "../Coach";
import { buildCoachContext } from "../coachContextBuilder";
import { buildWearableLoadRows, stravaLoadForDay } from "../wearableWorkoutLoad";
import { mapActivityRow } from "../strava/dataLoading";

afterEach(cleanup);
beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom always has it */ } });

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

const act = mapActivityRow({
  id: "row-1",
  provider_activity_id: "42",
  start_time: new Date("2026-07-08T12:00:00").toISOString(),
  sport_type: "Run",
  title: "Secret Morning Run",
  duration_sec: 2490,
  distance_m: 8208,
  elevation_m: 61,
  avg_hr: 152,
});
const emptyCardio = { miles: "", time: "", pace: "" };

describe("StravaCardioRow", () => {
  it("renders the suggestion with the required Strava deep link", () => {
    const { container } = wrap(
      <StravaCardioRow activities={[act]} cardio={emptyCardio} cardioSessions={{}} dateKey="2026-07-08" onApply={() => {}} />
    );
    expect(screen.getByText(/Use for today/)).toBeTruthy();
    expect(screen.getByText(/Not counted yet/i)).toBeTruthy();
    const link = container.querySelector('a[href="https://www.strava.com/activities/42"]');
    expect(link).toBeTruthy();
    expect(link.textContent).toMatch(/View on Strava/);
  });

  it("applies miles + mm:ss time through the caller's setter", () => {
    const onApply = vi.fn();
    wrap(<StravaCardioRow activities={[act]} cardio={emptyCardio} cardioSessions={{}} dateKey="2026-07-08" onApply={onApply} />);
    fireEvent.click(screen.getByText(/Use for today/));
    expect(onApply).toHaveBeenCalledTimes(1);
    const fill = onApply.mock.calls[0][0];
    expect(parseFloat(fill.miles)).toBeCloseTo(5.1, 1);
    expect(fill.time).toMatch(/^\d+:\d{2}$/);
    expect(formatMinutesAsTime(41.5)).toBe("41:30");
  });

  it("stays hidden when manual cardio already exists, in either shape", () => {
    expect(hasManualCardio({ miles: "3" }, {})).toBe(true);
    expect(hasManualCardio(emptyCardio, { am: { miles: "2" } })).toBe(true);
    const { container } = wrap(
      <StravaCardioRow activities={[act]} cardio={{ ...emptyCardio, miles: "3" }} cardioSessions={{}} dateKey="2026-07-08" onApply={() => {}} />
    );
    expect(container.textContent).toBe("");
  });

  it("dismiss hides the row and is remembered for that day", () => {
    const first = wrap(
      <StravaCardioRow activities={[act]} cardio={emptyCardio} cardioSessions={{}} dateKey="2026-07-08" onApply={() => {}} />
    );
    fireEvent.click(screen.getByText("Dismiss"));
    expect(first.container.textContent).toBe("");
    cleanup();
    const again = wrap(
      <StravaCardioRow activities={[act]} cardio={emptyCardio} cardioSessions={{}} dateKey="2026-07-08" onApply={() => {}} />
    );
    expect(again.container.textContent).toBe("");
  });

  it("sums a multi-activity day, runs first", () => {
    const second = { ...act, miles: 2.4, minutes: 20, kind: "run", title: "Shakeout" };
    const fill = buildCardioFillFromActivities([act, second]);
    expect(parseFloat(fill.miles)).toBeCloseTo(7.5, 1);
    expect(fill.count).toBe(2);
  });
});

describe("Strava never reaches coach payloads", () => {
  const entries = {
    "2026-07-08": {
      workout: { exercises: {}, cardio: { miles: "5.1", time: "41:30", pace: "8:08" }, notes: "" },
      nutrition: { calories: "3200", protein: "205" },
      body: { weight: "208", sleep: "7.5", energy: "8", soreness: "3" },
    },
  };

  it("buildSlice output contains no strava strings or activity titles", () => {
    const slice = buildSlice({
      data: entries,
      settings: { goals: { calories: 3400, protein: 200 } },
      program: null,
      todayKey: "2026-07-08",
      todayName: "Wednesday",
    });
    const serialized = JSON.stringify(slice);
    expect(serialized).not.toMatch(/strava/i);
    expect(serialized).not.toMatch(/Secret Morning Run/);
  });

  it("buildCoachContext (wearableSummary) has no strava inputs or strings", () => {
    const summary = buildCoachContext({
      ouraData: { "2026-07-08": { readiness: { score: 78 } } },
      whoopData: { "2026-07-08": { recovery: { score: { recovery_score: 71 } } } },
      manualData: { sleep: "7.5" },
      settings: {},
    });
    expect(JSON.stringify(summary || "")).not.toMatch(/strava/i);
  });

  it("strava load-row notes carry counts, never titles, even when serialized", () => {
    const date = "2026-07-08";
    const rows = buildWearableLoadRows({
      entries: { [date]: { workout: { exercises: {}, cardio: { miles: "", time: "", pace: "" } } } },
      stravaByDate: { [date]: [act] },
      maxDays: 2,
      asOf: new Date(`${date}T18:00:00`),
    });
    expect(JSON.stringify(rows)).not.toMatch(/Secret Morning Run/);
    expect(stravaLoadForDay([act]).note).not.toMatch(/Secret/);
  });
});
