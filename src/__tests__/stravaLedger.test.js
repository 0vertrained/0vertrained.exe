// src/__tests__/stravaLedger.test.js
// V13.3 · Strava → ledger: row mapping, day grouping, load formulas, fill
// priority, manual-canonical rule, and weekly running-volume dedupe.

import { describe, it, expect } from "vitest";
import { mapActivityRow, kindFor, groupStravaByDate, localDateKey, stravaActivityUrl } from "../strava/dataLoading";
import { stravaLoadForDay, buildWearableLoadRows } from "../wearableWorkoutLoad";
import { buildWeeklyRunVolume, mondayOf, manualMilesForDay } from "../runningVolume";

const noonLocal = (dateKey) => new Date(`${dateKey}T12:00:00`).toISOString();

const run = (over = {}) => mapActivityRow({
  id: "row-1",
  provider_activity_id: "987654",
  start_time: noonLocal("2026-07-08"),
  sport_type: "Run",
  title: "Secret Morning Run",
  duration_sec: 41 * 60 + 30,
  distance_m: 8208, // ≈ 5.1 mi
  elevation_m: 61,  // ≈ 200 ft
  avg_hr: 152,
  ...over,
});

describe("strava dataLoading mapping", () => {
  it("maps a run row to app units", () => {
    const a = run();
    expect(a.date).toBe("2026-07-08");
    expect(a.kind).toBe("run");
    expect(a.miles).toBeCloseTo(5.1, 1);
    expect(a.minutes).toBeCloseTo(41.5, 1);
    expect(a.elevationFt).toBe(200);
    expect(a.paceSecPerMile).toBeGreaterThan(7 * 60);
    expect(a.paceSecPerMile).toBeLessThan(9 * 60);
    expect(stravaActivityUrl(a)).toBe("https://www.strava.com/activities/987654");
  });

  it("classifies sports into run / ride / other", () => {
    expect(kindFor("TrailRun")).toBe("run");
    expect(kindFor("Hike")).toBe("run");
    expect(kindFor("VirtualRide")).toBe("ride");
    expect(kindFor("WeightTraining")).toBe("other");
    expect(kindFor(null)).toBe("other");
  });

  it("groups by local day and drops unmappable rows", () => {
    const grouped = groupStravaByDate([run(), run({ start_time: noonLocal("2026-07-09") }), null]);
    expect(Object.keys(grouped).sort()).toEqual(["2026-07-08", "2026-07-09"]);
    expect(localDateKey("not a date")).toBe(null);
  });
});

describe("stravaLoadForDay", () => {
  it("scores runs on the existing fill scale (miles×45 + elevation bump)", () => {
    const day = stravaLoadForDay([run()]);
    expect(day.source).toBe("strava");
    expect(day.confidence).toBe("medium");
    expect(day.load).toBe(Math.round(5.1 * 45 + 200 * 0.045));
  });

  it("scores rides and other sports on their own factors, summed per day", () => {
    const ride = run({ sport_type: "Ride", distance_m: 32187, elevation_m: 0, duration_sec: 3600 }); // 20 mi
    const yoga = run({ sport_type: "Yoga", distance_m: 0, elevation_m: 0, duration_sec: 1800 }); // 30 min
    const day = stravaLoadForDay([ride, yoga]);
    expect(day.load).toBe(Math.round(20 * 14 + 30 * 5));
  });

  it("caps the day and never carries activity titles in the note", () => {
    const monster = run({ distance_m: 160934, duration_sec: 6 * 3600 }); // 100 mi
    const day = stravaLoadForDay([monster]);
    expect(day.load).toBe(900);
    expect(day.note).not.toMatch(/Secret Morning Run/);
    expect(day.note).toMatch(/1 activity/);
    expect(stravaLoadForDay([])).toBe(null);
  });
});

describe("buildWearableLoadRows with Strava", () => {
  const manualDay = {
    workout: {
      exercises: { Squat: { sets: [{ done: true, weight: "225", reps: "5" }] } },
      cardio: { miles: "", time: "", pace: "" },
    },
  };
  const emptyDay = { workout: { exercises: {}, cardio: { miles: "", time: "", pace: "" } } };

  it("fills an empty day from Strava ahead of Whoop/Oura and counts once", () => {
    const date = "2026-07-08";
    const rows = buildWearableLoadRows({
      entries: { [date]: emptyDay },
      stravaByDate: { [date]: [run()] },
      whoopData: { [date]: { workout: [{ score: { strain: 12 } }] } },
      maxDays: 2,
      asOf: new Date(`${date}T18:00:00`),
    });
    const day = rows.find((r) => r.date === date);
    expect(day.source).toBe("strava");
    expect(day.load).toBe(stravaLoadForDay([run()]).load);
    expect(day.notes.join(" ")).toMatch(/counted once/i);
    expect(day.wearableContext.length).toBeGreaterThanOrEqual(1);
  });

  it("never outranks a manual workout — Strava becomes context", () => {
    const date = "2026-07-08";
    const rows = buildWearableLoadRows({
      entries: { [date]: manualDay },
      stravaByDate: { [date]: [run()] },
      maxDays: 2,
      asOf: new Date(`${date}T18:00:00`),
    });
    const day = rows.find((r) => r.date === date);
    expect(day.source).toBe("manual+wearable-context");
    expect(day.confidence).toBe("high");
    expect(day.wearableContext.some((c) => c.source === "strava")).toBe(true);
  });
});

describe("weekly running volume dedupe", () => {
  it("anchors weeks on Monday", () => {
    expect(mondayOf("2026-07-08")).toBe("2026-07-06"); // Wed → that Monday
    expect(mondayOf("2026-07-05")).toBe("2026-06-29"); // Sun → previous Monday
  });

  it("counts each day once: manual wins, Strava fills the rest", () => {
    const entries = {
      "2026-07-06": { workout: { cardio: { miles: "3" }, exercises: {} } }, // manual 3
    };
    const stravaByDate = {
      "2026-07-06": [run({ start_time: noonLocal("2026-07-06") })], // ignored — manual exists
      "2026-07-07": [run({ start_time: noonLocal("2026-07-07") })], // fills 5.1
    };
    const vol = buildWeeklyRunVolume({ entries, stravaByDate, weeks: 2, asOf: new Date("2026-07-08T12:00:00") });
    expect(manualMilesForDay(entries["2026-07-06"])).toBe(3);
    expect(vol.thisWeekMiles).toBeCloseTo(8.1, 1);
    expect(vol.stravaContributed).toBe(true);
    const week = vol.weeks[vol.weeks.length - 1];
    expect(week.manualMiles).toBe(3);
    expect(week.stravaMiles).toBeCloseTo(5.1, 1);
  });
});
