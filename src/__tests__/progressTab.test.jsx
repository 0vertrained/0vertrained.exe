// Progress, mounted: the home leads with the likely limiter and the doors to
// each trend; every trend is a screen with its own Back; History finds a day,
// opens it read-only and hands editing to Today.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ShellProvider, useShellBar } from "../ui/shell";
import { ProgressTab } from "../ProgressTab";
import { daySummary } from "../ProgressHistory";
import { getTodayKey } from "../constants";

const GOALS = { calories: 3400, protein: 200, carbs: 380, fats: 95, water: 128, workouts: 5, miles: 15 };
const pad = (value) => String(value).padStart(2, "0");
const keyDaysAgo = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const set = (weight, reps) => ({ weight: String(weight), reps: String(reps), rir: "2", done: true });

// Fourteen logged days ending today: a bench session every other day that
// gets heavier, a run on the days between, food and a check-in every day.
function logged() {
  const data = {};
  for (let offset = 13; offset >= 0; offset--) {
    const lifting = offset % 2 === 0;
    data[keyDaysAgo(offset)] = {
      workout: {
        exercises: lifting ? { "Bench Press": { sets: [set(225 - offset * 2, 5), set(205, 6), set(205, 6)] } } : {},
        cardio: lifting ? {} : { miles: "3", time: "27:00", pace: "9:00" },
        notes: offset === 3 ? "Left knee felt stiff on the warm-up" : "",
      },
      nutrition: { calories: "2800", protein: offset === 0 ? "205" : "170", carbs: "300", fats: "80", water: "100" },
      body: { weight: String(182 + offset * 0.1), sleep: "7.5", energy: "7", soreness: "3" },
    };
  }
  return data;
}

// The shell's top bar, reduced to what a screen asked it to show.
function Bar() {
  const bar = useShellBar();
  if (!bar) return null;
  return <header data-testid="bar"><h1>{bar.title}</h1>{bar.back && <button type="button" onClick={bar.onBack}>{`Back to ${bar.back}`}</button>}</header>;
}

function mount(props = {}) {
  const calls = { updateEntryAtDate: vi.fn(), showToast: vi.fn(), onOpenDay: vi.fn() };
  const view = render(
    <ThemeProvider>
      <ShellProvider>
        <Bar />
        <ProgressTab data={logged()} settings={{ goals: GOALS }} program={{}} loaded {...calls} {...props} />
      </ShellProvider>
    </ThemeProvider>
  );
  return { ui: within(view.container), container: view.container, ...calls };
}

describe("Progress home", () => {
  it("leads with one likely limiter and a way into the weekly review", () => {
    const { ui, container } = mount();
    const card = within(container.querySelector('[data-section="ov-verdict"]'));
    expect(card.getByText("The last 7 days · likely limiter")).toBeTruthy();
    expect(card.getByRole("heading", { level: 2 }).textContent).toBe("Protein and fueling");
    expect(card.getByText(/^17\d g a day on average against a 200 g goal · Get protein in earlier in the day\.$/)).toBeTruthy();
    expect(ui.getByRole("button", { name: "Open the weekly review" })).toBeTruthy();
    // No top bar of its own: the tab's title stands.
    expect(ui.queryByTestId("bar")).toBeNull();
  });

  it("lists the five trends, each with a fact from the log", () => {
    const { container } = mount();
    const rows = [...container.querySelectorAll('[data-section="ov-trends"] button')].map((row) => row.textContent);
    expect(rows.map((text) => text.match(/^(Strength|Running|Body|Recovery|History)/)?.[1])).toEqual(["Strength", "Running", "Body", "Recovery", "History"]);
    expect(rows[0]).toMatch(/Heaviest in the last 7 days: Bench Press, 225\slb/);
    expect(rows[4]).toMatch(/14 days logged, searchable/);
  });

  it("offers the Sunday Edition only while one is out", () => {
    const onOpenEdition = vi.fn();
    const out = mount({ onOpenEdition });
    fireEvent.click(out.ui.getByRole("button", { name: /^The Sunday Edition is out/ }));
    expect(onOpenEdition).toHaveBeenCalledTimes(1);
    expect(mount().ui.queryByRole("button", { name: /Sunday Edition/ })).toBeNull();
  });

  it("states the streak as a fact, with no pressure attached", () => {
    const { ui } = mount();
    expect(ui.getByText("Logging streak: 14 days.")).toBeTruthy();
    expect(ui.queryByText(/don.t break|keep it alive|at risk|lose your streak/i)).toBeNull();
  });
});

describe("Progress screens", () => {
  it("opens the weekly review with one recommendation, the numbers and a way back", () => {
    const { ui } = mount();
    fireEvent.click(ui.getByRole("button", { name: "Open the weekly review" }));
    expect(within(ui.getByTestId("bar")).getByRole("heading").textContent).toBe("Weekly review");
    expect(ui.getByText("One recommendation")).toBeTruthy();
    expect(ui.getByRole("table", { name: "The week in numbers" })).toBeTruthy();
    // Adherence has room either side, so it is called on target and says what that means.
    expect(ui.getByRole("rowheader", { name: "Protein on target" })).toBeTruthy();
    expect(ui.getByText("On target means protein at 90% of your goal or more, and calories within 10% of it.")).toBeTruthy();
    expect(ui.getByText(/^Likely limiter: protein and fueling\.$/)).toBeTruthy();
    expect(ui.getByText("This review never changes a target. You change them yourself in Settings.")).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Back to Progress" }));
    expect(ui.getByRole("button", { name: "Open the weekly review" })).toBeTruthy();
    expect(ui.queryByTestId("bar")).toBeNull();
  });

  it("saves this week's waist from the review, and says what is wrong with a bad entry", () => {
    const { ui, updateEntryAtDate, showToast } = mount();
    fireEvent.click(ui.getByRole("button", { name: "Open the weekly review" }));
    const field = ui.getByLabelText("This week’s waist (in)");
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    expect(ui.getByRole("alert").textContent).toBe("Enter your waist in inches, for example 32.5.");
    expect(updateEntryAtDate).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "32.5" } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    expect(updateEntryAtDate).toHaveBeenCalledWith(getTodayKey(), "body.waist", "32.5");
    expect(showToast).toHaveBeenCalledWith("Waist measurement saved");
  });

  it("shows one lift at a time on Strength, as a chart and as a table", async () => {
    const { ui, container } = mount();
    fireEvent.click(container.querySelector('[data-section="ov-trends"] li:nth-child(1) button'));
    expect(within(ui.getByTestId("bar")).getByRole("heading").textContent).toBe("Strength");
    expect(await ui.findByRole("heading", { name: "Estimated one-rep max" })).toBeTruthy();
    expect(ui.getByRole("button", { name: /^Lift\s+Bench Press$/ })).toBeTruthy();
    expect(ui.getByRole("img", { name: /^Line chart of Bench Press estimated one-rep max over 7 sessions, from \d+ to \d+ pounds\.$/ })).toBeTruthy();
    fireEvent.click(ui.getAllByRole("button", { name: "Show as table" })[0]);
    expect(ui.getByRole("table", { name: "Bench Press: estimated one-rep max by session" })).toBeTruthy();
    expect(await ui.findByRole("heading", { name: "Sets this week" })).toBeTruthy();
  });

  it("adds a weigh-in for today from Body", async () => {
    const { ui, container, updateEntryAtDate, showToast } = mount();
    fireEvent.click(container.querySelector('[data-section="ov-trends"] li:nth-child(3) button'));
    expect(await ui.findByRole("heading", { name: "Bodyweight" })).toBeTruthy();
    expect(ui.getByRole("img", { name: /^Line chart of bodyweight trend over 14 weigh-ins/ })).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Add a weigh-in" }));
    fireEvent.change(ui.getByLabelText("Today’s weight (lb)"), { target: { value: "181.4" } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    expect(updateEntryAtDate).toHaveBeenCalledWith(getTodayKey(), "body.weight", "181.4");
    expect(showToast).toHaveBeenCalledWith("Weigh-in saved");
    // Protein for the last seven days, in words as well as bars.
    expect(ui.getByText(/^175\sg a day on average against a 200\sg goal\. Goal met on 1 of 7 logged days\. Filled bars met the goal\.$/)).toBeTruthy();
  });

  it("counts weekly miles and pace on Running", async () => {
    const { ui, container } = mount();
    fireEvent.click(container.querySelector('[data-section="ov-trends"] li:nth-child(2) button'));
    expect(await ui.findByRole("heading", { name: "Weekly miles" })).toBeTruthy();
    expect(ui.getByRole("heading", { name: "Pace" })).toBeTruthy();
    expect(ui.getAllByText("9:00").length).toBe(3); // best, average, latest
    expect(ui.getByRole("heading", { name: "Recent runs" })).toBeTruthy();
  });
});

describe("History", () => {
  it("opens a day from the calendar and hands editing to Today", () => {
    const { ui, container, onOpenDay } = mount();
    fireEvent.click(container.querySelector('[data-section="ov-trends"] li:nth-child(5) button'));
    expect(within(ui.getByTestId("bar")).getByRole("heading").textContent).toBe("History");
    const today = container.querySelector('.dayc[aria-current="date"]');
    expect(today.getAttribute("aria-label")).toMatch(/: lifting$/);
    expect(today.getAttribute("aria-pressed")).toBe("true");
    // The picked day shows as one line first.
    const row = ui.getByRole("button", { name: /Lifting, 3 sets · 2800\skcal, 205\sg protein · 182\slb/ });
    fireEvent.click(row);
    expect(ui.getByRole("button", { name: "Back to History" })).toBeTruthy();
    expect(ui.getByText("Bench Press")).toBeTruthy();
    expect(ui.getByText(/225\slb\s×\s5 · RIR\s2/)).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Edit this day" }));
    expect(onOpenDay).toHaveBeenCalledWith(getTodayKey());
    fireEvent.click(ui.getByRole("button", { name: "Back to History" }));
    expect(container.querySelector(".cal")).toBeTruthy();
  });

  it("searches dates, lifts and notes", () => {
    const { ui, container } = mount();
    fireEvent.click(container.querySelector('[data-section="ov-trends"] li:nth-child(5) button'));
    fireEvent.change(ui.getByLabelText("Search your log"), { target: { value: "knee" } });
    expect(ui.getByRole("status").textContent).toBe("1 day matches “knee”.");
    fireEvent.change(ui.getByLabelText("Search your log"), { target: { value: "bench" } });
    expect(ui.getByRole("status").textContent).toBe("7 days match “bench”.");
    fireEvent.change(ui.getByLabelText("Search your log"), { target: { value: "zzz" } });
    expect(ui.getByRole("status").textContent).toBe("0 days match “zzz”.");
    expect(container.querySelector(".cal")).toBeNull();
  });

  it("filters the timeline by kind of event", () => {
    const { ui, container } = mount();
    fireEvent.click(container.querySelector('[data-section="ov-trends"] li:nth-child(5) button'));
    fireEvent.click(ui.getByRole("radio", { name: "Timeline" }));
    expect(ui.getAllByText("Check-in").length).toBeGreaterThan(0);
    fireEvent.click(ui.getByRole("button", { name: "Notes" }));
    expect(ui.getByRole("button", { name: "Notes" }).getAttribute("aria-pressed")).toBe("true");
    expect(ui.queryByText("Check-in")).toBeNull();
    expect(ui.getByText("Left knee felt stiff on the warm-up")).toBeTruthy();
  });

  it("summarises a day in one line, and says so when there is nothing", () => {
    expect(daySummary(undefined)).toBe("Nothing logged");
    expect(daySummary({ workout: { cardio: { miles: "4.6" } } })).toBe("Run, 4.6\u00a0mi");
  });
});
