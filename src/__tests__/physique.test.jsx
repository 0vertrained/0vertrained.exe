// src/__tests__/physique.test.jsx
// Shoulders, chest and arms are measured from Progress → Body, each with
// its latest reading and the change since the one before; shoulders over
// a waist measured within a week make the shoulder-to-waist ratio.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ShellProvider } from "../ui/shell";
import { ProgressTab } from "../ProgressTab";
import { getTodayKey } from "../constants";
import { latestReading, measurementSeries, shoulderToWaist } from "../physique";

const data = {
  "2026-10-01": { body: { shoulders: "47", waist: "34" } },
  "2026-10-20": { body: { chest: "40.5" } },
  "2026-11-01": { body: { shoulders: "47.5", arm: "15" } },
  "2026-11-04": { body: { waist: "33.5" } },
  "2026-11-20": { body: { shoulders: "48", chest: "41", waist: "nope" } },
};

describe("measurements", () => {
  it("read oldest first, skipping what isn't a measurement", () => {
    expect(measurementSeries(data, "waist")).toEqual([{ date: "2026-10-01", value: 34 }, { date: "2026-11-04", value: 33.5 }]);
  });

  it("say the latest and the change since the one before", () => {
    expect(latestReading(measurementSeries(data, "shoulders"))).toEqual({ value: 48, date: "2026-11-20", change: 0.5, since: "2026-11-01" });
    expect(latestReading(measurementSeries(data, "arm"))).toEqual({ value: 15, date: "2026-11-01", change: null, since: null });
    expect(latestReading([])).toBeNull();
  });

  it("pair shoulders with the waist nearest them within a week", () => {
    // Nov 20 has no waist within a week, so it isn't a ratio.
    expect(shoulderToWaist(data)).toEqual([{ date: "2026-10-01", value: 1.38 }, { date: "2026-11-01", value: 1.42 }]);
  });
});

function mount(entries) {
  const calls = { updateEntryAtDate: vi.fn(), showToast: vi.fn() };
  const view = render(
    <ThemeProvider>
      <ShellProvider>
        <ProgressTab data={entries} settings={{ goals: { protein: 200 } }} program={{}} loaded {...calls} />
      </ShellProvider>
    </ThemeProvider>
  );
  fireEvent.click(view.container.querySelector('[data-section="ov-trends"] li:nth-child(3) button'));
  return { ui: within(view.container), ...calls };
}

describe("Progress → Body", () => {
  it("shows each measurement and the ratio's trend", async () => {
    const { ui } = mount(data);
    const list = await ui.findByRole("list", { name: "Measurements" });
    const rows = within(list).getAllByRole("listitem").map((row) => row.textContent);
    expect(rows[0]).toMatch(/^Shoulders48\sin on Nov 20, up 0\.5\sin since Nov 1/);
    expect(rows[1]).toMatch(/^Chest41\sin on Nov 20, up 0\.5\sin since Oct 20/);
    expect(rows[2]).toMatch(/^Arms15\sin on Nov 1Add arms \(in\)$/);
    expect(ui.getByText(/^1\.42 on Nov 1, up 0\.04 since Oct 1\./)).toBeTruthy();
    expect(ui.getByRole("img", { name: /^Line chart of the shoulder-to-waist ratio over 2 measurements/ })).toBeTruthy();
  });

  it("saves a measurement to today", async () => {
    const { ui, updateEntryAtDate, showToast } = mount({});
    fireEvent.click(await ui.findByRole("button", { name: "Add shoulders (in)" }));
    fireEvent.change(ui.getByLabelText("Shoulders today (in)"), { target: { value: "48.5" } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    expect(updateEntryAtDate).toHaveBeenCalledWith(getTodayKey(), "body.shoulders", "48.5");
    expect(showToast).toHaveBeenCalledWith("Shoulders measurement saved");
    expect(ui.getByText("Measure your shoulders and waist to see how they compare.")).toBeTruthy();
  });
});
