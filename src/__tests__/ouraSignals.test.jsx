// src/__tests__/ouraSignals.test.jsx
// Oura beyond sleep and readiness: daytime stress on Today, which fills an
// unanswered check-in stress (and says so); tonight's bedtime window in the
// evening, on Today and in the evening check-in reminder; resilience and
// what follows your tags in Recovery, with a reconnect for the tag
// permission.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bedtimeText, checkinStress, effectText, formatMinutes, resilienceView, stressSentence, tagEffects } from "../oura/extrasView";
import { remindersFor, rememberBedtime } from "../reminders/localReminders";

const extras = vi.hoisted(() => ({ value: null, tags: null }));
vi.mock("../oura/extras", () => ({
  loadOuraExtras: vi.fn(async () => extras.value),
  loadOuraTags: vi.fn(async () => extras.tags),
  forgetOuraExtras: vi.fn(),
}));
vi.mock("../oura/auth", () => ({ getOuraAuthUrl: vi.fn(async () => null) }));

import { OuraBedtimeLine, OuraRecoveryExtras, OuraStressLine } from "../sections/OuraSignals";
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

  it("calls for a lighter week after three limited days", () => {
    const view = resilienceView([{ day: "2026-11-23", level: "solid" }, { day: "2026-11-24", level: "limited" }, { day: "2026-11-25", level: "limited" }, { day: "2026-11-26", level: "limited" }]);
    expect(view).toMatchObject({ limitedStreak: 3, lighterWeek: true });
    expect(view.days.map((day) => day.rank)).toEqual([3, 1, 1, 1]);
    expect(resilienceView([{ day: "2026-11-26", level: "strong" }]).lighterWeek).toBe(false);
    expect(resilienceView([])).toBeNull();
  });

  it("writes the bedtime window as clock times", () => {
    expect(bedtimeText({ startMinutes: -75, endMinutes: -30 })).toBe("10:45\u00a0pm to 11:30\u00a0pm");
    expect(bedtimeText({ startMinutes: -60, endMinutes: 15 })).toBe("11\u00a0pm to 12:15\u00a0am");
    expect(bedtimeText(null)).toBe("");
  });

  it("compares the mornings after a tag with the other mornings", () => {
    const mornings = [];
    const tags = [];
    for (let day = 1; day <= 20; day += 1) {
      const key = `2026-11-${String(day).padStart(2, "0")}`;
      const afterSauna = day % 4 === 1 && day > 1;
      mornings.push({ day: key, readiness: afterSauna ? 84 : 80, hrv: afterSauna ? 66 : 60, restingHr: afterSauna ? 47 : 49 });
      if (day % 4 === 0) tags.push({ day: key, label: "Sauna" });
    }
    tags.push({ day: "2026-11-02", label: "Alcohol" });
    const { effects, few } = tagEffects({ tags, mornings });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ label: "Sauna", nights: 4, hrv: { after: 66, others: 60, change: 6 }, readiness: { change: 4 }, restingHr: { change: -2 } });
    expect(effectText(effects[0])).toBe("HRV +6\u00a0ms, readiness +4, resting heart rate −2\u00a0bpm");
    expect(few).toEqual([{ label: "Alcohol", nights: 1 }]);
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

describe("Recovery", () => {
  it("shows resilience and what follows each tag", async () => {
    extras.value = { stress: [], bedtime: null, resilience: [{ day: "2026-11-24", level: "limited", sleepRecovery: 40, daytimeRecovery: 20, stress: 30 }, { day: "2026-11-25", level: "limited" }, { day: "2026-11-26", level: "limited", sleepRecovery: 41, daytimeRecovery: 22, stress: 35 }] };
    const mornings = Array.from({ length: 12 }, (_, index) => ({ day: `2026-11-${String(index + 10).padStart(2, "0")}`, readiness: index % 3 === 0 ? 70 : 80, hrv: index % 3 === 0 ? 50 : 60, restingHr: null }));
    extras.tags = { needsReconnect: false, days: 90, mornings, tags: [{ day: "2026-11-09", label: "Alcohol" }, { day: "2026-11-12", label: "Alcohol" }, { day: "2026-11-15", label: "Alcohol" }, { day: "2026-11-18", label: "Alcohol" }, { day: "2026-11-14", label: "Late meal" }] };
    render(<OuraRecoveryExtras enabled />);
    expect(await screen.findByRole("heading", { name: "Resilience" })).toBeTruthy();
    expect(screen.getByText("Limited")).toBeTruthy();
    expect(screen.getByText("Out of 100: sleep recovery 41, daytime recovery 22, stress 35.")).toBeTruthy();
    expect(screen.getByText("Limited 3 days running. A lighter week usually lets it build back.")).toBeTruthy();
    expect(await screen.findByText("4 mornings after: HRV −10 ms, readiness −10")).toBeTruthy();
    expect(screen.getByText("Too few mornings yet for late meal (1). Each needs 3.")).toBeTruthy();
  });

  it("asks to reconnect when Oura hasn't shared tags", async () => {
    extras.value = null;
    extras.tags = { needsReconnect: true, tags: [], mornings: [] };
    render(<OuraRecoveryExtras enabled />);
    expect(await screen.findByRole("button", { name: "Reconnect Oura" })).toBeTruthy();
    expect(screen.getByText(/Oura shares tags only with your permission/)).toBeTruthy();
  });
});
