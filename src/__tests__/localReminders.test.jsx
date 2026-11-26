// src/__tests__/localReminders.test.jsx
// In an iPhone app build that can schedule its own reminders, Notifications
// offers the evening check-in and the Sunday Edition, off until turned on,
// with the server's words and times. A refusal from iOS turns the switch
// back off and says where to allow it. Elsewhere the web push card stays.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsCard } from "../NotificationsCard";
import { readReminderPrefs, remindersFor } from "../reminders/localReminders";

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
    expect(readReminderPrefs()).toEqual({ checkin: false, sunday: false });
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
    expect(readReminderPrefs()).toEqual({ checkin: true, sunday: false });

    fireEvent.click(screen.getByRole("switch", { name: "Evening check-in" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Evening check-in off"));
    expect(scheduled(plugin)).toEqual([]);
    expect(readReminderPrefs()).toEqual({ checkin: false, sunday: false });
  });

  it("turns the switch back off when iOS doesn't allow notifications", async () => {
    installReminders(false);
    render(<NotificationsCard showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "The Sunday Edition" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Turn them on in the iPhone’s Settings app/));
    expect(screen.getByRole("switch", { name: "The Sunday Edition" }).getAttribute("aria-checked")).toBe("false");
    expect(readReminderPrefs()).toEqual({ checkin: false, sunday: false });
  });

  it("keeps the web push card in a browser", () => {
    render(<NotificationsCard showToast={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Reminders on this iPhone" })).toBeNull();
    expect(screen.getByRole("heading", { name: /^Notifications are/ })).toBeTruthy();
  });
});
