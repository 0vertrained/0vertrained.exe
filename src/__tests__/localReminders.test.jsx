// src/__tests__/localReminders.test.jsx
// In an iPhone app build that can schedule its own reminders, Notifications
// offers the day's plan each morning, the evening check-in and the Sunday
// Edition, off until turned on, with the server's words and times and the
// plan's words for the mornings. A refusal from iOS turns the switch back
// off and says where to allow it. Elsewhere the web push card stays.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsCard } from "../NotificationsCard";
import { applyReminderPrefs, readReminderPrefs, rememberMorningPlan, remindersFor } from "../reminders/localReminders";

vi.mock("../supabaseClient", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

function installReminders(allowed = true) {
  const plugin = { set: vi.fn(async () => ({ allowed })) };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTReminders: plugin } };
  return plugin;
}

const scheduled = (plugin, call = -1) => JSON.parse(plugin.set.mock.calls.at(call)[0].reminders);

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  delete window.Capacitor;
  localStorage.clear();
});

describe("remindersFor", () => {
  it("asks for the switched-on reminders with the server's words and times", () => {
    expect(remindersFor({ checkin: true, sunday: true })).toEqual([
      { id: "checkin", title: "Evening check-in", body: "Log sleep, energy, and soreness — tomorrow's call depends on tonight's data.", hour: 19, minute: 30 },
      { id: "sunday", title: "The Sunday Edition is out", body: "Your week, one page — and the one change for the next.", hour: 17, minute: 0, weekday: 1 },
    ]);
    expect(remindersFor({ checkin: false, sunday: false })).toEqual([]);
  });

  it("starts with everything off", () => {
    expect(readReminderPrefs()).toEqual({ morning: false, checkin: false, sunday: false, morningTime: "06:30" });
  });

  it("asks for each weekday's next morning with that day's plan, at the chosen time", () => {
    const days = [
      { date: "2026-11-30", title: "Today: Upper A", body: "Bench Press · Easy run, 30 min" },
      { date: "2026-12-01", title: "Rest day", body: "Nothing is planned today." },
    ];
    expect(remindersFor({ morning: true, morningTime: "05:45" }, { days, now: new Date(2026, 10, 30, 5, 0) })).toEqual([
      { id: "morning-2", title: "Today: Upper A", body: "Bench Press · Easy run, 30 min", hour: 5, minute: 45, weekday: 2 },
      { id: "morning-3", title: "Rest day", body: "Nothing is planned today.", hour: 5, minute: 45, weekday: 3 },
    ]);
  });
});

describe("applyReminderPrefs", () => {
  it("sends the phone the reminders only when they've changed, if asked to", async () => {
    const plugin = installReminders();
    rememberMorningPlan([{ date: "2026-11-30", title: "Today: Upper A", body: "Bench Press" }]);
    const now = new Date(2026, 10, 30, 5, 0);
    const prefs = { morning: true, checkin: false, sunday: false, morningTime: "06:30" };
    await applyReminderPrefs(prefs, { onlyIfChanged: true, now });
    await applyReminderPrefs(prefs, { onlyIfChanged: true, now });
    expect(plugin.set).toHaveBeenCalledTimes(1);
    expect(scheduled(plugin).map((reminder) => reminder.id)).toEqual(["morning-2"]);

    rememberMorningPlan([{ date: "2026-11-30", title: "Today: Lower A", body: "Back Squat" }]);
    await applyReminderPrefs(prefs, { onlyIfChanged: true, now });
    expect(plugin.set).toHaveBeenCalledTimes(2);
    expect(scheduled(plugin)[0].title).toBe("Today: Lower A");
  });
});

describe("NotificationsCard in the iPhone app", () => {
  it("turns a reminder on and off", async () => {
    const plugin = installReminders();
    const showToast = vi.fn();
    render(<NotificationsCard showToast={showToast} />);
    expect(screen.getByRole("heading", { name: "Reminders on this iPhone" })).toBeTruthy();

    const checkin = screen.getByRole("switch", { name: "Evening check-in" });
    fireEvent.click(checkin);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Evening check-in on"));
    expect(scheduled(plugin).map((reminder) => reminder.id)).toEqual(["checkin"]);
    expect(readReminderPrefs()).toMatchObject({ checkin: true, sunday: false });

    fireEvent.click(screen.getByRole("switch", { name: "Evening check-in" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Evening check-in off"));
    expect(scheduled(plugin)).toEqual([]);
    expect(readReminderPrefs()).toMatchObject({ checkin: false, sunday: false });
  });

  it("turns on the morning plan and changes its time", async () => {
    const plugin = installReminders();
    rememberMorningPlan([{ date: "2099-01-05", title: "Today: Upper A", body: "Bench Press" }]);
    const showToast = vi.fn();
    render(<NotificationsCard showToast={showToast} />);
    fireEvent.click(screen.getByRole("switch", { name: "Today’s plan" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Today’s plan on"));
    expect(scheduled(plugin)[0]).toMatchObject({ id: "morning-2", title: "Today: Upper A", hour: 6, minute: 30 });
    expect(screen.getByText("Each morning at 6:30 am, with the day’s training.")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Time" }), { target: { value: "05:15" } });
    await waitFor(() => expect(scheduled(plugin)[0]).toMatchObject({ hour: 5, minute: 15 }));
    expect(readReminderPrefs()).toMatchObject({ morning: true, morningTime: "05:15" });
    expect(screen.getByText("Each morning at 5:15 am, with the day’s training.")).toBeTruthy();
  });

  it("turns the switch back off when iOS doesn't allow notifications", async () => {
    installReminders(false);
    render(<NotificationsCard showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "The Sunday Edition" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Turn them on in the iPhone’s Settings app/));
    expect(screen.getByRole("switch", { name: "The Sunday Edition" }).getAttribute("aria-checked")).toBe("false");
    expect(readReminderPrefs()).toMatchObject({ checkin: false, sunday: false });
  });

  it("keeps the web push card in a browser", () => {
    render(<NotificationsCard showToast={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Reminders on this iPhone" })).toBeNull();
    expect(screen.getByRole("heading", { name: /^Notifications are/ })).toBeTruthy();
  });
});
