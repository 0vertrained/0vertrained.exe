// src/__tests__/runPaceCheck.test.js
// A logged easy run is held to the plan's easy range: on target, quicker or
// slower. Runs with faster parts, or planned by effort alone, get nothing.
import { describe, expect, it } from "vitest";
import { loggedPace, paceCheck, paceCheckText, parseClock, targetRange } from "../runPaceCheck";

const easyRun = {
  type: "Easy Run", minutes: 30, effort: "Easy", targetPace: "10:11–11:12/mi",
  steps: [{ kind: "run", minutes: 30, intensity: "easy" }, { kind: "strides", reps: 4, seconds: 20 }],
};

describe("parseClock", () => {
  it("reads minutes and seconds, and hours", () => {
    expect(parseClock("8:06")).toBe(486);
    expect(parseClock("95:20")).toBe(5720);
    expect(parseClock("1:35:20")).toBe(5720);
    expect(parseClock("8:6")).toBeNull();
    expect(parseClock("")).toBeNull();
  });
});

describe("targetRange", () => {
  it("is the easy range of a steady easy run", () => {
    expect(targetRange(easyRun)).toEqual({ fast: 611, slow: 672, label: "10:11–11:12/mi" });
  });

  it("is nothing for a run with faster parts or no range", () => {
    expect(targetRange({ ...easyRun, steps: [{ kind: "run", minutes: 40, intensity: "easy" }, { kind: "run", minutes: 10, intensity: "race" }] })).toBeNull();
    expect(targetRange({ type: "Threshold Run", targetPace: "8:29/mi", steps: [{ kind: "warmup", minutes: 10, intensity: "easy" }, { kind: "repeat", reps: 3, work: { minutes: 5, intensity: "threshold" } }] })).toBeNull();
    expect(targetRange({ type: "Long Run", miles: 5.5, effort: "Zone 2" })).toBeNull();
  });
});

describe("loggedPace", () => {
  it("takes the Pace field, or works it out from Miles and Time", () => {
    expect(loggedPace({ pace: "10:30" })).toBe(630);
    expect(loggedPace({ miles: "3", time: "31:30" })).toBe(630);
    expect(loggedPace({ miles: "3" })).toBeNull();
  });
});

describe("paceCheck", () => {
  it("says whether the run sat inside the range", () => {
    expect(paceCheck(easyRun, { pace: "10:30" })).toMatchObject({ status: "on", pace: 630 });
    expect(paceCheck(easyRun, { pace: "9:40" })).toMatchObject({ status: "fast" });
    expect(paceCheck(easyRun, { pace: "11:30" })).toMatchObject({ status: "slow" });
    expect(paceCheck(easyRun, {})).toBeNull();
  });

  it("reads as one sentence", () => {
    expect(paceCheckText(paceCheck(easyRun, { pace: "10:30" }))).toBe("On target: 10:30/mi, inside the easy range of 10:11–11:12/mi.");
    expect(paceCheckText(paceCheck(easyRun, { pace: "9:40" }))).toBe("Quicker than planned: 9:40/mi against an easy range of 10:11–11:12/mi. Keep easy days conversational.");
    expect(paceCheckText(paceCheck(easyRun, { pace: "11:30" }))).toBe("Slower than planned: 11:30/mi against an easy range of 10:11–11:12/mi. That's fine on an easy day.");
  });
});
