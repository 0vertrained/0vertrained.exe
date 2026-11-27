// src/__tests__/fuelFoodLog.test.jsx
// Fuel keeps every food logged: it shows under Today's food, its servings
// can change and it can come off, with the totals moving by its share. Saved
// and recent foods log in one tap.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ShellProvider } from "../ui/shell";
import { FuelTab } from "../FuelTab";

const GOALS = { calories: 3400, protein: 200, carbs: 380, fats: 95, water: 128 };
const TODAY = "2026-11-27";

function setPath(object, keys, value) {
  if (!keys.length) return value;
  const [head, ...rest] = keys;
  return { ...(object || {}), [head]: setPath(object?.[head], rest, value) };
}

function mountFuel({ nutrition = { calories: "0", protein: "0", carbs: "0", fats: "0", water: "0" }, data = {}, savedFoods = [] } = {}) {
  const showToast = vi.fn();
  let latest = null;
  let latestSettings = null;
  function Harness() {
    const [day, setDay] = useState({ nutrition });
    const [pastDays, setPastDays] = useState(data);
    const [settings, setSettings] = useState({ goals: GOALS, savedFoods });
    latest = day;
    latestSettings = settings;
    const updateToday = (path, value) => setDay((prev) => setPath(prev, path.split("."), value));
    const updateEntryAtDate = (date, path, value) => setPastDays((prev) => ({
      ...prev, [date]: setPath(prev[date], path.split("."), value),
    }));
    const onPatchSettings = async (patch) => { setSettings((prev) => ({ ...prev, ...patch })); return { ok: true }; };
    return (
      <ThemeProvider>
        <ShellProvider>
          <FuelTab settings={settings} todayData={day} updateToday={updateToday} updateEntryAtDate={updateEntryAtDate} showToast={showToast} todayKey={TODAY} loaded data={{ ...pastDays, [TODAY]: day }} onPatchSettings={onPatchSettings} />
        </ShellProvider>
      </ThemeProvider>
    );
  }
  const view = render(<Harness />);
  return { ui: within(view.container), showToast, day: () => latest, settings: () => latestSettings };
}

const foodsSection = (ui) => ui.getByRole("heading", { name: "Today’s food" }).closest("section");
const startsWith = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

describe("Fuel's food log", () => {
  it("confirms, reopens and corrects the selected day's full food log independently", () => {
    const date = "2026-11-25";
    const { ui, day } = mountFuel({ nutrition: { calories: "2250" }, data: { [date]: { nutrition: { calories: "2500" } } } });
    fireEvent.click(ui.getByRole("button", { name: "Log food" }));
    fireEvent.click(ui.getByRole("button", { name: "Mark food log complete" }));
    expect(day().nutrition.foodLogConfirmation).toMatchObject({ calories: 2250 });
    const picker = ui.getByLabelText("Date to confirm");
    fireEvent.change(picker, { target: { value: date } });
    fireEvent.click(ui.getByRole("button", { name: "Mark food log complete" }));
    expect(ui.getByText(/Confirmed full day · 2,500 kcal/)).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Reopen food log" }));
    expect(ui.getByRole("button", { name: "Mark food log complete" })).toBeTruthy();
    fireEvent.change(picker, { target: { value: TODAY } });
    expect(ui.getByText(/Confirmed full day · 2,250 kcal/)).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: /^Add by hand/ }));
    fireEvent.change(ui.getByRole("spinbutton", { name: "Calories (kcal)" }), { target: { value: "2300" } });
    expect(ui.getByRole("button", { name: "Mark food log complete" })).toBeTruthy();
  });
  it("keeps a logged food under Today's food, and Undo takes it off again", () => {
    const { ui, showToast, day } = mountFuel();
    expect(within(foodsSection(ui)).getByText(/Nothing logged yet/)).toBeTruthy();
    const card = ui.getByText("Next fuel action · closes the gap best").closest("section");
    fireEvent.click(within(card).getByRole("button", { name: /^Log / }));
    const item = day().nutrition.meals[0];
    expect(item).toMatchObject({ source: "quick", qty: 1 });
    expect(Number(day().nutrition.calories)).toBe(item.calories);
    expect(within(foodsSection(ui)).getByText(item.name)).toBeTruthy();
    const [, options] = showToast.mock.calls.at(-1);
    act(() => options.onAction());
    expect(day().nutrition.meals).toEqual([]);
    expect(day().nutrition.calories).toBe("0");
  });

  it("changes a food's servings and removes it from its sheet, the totals moving with it", () => {
    const { ui, day } = mountFuel();
    const card = ui.getByText("Next fuel action · closes the gap best").closest("section");
    fireEvent.click(within(card).getByRole("button", { name: /^Log / }));
    const item = day().nutrition.meals[0];
    fireEvent.click(within(foodsSection(ui)).getByRole("button", { name: startsWith(item.name) }));
    const sheet = ui.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "More servings" }));
    expect(day().nutrition.meals[0].qty).toBe(1.5);
    expect(Number(day().nutrition.calories)).toBe(Math.round(item.calories * 1.5));
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove from today" }));
    expect(day().nutrition.meals).toEqual([]);
    expect(day().nutrition.calories).toBe("0");
    expect(ui.queryByRole("dialog")).toBeNull();
  });

  it("saves foods and a meal to your foods, and logs a saved one in a tap", () => {
    const { ui, day, settings } = mountFuel();
    const card = ui.getByText("Next fuel action · closes the gap best").closest("section");
    fireEvent.click(within(card).getByRole("button", { name: /^Log / }));
    fireEvent.click(within(card).getAllByRole("button", { name: /^Add / })[0]);
    const [first] = day().nutrition.meals;
    fireEvent.click(within(foodsSection(ui)).getByRole("button", { name: startsWith(first.name) }));
    fireEvent.click(within(ui.getByRole("dialog")).getByRole("button", { name: "Save to your foods" }));
    expect(settings().savedFoods.map((food) => food.name)).toEqual([first.name]);
    fireEvent.click(within(ui.getByRole("dialog")).getByRole("button", { name: "Close" }));

    fireEvent.click(within(foodsSection(ui)).getByRole("button", { name: "Save foods as a meal" }));
    const sheet = ui.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Meal name"), { target: { value: "Snack" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save meal" }));
    expect(settings().savedFoods[0]).toMatchObject({ name: "Snack", parts: day().nutrition.meals.map((meal) => meal.name) });

    fireEvent.click(ui.getByRole("button", { name: "Log food" }));
    const savedList = ui.getByRole("heading", { name: "Saved" }).closest("section");
    fireEvent.click(within(savedList).getByRole("button", { name: "Add Snack" }));
    expect(day().nutrition.meals.at(-1)).toMatchObject({ name: "Snack", source: "saved" });
  });

  it("offers foods from earlier days as recent", () => {
    const data = { "2026-11-26": { nutrition: { meals: [{ id: "y", name: "Overnight oats", serving: "1 jar", qty: 2, calories: 300, protein: 20, carbs: 45, fats: 6, at: "2026-11-26T14:00:00.000Z", source: "usda" }] } } };
    const { ui, day } = mountFuel({ data });
    fireEvent.click(ui.getByRole("button", { name: "Log food" }));
    const recent = ui.getByRole("heading", { name: "Recent" }).closest("section");
    expect(within(recent).getByText(/2\sservings · 600\skcal · 40\sg protein/)).toBeTruthy();
    fireEvent.click(within(recent).getByRole("button", { name: "Add Overnight oats" }));
    expect(day().nutrition.meals[0]).toMatchObject({ name: "Overnight oats", qty: 2, source: "usda" });
    expect(day().nutrition.calories).toBe("600");
  });

  it("logs a planned meal as a food, marked eaten, and takes both off together", () => {
    const { ui, day } = mountFuel();
    const next = ui.getByText(/^Next planned meal/).closest(".row");
    fireEvent.click(within(next).getByRole("button", { name: /^Log / }));
    const [meal] = day().nutrition.meals;
    expect(meal).toMatchObject({ source: "plan" });
    expect(day().nutrition.plannedMeals[meal.slot]).toBe(meal.planId);
    fireEvent.click(within(foodsSection(ui)).getByRole("button", { name: startsWith(meal.name) }));
    fireEvent.click(within(ui.getByRole("dialog")).getByRole("button", { name: "Remove from today" }));
    expect(day().nutrition.plannedMeals[meal.slot]).toBeNull();
    expect(day().nutrition.calories).toBe("0");
  });
});
