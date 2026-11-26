// src/__tests__/foodLog.test.js
// Each food logged stays on the day as an item, and the day's totals move by
// exactly that item's share when it is added, changed or taken off.
import { describe, expect, it } from "vitest";
import {
  addFoodToDay, clampServings, dayFoods, foodsTotal, isSavedFood, makeFoodItem, mealFromFoods,
  recentFoods, removeFoodFromDay, savedFoods, servingsLabel, setFoodServings, toggleSavedFood, untrackedTotals,
} from "../foodLog";

const yogurt = { name: "Greek yogurt", serving: "170g", calories: 100, protein: 17, carbs: 6, fats: 0 };
const whey = { name: "Whey", serving: "1 scoop", calories: 120, protein: 24, carbs: 3, fats: 1.5 };
const at = (time) => `2026-11-26T${time}:00.000Z`;

describe("makeFoodItem", () => {
  it("keeps one serving's macros, the servings and where it came from", () => {
    const item = makeFoodItem(yogurt, { qty: 1.5, at: at("08:00"), source: "usda", id: "a" });
    expect(item).toEqual({ id: "a", name: "Greek yogurt", serving: "170g", qty: 1.5, calories: 100, protein: 17, carbs: 6, fats: 0, at: at("08:00"), source: "usda" });
  });

  it("is nothing without a name or anything to count", () => {
    expect(makeFoodItem({ name: "", calories: 100 })).toBeNull();
    expect(makeFoodItem({ name: "Water", calories: 0 })).toBeNull();
  });

  it("keeps servings in half steps between a half and ten", () => {
    expect([clampServings(0), clampServings(0.3), clampServings(1.26), clampServings(40)]).toEqual([1, 0.5, 1.5, 10]);
  });
});

describe("the day's totals", () => {
  const start = { calories: "500", protein: "40", carbs: "", fats: "10", water: "32" };

  it("go up by an added food times its servings", () => {
    const next = addFoodToDay(start, makeFoodItem(yogurt, { qty: 2, id: "a", at: at("08:00") }));
    expect(next).toMatchObject({ calories: "700", protein: "74", carbs: "12", fats: "10", water: "32" });
    expect(dayFoods(next).map((item) => item.id)).toEqual(["a"]);
  });

  it("move by the difference when servings change, and come back down when it's removed", () => {
    const day = addFoodToDay(start, makeFoodItem(whey, { id: "w", at: at("09:00") }));
    const doubled = setFoodServings(day, "w", 2);
    expect(doubled).toMatchObject({ calories: "740", protein: "88" });
    expect(dayFoods(doubled)[0].qty).toBe(2);
    const removed = removeFoodFromDay(doubled, "w");
    expect(removed).toMatchObject({ calories: "500", protein: "40", meals: [] });
  });

  it("never go below zero, and leave a day without that food alone", () => {
    const day = addFoodToDay({}, makeFoodItem(whey, { id: "w" }));
    const handEdited = { ...day, calories: "50" };
    expect(removeFoodFromDay(handEdited, "w").calories).toBe("0");
    expect(removeFoodFromDay(day, "missing")).toBe(day);
  });

  it("mark a meal-plan meal as eaten, and not eaten once it's removed", () => {
    const item = makeFoodItem({ name: "Protein waffles", calories: 758, protein: 58 }, { id: "p", source: "plan", slot: "breakfast", planId: "r12" });
    const day = addFoodToDay({}, item);
    expect(day.plannedMeals).toEqual({ breakfast: "r12" });
    expect(removeFoodFromDay(day, "p").plannedMeals).toEqual({ breakfast: null });
  });

  it("can hold more than the foods add up to, typed in by hand", () => {
    const day = addFoodToDay({ calories: "300", protein: "20" }, makeFoodItem(whey, { id: "w" }));
    expect(foodsTotal(dayFoods(day))).toEqual({ calories: 120, protein: 24, carbs: 3, fats: 2 });
    expect(untrackedTotals(day)).toEqual({ calories: 300, protein: 20 });
    expect(untrackedTotals(addFoodToDay({}, makeFoodItem(whey, { id: "w" })))).toBeNull();
  });
});

describe("recent foods", () => {
  const entries = {
    "2026-11-26": { nutrition: { meals: [makeFoodItem(whey, { id: "1", at: at("09:00") })] } },
    "2026-11-25": { nutrition: { meals: [
      makeFoodItem(yogurt, { id: "2", at: at("08:00"), qty: 2 }),
      makeFoodItem(whey, { id: "3", at: at("10:00") }),
      makeFoodItem({ name: "Plan meal", calories: 500, protein: 40 }, { id: "4", source: "plan", slot: "lunch" }),
    ] } },
  };

  it("lists each food once, newest first, with the servings last eaten", () => {
    const recent = recentFoods(entries, { todayKey: "2026-11-26" });
    expect(recent.map((food) => food.name)).toEqual(["Whey", "Greek yogurt"]);
    expect(recent[1].qty).toBe(2);
    expect(recent[0]).not.toHaveProperty("id");
  });

  it("leaves out saved foods and meal-plan meals", () => {
    expect(recentFoods(entries, { todayKey: "2026-11-26", exclude: [whey] }).map((food) => food.name)).toEqual(["Greek yogurt"]);
  });
});

describe("saved foods and meals", () => {
  it("saves a food at the top, and unsaves it the second time", () => {
    const saved = toggleSavedFood([], { ...whey, id: "x", at: "y", qty: 2 });
    expect(saved).toEqual([{ name: "Whey", serving: "1 scoop", calories: 120, protein: 24, carbs: 3, fats: 1.5, qty: 2 }]);
    expect(isSavedFood(saved, whey)).toBe(true);
    expect(toggleSavedFood(saved, whey)).toEqual([]);
  });

  it("makes several foods one meal, as eaten", () => {
    const items = [makeFoodItem(yogurt, { qty: 2 }), makeFoodItem(whey)];
    expect(mealFromFoods(items, "Breakfast")).toEqual({
      name: "Breakfast", serving: null, calories: 320, protein: 58, carbs: 15, fats: 1.5, qty: 1,
      parts: ["Greek yogurt × 2", "Whey"],
    });
    expect(mealFromFoods(items, " ")).toBeNull();
  });

  it("reads only usable saved foods from settings", () => {
    expect(savedFoods({ savedFoods: [whey, { name: "Empty", calories: 0 }, null] })).toEqual([whey]);
    expect(savedFoods({})).toEqual([]);
  });

  it("says servings only when it isn't one", () => {
    expect(servingsLabel(1)).toBe("");
    expect(servingsLabel(1.5)).toBe("1.5\u00a0servings");
  });
});
