// src/__tests__/ouraSignals.test.jsx
// Oura beyond sleep and readiness: daytime stress on Today, which fills an
// unanswered check-in stress (and says so), and tonight's bedtime window in
// the evening, on Today and in the evening check-in reminder.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bedtimeText, checkinStress, formatMinutes, stressSentence } from "../oura/extrasView";
import { remindersFor, rememberBedtime } from "../reminders/localReminders";

const extras = vi.hoisted(() => ({ value: null, tags: null }));
vi.mock("../oura/extras", () => ({
  loadOuraExtras: vi.fn(async () => extras.value),
  loadOuraTags: vi.fn(async () => extras.tags),
  forgetOuraExtras: vi.fn(),
}));
vi.mock("../oura/auth", () => ({ getOuraAuthUrl: vi.fn(async () => null) }));

import { OuraBedtimeLine, OuraStressLine } from "../sections/OuraSignals";
import { MorningCheckin } from "../MorningCheckin";

const TODAY = "2026-11-26";
const STRESS = [
  { day: "2026-11-25", summary: "stressful", stressMinutes: 130, recoveryMinutes: 35 },
  { day: "2026-11-26", summary: null, stressMinutes: 20, recoveryMinutes: null },
];

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); extras.value = null; extras.tags = null; delete window.Capacitor; });

describe("reading Oura's extras", () => {
  it("puts stress in words", () => {
    expect(formatMinutes(130)).toBe("2\u00a0h 10\u00a0min");
    expect(formatMinutes(45)).toBe("45\u00a0min");
    expect(stressSentence(STRESS, TODAY)).toBe("Yesterday was stressful: 2\u00a0h 10\u00a0min stressed, 35\u00a0min restored. Today so far: 20\u00a0min stressed.");
    expect(stressSentence([], TODAY)).toBe("");
    expect(checkinStress(STRESS, TODAY)).toBe(8);
    expect(checkinStress([{ day: "2026-11-25", summary: "restored" }], TODAY)).toBe(2);
  });

  it("writes the bedtime window as clock times", () => {
    expect(bedtimeText({ startMinutes: -75, endMinutes: -30 })).toBe("10:45\u00a0pm to 11:30\u00a0pm");
    expect(bedtimeText({ startMinutes: -60, endMinutes: 15 })).toBe("11\u00a0pm to 12:15\u00a0am");
    expect(bedtimeText(null)).toBe("");
  });
});

function TodayHarness({ initial = {} }) {
  const [body, setBody] = useState(initial);
  const updateToday = (path, value) => setBody((prev) => ({ ...prev, [path.replace("body.", "")]: value }));
  return (
    <>
      <MorningCheckin body={body} updateToday={updateToday} />
      <OuraStressLine enabled todayKey={TODAY} body={body} updateToday={updateToday} fill />
      <output data-testid="stress">{`${body.stress ?? ""}|${body.stressFrom ?? ""}`}</output>
    </>
  );
}

describe("daytime stress on Today", () => {
  it("shows yesterday and today, and fills an unanswered check-in stress", async () => {
    extras.value = { stress: STRESS, resilience: [], bedtime: null };
    render(<TodayHarness />);
    expect(await screen.findByText(/^Yesterday was stressful/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("stress").textContent).toBe("8|oura"));
    expect(screen.getByText("From Oura’s daytime stress yesterday. Tap to change it.")).toBeTruthy();

    // Your own answer replaces it.
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Stress" })).getByRole("radio", { name: "low" }));
    expect(screen.getByTestId("stress").textContent).toBe("2|");
    expect(screen.queryByText(/From Oura’s daytime stress/)).toBeNull();
  });

  it("leaves a stress you already gave alone", async () => {
    extras.value = { stress: STRESS, resilience: [], bedtime: null };
    render(<TodayHarness initial={{ stress: "5" }} />);
    await screen.findByText(/^Yesterday was stressful/);
    expect(screen.getByTestId("stress").textContent).toBe("5|");
  });

  it("says nothing without Oura's stress", async () => {
    extras.value = { stress: [], resilience: [], bedtime: null };
    const { container } = render(<OuraStressLine enabled todayKey={TODAY} body={{}} updateToday={vi.fn()} />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});

describe("the bedtime window", () => {
  it("shows in the evening", async () => {
    extras.value = { stress: [], resilience: [], bedtime: { day: TODAY, startMinutes: -75, endMinutes: -30 } };
    render(<OuraBedtimeLine enabled now={new Date(2026, 10, 26, 20, 0)} />);
    expect((await screen.findByTestId("oura-bedtime")).textContent).toBe("Bedtime tonight: 10:45\u00a0pm to 11:30\u00a0pm, Oura’s window for you.");
  });

  it("waits until the evening", async () => {
    extras.value = { stress: [], resilience: [], bedtime: { day: TODAY, startMinutes: -75, endMinutes: -30 } };
    const { container } = render(<OuraBedtimeLine enabled now={new Date(2026, 10, 26, 9, 0)} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe("");
  });

  it("joins the evening check-in reminder, and the phone gets the new words", async () => {
    const plugin = { set: vi.fn(async () => ({ allowed: true })) };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { OTReminders: plugin } };
    localStorage.setItem("ovt-local-reminders", JSON.stringify({ checkin: true }));
    const now = new Date(2026, 10, 26, 12, 0);
    rememberBedtime({ startMinutes: -75, endMinutes: -30 }, { now });
    await waitFor(() => expect(plugin.set).toHaveBeenCalledTimes(1));
    const [checkin] = JSON.parse(plugin.set.mock.calls[0][0].reminders);
    expect(checkin.body).toBe("Log sleep, energy, and soreness — tomorrow's call depends on tonight's data. Bedtime tonight: 10:45\u00a0pm to 11:30\u00a0pm, Oura’s window for you.");

    // The same window again sends nothing.
    rememberBedtime({ startMinutes: -75, endMinutes: -30 }, { now });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plugin.set).toHaveBeenCalledTimes(1);

    // A week-old window says nothing about tonight.
    const later = new Date(2026, 11, 5, 12, 0);
    expect(remindersFor({ checkin: true }, { now: later, days: [] })[0].body).toBe("Log sleep, energy, and soreness — tomorrow's call depends on tonight's data.");
  });
});
