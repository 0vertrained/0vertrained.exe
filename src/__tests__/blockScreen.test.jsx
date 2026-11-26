// The Block, mounted: where this week sits, what it is for, one suggestion,
// and settings that stay a draft until saved. It lives under Train, and it
// never rewrites a program.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ShellProvider, useShellBar } from "../ui/shell";
import { BlockScreen } from "../BlockScreen";
import { TrainTab } from "../TrainTab";
import { DEFAULT_PROGRAM } from "../constants";
import { PERIODIZATION_STORAGE_KEY, PERIODIZATION_HISTORY_KEY } from "../periodizationSettings";

const pad = (value) => String(value).padStart(2, "0");
const keyDaysAgo = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const set = (weight, reps) => ({ weight: String(weight), reps: String(reps), rir: "2", done: true });

// Sixteen logged days ending today, so the block is in its third week.
function logged() {
  const data = {};
  for (let offset = 15; offset >= 0; offset--) {
    const lifting = offset % 2 === 0;
    data[keyDaysAgo(offset)] = {
      workout: {
        exercises: lifting ? { "Bench Press": { sets: [set(205, 5), set(205, 5)] } } : {},
        cardio: lifting ? {} : { miles: "3", time: "27:00", pace: "9:00" },
      },
      nutrition: { calories: "2800", protein: "180" },
      body: { weight: "182", sleep: "7.5", energy: "7", soreness: "3" },
    };
  }
  return data;
}

function Bar() {
  const bar = useShellBar();
  if (!bar) return null;
  return <header data-testid="bar"><h1>{bar.title}</h1>{bar.back && <button type="button" onClick={bar.onBack}>{`Back to ${bar.back}`}</button>}</header>;
}

const frame = (children) => render(<ThemeProvider><ShellProvider><Bar />{children}</ShellProvider></ThemeProvider>);

function mount(props = {}) {
  const onOpenProgram = vi.fn();
  const view = frame(<BlockScreen data={logged()} settings={{}} program={DEFAULT_PROGRAM} onOpenProgram={onOpenProgram} {...props} />);
  return { ui: within(view.container), container: view.container, onOpenProgram };
}

const stored = () => JSON.parse(window.localStorage.getItem(PERIODIZATION_STORAGE_KEY) || "null");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the Block", () => {
  it("says which week this is and marks it on the strip", () => {
    const { ui } = mount();
    expect(ui.getByRole("heading", { level: 2, name: "Current Block" })).toBeTruthy();
    expect(ui.getByText("Week 3 of 4. Deload in week 4.")).toBeTruthy();
    expect(ui.getByText(/^\w{3} \d+ to \w{3} \d+\. Running: maintain\. Strength: maintain\.$/)).toBeTruthy();
    const strip = within(ui.getByRole("list", { name: "Block weeks" }));
    const weeks = strip.getAllByRole("listitem");
    expect(weeks.map((week) => week.textContent)).toEqual(["1Done", "2Done", "3Now", "4Deload"]);
    expect(weeks[2].getAttribute("aria-current")).toBe("step");
    expect(weeks.filter((week) => week.getAttribute("aria-current"))).toHaveLength(1);
  });

  it("gives the week's purpose, then one suggestion that changes nothing", () => {
    const { ui, onOpenProgram } = mount();
    expect(ui.getByRole("heading", { level: 3, name: /^This week: \w+/ })).toBeTruthy();
    const suggestion = ui.getByRole("heading", { level: 3, name: "One suggestion" }).closest("section");
    expect(within(suggestion).getByText("Suggestions never edit your program.")).toBeTruthy();
    expect(within(suggestion).getByText(/risk$/)).toBeTruthy();
    fireEvent.click(within(suggestion).getByRole("button", { name: "Open the program" }));
    expect(onOpenProgram).toHaveBeenCalledTimes(1);
    // Looking at the block saved nothing.
    expect(stored()).toBeNull();
  });

  it("keeps every week behind one row on a phone", () => {
    const { ui } = mount();
    const row = ui.getByRole("button", { name: /All weeks/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(ui.queryByRole("table")).toBeNull();
    fireEvent.click(row);
    const table = within(ui.getByRole("table", { name: "The weeks of this block" }));
    expect(table.getAllByRole("row")).toHaveLength(5);
    expect(table.getByText("65%")).toBeTruthy();
  });

  it("carries the race under the suggestion", () => {
    const { ui } = mount();
    expect(ui.getByRole("heading", { level: 3, name: "Race" })).toBeTruthy();
    expect(ui.getByText(/No race on the calendar\./)).toBeTruthy();
  });
});

describe("Block settings", () => {
  const open = (ui) => {
    fireEvent.click(ui.getByRole("button", { name: /Block settings/ }));
    return ui;
  };

  it("holds a change as a draft, says what will change, and saves on Save", () => {
    const { ui } = mount();
    open(ui);
    const save = ui.getByRole("button", { name: "Save block" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(stored()).toBeNull();

    fireEvent.change(ui.getByLabelText("Block name"), { target: { value: "Winter base" } });
    fireEvent.click(ui.getByRole("button", { name: "One week longer" }));
    // The page already reads the draft, and says it is not saved.
    expect(ui.getByRole("heading", { level: 2, name: "Winter base" })).toBeTruthy();
    expect(ui.getByText("Not saved yet")).toBeTruthy();
    expect(ui.getByText('Name changes from "Current Block" to "Winter base".')).toBeTruthy();
    expect(ui.getByText("Length changes from 4 to 5 weeks.")).toBeTruthy();
    expect(stored()).toBeNull();

    fireEvent.click(ui.getByRole("button", { name: "Save block" }));
    expect(stored()).toMatchObject({ name: "Winter base", blockLengthWeeks: 5, deloadWeek: 4 });
    expect(ui.queryByText("Not saved yet")).toBeNull();
    expect(ui.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("puts the draft back on Reset", () => {
    const { ui } = mount();
    open(ui);
    fireEvent.click(ui.getByRole("radio", { name: "Race prep" }));
    expect(ui.getByRole("radio", { name: "Race prep" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(ui.getByRole("button", { name: "Reset" }));
    expect(ui.getByRole("radio", { name: "Hybrid base" }).getAttribute("aria-checked")).toBe("true");
    expect(stored()).toBeNull();
  });

  it("keeps length within 4 to 8 weeks and the deload inside the block", () => {
    const { ui } = mount();
    open(ui);
    const shorter = ui.getByRole("button", { name: "One week shorter" });
    expect(shorter.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(shorter);
    expect(within(ui.getByRole("group", { name: "Length (weeks), 4 to 8" })).getByText("4")).toBeTruthy();
    const later = ui.getByRole("button", { name: "Later" });
    expect(later.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(ui.getByRole("button", { name: "Earlier" }));
    expect(within(ui.getByRole("group", { name: "Deload week, 1 to 4" })).getByText("3")).toBeTruthy();
    expect(ui.getByText("Deload moves from Week 4 to Week 3.")).toBeTruthy();
  });

  it("makes the goal one Tab stop, with the arrow keys moving the choice", () => {
    const { ui } = mount();
    open(ui);
    const group = ui.getByRole("radiogroup", { name: "Goal" });
    expect(group.className).toBe("chips");
    expect(within(group).getAllByRole("radio").filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(within(group).getByRole("radio", { name: "Strength build" }).getAttribute("aria-checked")).toBe("true");
    expect(within(group).getAllByRole("radio").filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
  });

  it("sets the emphasis for running and strength", () => {
    const { ui } = mount();
    open(ui);
    fireEvent.click(within(ui.getByRole("radiogroup", { name: "Running" })).getByRole("radio", { name: "Build" }));
    fireEvent.click(within(ui.getByRole("radiogroup", { name: "Strength" })).getByRole("radio", { name: "Deload" }));
    fireEvent.click(ui.getByRole("button", { name: "Save block" }));
    expect(stored()).toMatchObject({ runEmphasis: "build", strengthEmphasis: "deload" });
  });
});

describe("a block that has ended", () => {
  // The planner rolls a finished block forward into the next one of the same
  // shape, so a block only reads as ended when its start date is years old.
  it("offers the next block and keeps the old one under Past blocks", () => {
    window.localStorage.setItem(PERIODIZATION_STORAGE_KEY, JSON.stringify({ version: 1, name: "Autumn build", goalPreset: "strength_build", goal: "Add strength", startDate: keyDaysAgo(1500), blockLengthWeeks: 4, deloadWeek: 4, runEmphasis: "maintain", strengthEmphasis: "build" }));
    const { ui } = mount();
    expect(ui.getByText("This block has ended.")).toBeTruthy();
    expect(ui.queryByRole("button", { name: /Past blocks/ })).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Start next block" }));
    expect(ui.getByRole("heading", { level: 2, name: "Next Block" })).toBeTruthy();
    expect(ui.queryByText("This block has ended.")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PERIODIZATION_HISTORY_KEY))).toMatchObject([{ name: "Autumn build" }]);
    fireEvent.click(ui.getByRole("button", { name: /Past blocks/ }));
    expect(ui.getByText("Autumn build")).toBeTruthy();
  });
});

describe("the Block under Train", () => {
  it("opens from Train's plan rows with its own Back, and never leaves Train", async () => {
    const view = frame(<TrainTab program={DEFAULT_PROGRAM} liveProgram={DEFAULT_PROGRAM} entries={logged()} settings={{}} onSaveProgram={vi.fn()} onApplyGeneratedProgram={vi.fn()} onStartToday={vi.fn()} onOpenDay={vi.fn()} />);
    const ui = within(view.container);
    fireEvent.click(ui.getByRole("button", { name: /^Block/ }));
    expect(await ui.findByRole("heading", { level: 2, name: "Current Block" })).toBeTruthy();
    expect(within(ui.getByTestId("bar")).getByRole("heading", { name: "Block" })).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Back to Train" }));
    expect(ui.queryByRole("heading", { level: 2, name: "Current Block" })).toBeNull();
    expect(ui.getByRole("button", { name: /^Block/ })).toBeTruthy();
  });

  it("can be opened straight on the block, for the row on the weekly review", async () => {
    const view = frame(<TrainTab initialView="block" program={DEFAULT_PROGRAM} liveProgram={DEFAULT_PROGRAM} entries={logged()} settings={{}} onSaveProgram={vi.fn()} onApplyGeneratedProgram={vi.fn()} onStartToday={vi.fn()} onOpenDay={vi.fn()} />);
    expect(await within(view.container).findByRole("heading", { level: 2, name: "Current Block" })).toBeTruthy();
  });
});
