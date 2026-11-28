// src/__tests__/localReminders.test.jsx
// In an iPhone app build that can schedule its own reminders, Notifications
// offers the day's plan each morning, the evening check-in and the Sunday
// Edition, off until turned on, with the server's words and times and the
// plan's words for the mornings. A refusal from iOS turns the switch back
// off and says where to allow it. Elsewhere the web push card stays.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { NotificationsCard } from "../NotificationsCard";
import { applyReminderPrefs, readReminderPrefs, rememberMorningPlan, remindersFor, rememberBedtime, readMorningPlan, setReminderOwner, writeReminderPrefs } from "../reminders/localReminders";

import { useMorningPlan } from "../reminders/useMorningPlan";
import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";

vi.mock("../supabaseClient", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

async function installReminders(allowed = true) {
  const plugin = { set: vi.fn(async ({ reminders }) => ({ allowed: reminders === "[]" || allowed })) };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { OTReminders: plugin } };
  await setReminderOwner("A");
  plugin.set.mockClear();
  return plugin;
}

const scheduled = (plugin, call = -1) => JSON.parse(plugin.set.mock.calls.at(call)[0].reminders);

beforeEach(() => localStorage.clear());

afterEach(async () => {
  cleanup();
  await setReminderOwner(null);
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
    expect(readReminderPrefs("A")).toEqual({ morning: false, checkin: false, sunday: false, morningTime: "06:30" });
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
    const plugin = await installReminders();
    rememberMorningPlan([{ date: "2026-11-30", title: "Today: Upper A", body: "Bench Press" }], "A");
    const now = new Date(2026, 10, 30, 5, 0);
    const prefs = { morning: true, checkin: false, sunday: false, morningTime: "06:30" };
    await applyReminderPrefs(prefs, { owner: "A", onlyIfChanged: true, now });
    await applyReminderPrefs(prefs, { owner: "A", onlyIfChanged: true, now });
    expect(plugin.set).toHaveBeenCalledTimes(1);
    expect(scheduled(plugin).map((reminder) => reminder.id)).toEqual(["morning-2"]);

    rememberMorningPlan([{ date: "2026-11-30", title: "Today: Lower A", body: "Back Squat" }], "A");
    await applyReminderPrefs(prefs, { owner: "A", onlyIfChanged: true, now });
    expect(plugin.set).toHaveBeenCalledTimes(2);
    expect(scheduled(plugin)[0].title).toBe("Today: Lower A");
  });
});

describe("NotificationsCard in the iPhone app", () => {
  it("turns a reminder on and off", async () => {
    const plugin = await installReminders();
    const showToast = vi.fn();
    render(<NotificationsCard owner="A" showToast={showToast} />);
    expect(screen.getByRole("heading", { name: "Reminders on this iPhone" })).toBeTruthy();

    const checkin = screen.getByRole("switch", { name: "Evening check-in" });
    fireEvent.click(checkin);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Evening check-in on"));
    expect(scheduled(plugin).map((reminder) => reminder.id)).toEqual(["checkin"]);
    expect(readReminderPrefs("A")).toMatchObject({ checkin: true, sunday: false });

    fireEvent.click(screen.getByRole("switch", { name: "Evening check-in" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Evening check-in off"));
    expect(scheduled(plugin)).toEqual([]);
    expect(readReminderPrefs("A")).toMatchObject({ checkin: false, sunday: false });
  });

  it("turns on the morning plan and changes its time", async () => {
    const plugin = await installReminders();
    rememberMorningPlan([{ date: "2099-01-05", title: "Today: Upper A", body: "Bench Press" }], "A");
    const showToast = vi.fn();
    render(<NotificationsCard owner="A" showToast={showToast} />);
    fireEvent.click(screen.getByRole("switch", { name: "Today’s plan" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Today’s plan on"));
    expect(scheduled(plugin)[0]).toMatchObject({ id: "morning-2", title: "Today: Upper A", hour: 6, minute: 30 });
    expect(screen.getByText("Each morning at 6:30 am, with the day’s training.")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Time" }), { target: { value: "05:15" } });
    await waitFor(() => expect(scheduled(plugin)[0]).toMatchObject({ hour: 5, minute: 15 }));
    expect(readReminderPrefs("A")).toMatchObject({ morning: true, morningTime: "05:15" });
    expect(screen.getByText("Each morning at 5:15 am, with the day’s training.")).toBeTruthy();
  });

  it("turns the switch back off when iOS doesn't allow notifications", async () => {
    await installReminders(false);
    render(<NotificationsCard owner="A" showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "The Sunday Edition" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Turn them on in the iPhone’s Settings app/));
    expect(screen.getByRole("switch", { name: "The Sunday Edition" }).getAttribute("aria-checked")).toBe("false");
    expect(readReminderPrefs("A")).toMatchObject({ checkin: false, sunday: false });
  });

  it("retries a denied schedule and never stores its signature as accepted", async () => {
    const plugin = await installReminders(false);
    const prefs = { checkin: true };
    const options = { owner: "A", onlyIfChanged: true };
    expect(await applyReminderPrefs(prefs, options)).toMatchObject({ allowed: false });
    plugin.set.mockResolvedValue({ allowed: true });
    expect(await applyReminderPrefs(prefs, options)).toMatchObject({ allowed: true });
    expect(plugin.set).toHaveBeenCalledTimes(2);
  });

  it("preserves the previous time and reports permission denial when iOS rejects a time change", async () => {
    const plugin = await installReminders();
    rememberMorningPlan([{ date: "2099-01-05", title: "Morning A" }], "A");
    writeReminderPrefs({morning: true, morningTime: "06:30"}, "A");
    plugin.set.mockResolvedValueOnce({allowed:false});
    render(<NotificationsCard owner="A" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Time" }), { target: { value: "05:30" } });
    await screen.findByRole("alert");
    expect(readReminderPrefs("A").morningTime).toBe("06:30");
  });

  it("lets an athlete switch a reminder off while iOS is denying other selected reminders", async () => {
    const plugin = await installReminders();
    writeReminderPrefs({ checkin:true, sunday:true }, "A");
    plugin.set.mockResolvedValueOnce({allowed:false});
    render(<NotificationsCard owner="A"/>);
    fireEvent.click(screen.getByRole("switch", {name:"Evening check-in"}));
    await screen.findByRole("alert");
    expect(readReminderPrefs("A")).toMatchObject({checkin:false,sunday:true});
  });

  it("separates plans, bedtime and preferences, even if an old request completes after sign-out", async () => {
    const plugin = await installReminders();
    let finish;
    plugin.set.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const now = new Date(2026, 10, 27, 5);
    rememberMorningPlan([{ date: "2026-11-27", title:"Private training A" }], "A");
    rememberBedtime({ startMinutes: -60, endMinutes: -30 }, { owner:"A", now });
    const old = applyReminderPrefs({ morning:true, checkin:true }, { owner:"A", now, savePrefs:true });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(JSON.stringify(scheduled(plugin))).toContain("Private training A");
    expect(JSON.stringify(scheduled(plugin))).toContain("Bedtime tonight");
    const clear = setReminderOwner(null);
    finish({allowed:true});
    expect(await old).toMatchObject({stale:true});
    await clear;
    expect(plugin.set.mock.lastCall[0]).toEqual({reminders:"[]", clearDelivered:true});
    expect(readReminderPrefs("A").morning).toBe(false);
    expect(readMorningPlan("A")).toEqual([]);
    expect(remindersFor({ checkin:true }, {owner:"A",now})[0].body).not.toContain("Bedtime tonight");

    writeReminderPrefs({ checkin:true, morningTime:"05:15" }, "A");
    await setReminderOwner("B");
    rememberMorningPlan([{ date: "2026-11-27", title:"Late A" }], "A");
    expect(await applyReminderPrefs({checkin:true}, {owner:"A"})).toMatchObject({stale:true});
    await applyReminderPrefs({ morning:true, checkin:true }, {owner:"B", now});
    expect(scheduled(plugin)).toHaveLength(1);
    expect(scheduled(plugin)[0].body).not.toContain("Bedtime tonight");
    expect(readReminderPrefs("B").morningTime).toBe("06:30");
    await setReminderOwner("A");
    expect(readReminderPrefs("A")).toMatchObject({checkin:true, morningTime:"05:15"});
  });

  it("clears unowned legacy content and the operating system queue when a signed-in user changes", async () => {
    const plugin = await installReminders();
    for (const key of ["ovt-morning-plan","ovt-oura-bedtime","ovt-local-reminders-set","ovt-local-reminders"])
      localStorage.setItem(key, JSON.stringify({ private: "unattributed", checkin:true }));
    const hook = renderHook(({owner,ready}) => useMorningPlan({ owner, ready, authReady:true }), { initialProps:{owner:"B",ready:false} });
    await waitFor(() => expect(plugin.set).toHaveBeenCalledWith({reminders:"[]",clearDelivered:true}));
    expect(readReminderPrefs("B").checkin).toBe(false);
    expect(JSON.stringify(localStorage)).not.toContain("unattributed");
    plugin.set.mockClear();
    hook.rerender({ owner:null,ready:false });
    await waitFor(() => expect(plugin.set).toHaveBeenCalledWith({reminders:"[]",clearDelivered:true}));
    act(() => window.dispatchEvent(new Event(APP_FOREGROUND_EVENT)));
    expect(scheduled(plugin)).toEqual([]);
  });

  it("keeps the web push card in a browser", () => {
    render(<NotificationsCard owner="A" showToast={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Reminders on this iPhone" })).toBeNull();
    expect(screen.getByRole("heading", { name: /^Notifications are/ })).toBeTruthy();
  });
});
