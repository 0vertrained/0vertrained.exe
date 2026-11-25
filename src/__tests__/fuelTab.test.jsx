// Fuel, mounted: what is still needed leads, a log is confirmed with an Undo
// that takes exactly that log back, and the meal plan logs through the same
// totals.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ShellProvider } from "../ui/shell";
import { FuelTab } from "../FuelTab";

const GOALS = { calories: 3400, protein: 200, carbs: 380, fats: 95, water: 128 };

function setPath(object, keys, value) {
  if (!keys.length) return value;
  const [head, ...rest] = keys;
  return { ...(object || {}), [head]: setPath(object?.[head], rest, value) };
}

function mountFuel(nutrition = { calories: "1000", protein: "60", carbs: "100", fats: "30", water: "32" }) {
  const showToast = vi.fn();
  let latest = null;
  function Harness() {
    const [day, setDay] = useState({ nutrition });
    latest = day;
    const updateToday = (path, value) => setDay((prev) => setPath(prev, path.split("."), value));
    return (
      <ThemeProvider>
        <ShellProvider>
          <FuelTab settings={{ goals: GOALS }} todayData={day} updateToday={updateToday} showToast={showToast} todayKey="2026-11-27" loaded data={{}} />
        </ShellProvider>
      </ThemeProvider>
    );
  }
  const view = render(<Harness />);
  return { ui: within(view.container), showToast, day: () => latest };
}

describe("Fuel", () => {
  it("leads with what is still needed, in numbers and in words", () => {
    const { ui } = mountFuel();
    expect(ui.getByText("Still needed today")).toBeTruthy();
    expect(ui.getByRole("img", { name: "Protein: 60 of 200 g" })).toBeTruthy();
    expect(ui.getByText(/^140\sg to go$/)).toBeTruthy();
    expect(ui.getByText(/^2,400\skcal to go$/)).toBeTruthy();
    expect(ui.getByRole("button", { name: "Log food" })).toBeTruthy();
  });

  it("logs the suggested add in one tap, confirms it, and Undo takes exactly that back", () => {
    const { ui, showToast, day } = mountFuel();
    const before = { ...day().nutrition };
    const card = ui.getByText("Next fuel action · closes the gap best").closest("section");
    fireEvent.click(within(card).getByRole("button", { name: /^Log / }));
    const after = day().nutrition;
    expect(Number(after.calories)).toBeGreaterThan(Number(before.calories));
    expect(Number(after.protein)).toBeGreaterThan(Number(before.protein));
    const [message, options] = showToast.mock.calls.at(-1);
    expect(message).toMatch(/ added to today$/);
    expect(options.action).toBe("Undo");
    // Something else is logged before Undo is tapped: only the first log comes off.
    fireEvent.click(ui.getByRole("button", { name: "Add 16 ounces of water" }));
    act(() => options.onAction());
    const undone = day().nutrition;
    expect(undone.calories).toBe(before.calories);
    expect(undone.protein).toBe(before.protein);
    expect(undone.water).toBe(String(Number(before.water) + 16));
  });

  it("the meal plan logs a meal onto today's totals and unlogs it again", () => {
    const { ui, showToast, day } = mountFuel();
    fireEvent.click(ui.getByRole("button", { name: /^Meal plan/ }));
    expect(ui.getByText("Today’s meals")).toBeTruthy();
    const checks = ui.getAllByRole("button", { name: /, logged$/ });
    expect(checks.length).toBe(5);
    expect(checks[0].getAttribute("aria-pressed")).toBe("false");
    const before = Number(day().nutrition.calories);
    fireEvent.click(checks[0]);
    expect(Number(day().nutrition.calories)).toBeGreaterThan(before);
    expect(Object.values(day().nutrition.plannedMeals).filter(Boolean)).toHaveLength(1);
    expect(ui.getAllByRole("button", { name: /, logged$/ })[0].getAttribute("aria-pressed")).toBe("true");
    expect(showToast.mock.calls.at(-1)[1].action).toBe("Undo");
    fireEvent.click(ui.getAllByRole("button", { name: /, logged$/ })[0]);
    expect(Number(day().nutrition.calories)).toBe(before);
    expect(Object.values(day().nutrition.plannedMeals).filter(Boolean)).toHaveLength(0);
  });

  it("totals can be corrected by hand from Log food", () => {
    const { ui, day } = mountFuel();
    fireEvent.click(ui.getByRole("button", { name: "Log food" }));
    expect(ui.getByRole("searchbox", { name: "Search foods" })).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: /^Add by hand/ }));
    fireEvent.change(ui.getByRole("spinbutton", { name: "Protein (g)" }), { target: { value: "75" } });
    expect(day().nutrition.protein).toBe("75");
  });
});
