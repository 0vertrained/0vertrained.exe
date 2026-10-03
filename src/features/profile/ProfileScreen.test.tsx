import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../app/ToastProvider";
import { AppDataProvider } from "../../data/AppDataProvider";
import rawMap from "../../data/fixtures/legacy-raw-map.json";
import { BACKUP_FORMAT } from "../../data/legacyImport";
import { createLocalSource, LOCAL_STORAGE_KEY } from "../../data/localSource";
import { useAppData } from "../../data/useAppData";
import { addDays, weekdayName } from "../../domain/dates";
import { plannedDay } from "../../domain/program/revisions";
import { expectNoA11yViolations } from "../../test/axe";
import { MemoryStorage } from "../../test/memoryStorage";
import { ProfileScreen } from "./ProfileScreen";

const TODAY = "2026-10-07"; // a Wednesday: the demo rotates its Full Body C session here
const TOMORROW = addDays(TODAY, 1);

function Harness({ storage, children }: { storage: MemoryStorage; children: ReactNode }) {
  const source = useState(() => createLocalSource(storage))[0];
  return (
    <AppDataProvider source={source}>
      <ToastProvider>
        <Seeded>{children}</Seeded>
      </ToastProvider>
    </AppDataProvider>
  );
}

function Seeded({ children }: { children: ReactNode }) {
  const { state, seedDemo } = useAppData();
  const [seeded, setSeeded] = useState(false);
  if (state.status !== "ready") return null;
  if (!seeded) {
    setSeeded(true);
    void seedDemo(TODAY);
    return null;
  }
  if (!state.settings.onboarded) return null;
  return <>{children}</>;
}

/** The stored state the page writes, readable from the DOM. */
function Probe() {
  const { state } = useAppData();
  const { program, settings, days } = state;
  const probe = {
    units: settings.units,
    bodyweightKg: settings.bodyweightKg ?? null,
    gameBodyweightKg: settings.game.bodyweightKg ?? null,
    pauses: settings.game.pauses ?? [],
    restSeconds: settings.session.restSeconds,
    sound: settings.session.sound,
    dayCount: Object.keys(days).length,
    revisions: program?.revisions.length ?? 0,
    today: program ? plannedDay(program, TODAY).title : null,
    tomorrow: program ? plannedDay(program, TOMORROW).title : null,
  };
  return <pre data-testid="probe">{JSON.stringify(probe)}</pre>;
}

const readProbe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as Record<string, unknown>;

function renderProfile() {
  const storage = new MemoryStorage();
  const utils = render(
    <Harness storage={storage}>
      <ProfileScreen todayKey={TODAY} />
      <Probe />
    </Harness>,
  );
  return { storage, ...utils };
}

describe("ProfileScreen", () => {
  beforeEach(() => {
    window.history.replaceState({ sheets: [] }, "", "#/profile");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the program as seven rows, the four panels and no Sign out, and passes axe", async () => {
    const { container } = renderProfile();
    await screen.findByRole("heading", { level: 1, name: "Profile" });
    const rows = within(screen.getByRole("list", { name: "Week" })).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(screen.getByRole("button", { name: /^Wed Full Body C/ })).toBeInTheDocument();
    for (const title of ["Program", "Settings", "Data", "About"]) expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText("Changes apply from tomorrow.")).toBeInTheDocument();
    expect(screen.getByText("Guest mode: everything stays on this device.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/legal/privacy-policy.html");
    expect(screen.queryByRole("button", { name: /Sign out/ })).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(0);
    await expectNoA11yViolations(container);
  });

  it("switches units and shows the bodyweight in them", async () => {
    renderProfile();
    await screen.findByRole("heading", { level: 1, name: "Profile" });
    expect(screen.getByRole("textbox", { name: "Bodyweight (kg)" })).toHaveValue("80");
    await userEvent.click(screen.getByRole("radio", { name: "lb · mi" }));
    expect(readProbe().units).toBe("imperial");
    expect(screen.getByRole("textbox", { name: "Bodyweight (lb)" })).toHaveValue("176.4");
  });

  it("commits the bodyweight on blur, in kg to one decimal, for the stat as well", async () => {
    renderProfile();
    const field = await screen.findByRole("textbox", { name: "Bodyweight (kg)" });
    await userEvent.clear(field);
    await userEvent.type(field, "82.26");
    await userEvent.tab();
    expect(readProbe()).toMatchObject({ bodyweightKg: 82.3, gameBodyweightKg: 82.3 });
  });

  it("starts a pause from the switch, shows the notice, takes a reason, and ends it", async () => {
    renderProfile();
    const pause = await screen.findByRole("switch", { name: /Pause training/ });
    expect(pause).toHaveAccessibleName(/\d+ of 14 protected days left this quarter/);
    await userEvent.click(pause);
    expect(readProbe().pauses).toEqual([{ from: TODAY, to: addDays(TODAY, 13), reason: "sick" }]);
    expect(screen.getByText(/Training paused for illness\. \d+ pause days left this quarter\./)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Reason" })).getByRole("radio", { name: "travel" }));
    expect(readProbe().pauses).toEqual([{ from: TODAY, to: addDays(TODAY, 13), reason: "travel" }]);
    expect(screen.getByText(/Training paused for travel/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: /Pause training/ }));
    expect(readProbe().pauses).toEqual([]);
    expect(screen.queryByText(/Training paused/)).not.toBeInTheDocument();
  });

  it("exports a v2 backup with today's day as a JSON download", async () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn((b: Blob) => { blobs.push(b); return "blob:test"; }) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderProfile();
    await userEvent.click(await screen.findByRole("button", { name: "Export backup" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs).toHaveLength(1);
    const parsed = JSON.parse(await blobs[0]!.text()) as { format: string; v: number; days: Record<string, unknown>; settings: { onboarded: boolean } };
    expect(parsed.format).toBe(BACKUP_FORMAT);
    expect(parsed.v).toBe(2);
    expect(parsed.days[TODAY]).toBeDefined();
    expect(parsed.settings.onboarded).toBe(true);
    expect(await screen.findByText("Backup saved.")).toBeInTheDocument();
  });

  it("imports a raw day map through the hidden file input, previewing it first and adding only missing days", async () => {
    const { container } = renderProfile();
    await screen.findByRole("heading", { level: 1, name: "Profile" });
    const before = readProbe().dayCount as number;
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File([JSON.stringify(rawMap)], "backup.json", { type: "application/json" });
    fireEvent.change(input!, { target: { files: [file] } });
    const sheet = await screen.findByRole("dialog", { name: "Import backup" });
    expect(within(sheet).getByText("Day log from the previous version")).toBeInTheDocument();
    expect(within(sheet).getByText("7")).toBeInTheDocument();
    expect(within(sheet).getByText("5 Jan 2026 – 12 Jan 2026")).toBeInTheDocument();
    expect(within(sheet).getByText("Skipped 1 entry that is not a dated day.")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: "Add missing days only" })).toBeChecked();
    expect(within(sheet).getByText("7 new days added. Days you already have stay as they are.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(readProbe().dayCount).toBe(before + 7));
    expect(await screen.findByText("Imported 7 days.")).toBeInTheDocument();
    expect(readProbe().today).toBe("Full Body C"); // the program stays
  });

  it("resets guest data behind a danger dialog, emptying storage and landing on #/", async () => {
    const { storage } = renderProfile();
    await userEvent.click(await screen.findByRole("button", { name: "Reset guest data" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reset guest data?" });
    expect(dialog).toHaveTextContent("Your log, records and titles are removed from this device. There is no undo.");
    expect(storage.getItem(LOCAL_STORAGE_KEY)).not.toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(storage.getItem(LOCAL_STORAGE_KEY)).toBeNull());
    expect(window.location.hash).toBe("#/");
    expect(screen.queryByRole("heading", { level: 1, name: "Profile" })).not.toBeInTheDocument();
  });

  it("saves a day edit as a revision effective tomorrow, leaving today's plan alone", async () => {
    renderProfile();
    await screen.findByRole("heading", { level: 1, name: "Profile" });
    const weekday = weekdayName(TOMORROW);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${weekday.slice(0, 3)} `) }));
    const sheet = await screen.findByRole("dialog", { name: weekday });
    const title = within(sheet).getByRole("textbox", { name: "Title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Edited day");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save day" }));
    await waitFor(() => expect(readProbe().tomorrow).toBe("Edited day"));
    expect(readProbe()).toMatchObject({ today: "Full Body C", revisions: 2 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: weekday })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: new RegExp(`^${weekday.slice(0, 3)} Edited day`) })).toBeInTheDocument();
  });
});
