// src/__tests__/runningProgress.test.jsx
// Progress → Running: races with the best marked, the times your fitness
// predicts, easy pace and ground per heartbeat.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DAYS } from "../constants";
import { RunningProgress } from "../sections/RunningProgress";

afterEach(cleanup);

const rest = { type: "Rest", lifting: [], cardio: null };
const program = { ...Object.fromEntries(DAYS.map((day) => [day, rest])), Monday: { type: "Easy", lifting: [], cardio: { type: "Easy Run", effort: "Easy" } } };
const data = {
  "2026-11-02": { workout: { cardio: { miles: "4", time: "42:40", hr: "147" } } },
  "2026-11-09": { workout: { cardio: { miles: "4", time: "41:20", hr: "142" } } },
  "2026-11-16": { workout: { cardio: { miles: "5", time: "50:00", hr: "141" } } },
  "2026-11-23": { workout: { cardio: { miles: "4", time: "39:20", hr: "140" } } },
  "2026-10-04": { workout: { cardio: { miles: "3.1", race: { distance: "5k", seconds: 1500 } } } },
  "2026-11-26": { workout: { cardio: { miles: "3.1", race: { distance: "5k", seconds: 1450, name: "Turkey Trot" } } } },
};

describe("RunningProgress", () => {
  it("lists races with the best one marked, and predicts the other distances from the latest", () => {
    render(<RunningProgress data={data} program={program} todayKey="2026-11-26" />);
    const races = screen.getByRole("heading", { name: "Races" }).closest("section");
    const rows = within(races).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Turkey Trot.*5K in 24:10.*PR$/),
      expect.stringMatching(/^5K race.*5K in 25:00/),
    ]);
    const predicted = screen.getByRole("heading", { name: "Race times you’re ready for" }).closest("section");
    expect(within(predicted).getByText(/Predicted from your Turkey Trot 5K on Thu, Nov 26/)).toBeTruthy();
    expect(within(predicted).getByText("Half marathon")).toBeTruthy();
  });

  it("lists a trail finish outside road prediction range and keeps the previous road benchmark", () => {
    const entries = { ...data, "2026-11-27": { workout: { cardio: {
      race: { surface: "trail", distance: "15k", seconds: 13500, name: "Ridge" },
    } } } };
    render(<RunningProgress data={entries} program={program} todayKey="2026-11-27" />);
    expect(screen.getByText(/Trail 15K in 3:45:00/)).toBeTruthy();
    expect(screen.getByText("Trail best")).toBeTruthy();
    expect(screen.getByText(/Predicted from your Turkey Trot/)).toBeTruthy();
  });

  it("shows easy pace and ground per heartbeat from easy runs only", () => {
    render(<RunningProgress data={data} program={program} todayKey="2026-11-26" />);
    const easy = screen.getByRole("heading", { name: "Easy runs" }).closest("section");
    expect(within(easy).getByText(/Average easy pace over the last four weeks, 4 runs/)).toBeTruthy();
    expect(within(easy).getByText(/Each heartbeat carries you \d\.\d\d\sm on easy runs lately/)).toBeTruthy();
  });

  it("says how to start when there's nothing yet", () => {
    render(<RunningProgress data={{}} program={program} todayKey="2026-11-26" />);
    expect(screen.getByText(/Mark a run as a race on Today/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Easy runs" })).toBeNull();
  });
});
