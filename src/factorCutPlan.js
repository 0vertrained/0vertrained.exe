// Factor Cut · Rami's 12-day prepared-meal block.
// Kept as a pure data/model module so Fuel can render and test the plan without
// coupling inventory logic to the component tree.

export const FACTOR_PLAN_START = "2026-07-20";
export const FACTOR_PLAN_DAYS = 12;
export const FACTOR_TARGETS = { calories: 2400, protein: 200 };

export const FACTOR_SCAFFOLD = [
  { id: "scaffold-breakfast", slot: "breakfast", label: "Breakfast", name: "4 eggs + 1 cup egg whites + 60g oats + berries", calories: 675, protein: 57 },
  { id: "scaffold-post", slot: "postWorkout", label: "Post-workout", name: "2 scoops whey + banana", calories: 345, protein: 49 },
  { id: "scaffold-night", slot: "night", label: "Before bed", name: "1.5 cups nonfat Greek yogurt", calories: 200, protein: 35 },
];

export const FACTOR_MEALS = {
  truffle: { id: "factor-truffle", name: "Truffle Butter Chicken & Mushroom Risotto", calories: 540, protein: 39, qty: 4, verified: true, freeze: true },
  smoky: { id: "factor-smoky", name: "Smoky Chicken & Hatch Chile Black Beans", calories: 470, protein: 43, qty: 4, verified: false, freeze: true },
  thai: { id: "factor-thai", name: "Thai-Style Chicken Peanut Salad", calories: 460, protein: 49, qty: 2, verified: true, freeze: false },
  tahini: { id: "factor-tahini", name: "Chicken Lentil Tahini Salad", calories: 500, protein: 46, qty: 2, verified: true, freeze: false },
  caesar: { id: "factor-caesar", name: "Chicken Caesar Salad", calories: 420, protein: 44, qty: 2, verified: true, freeze: false },
  jalapeno: { id: "factor-jalapeno", name: "Jalapeño-Lime Cheddar Chicken", calories: 650, protein: 42, qty: 2, verified: true, freeze: true },
  green: { id: "factor-green", name: "Green Chile Chicken", calories: 480, protein: 42, qty: 2, verified: true, freeze: true },
  athenian: { id: "factor-athenian", name: "Athenian-Style Feta Chicken", calories: 460, protein: 42, qty: 2, verified: true, freeze: true },
  salsa: { id: "factor-salsa", name: "Salsa Macha Chicken", calories: 510, protein: 40, qty: 2, verified: false, freeze: true },
  mystery1: { id: "factor-mystery-1", name: "Unverified Factor meal #1", calories: null, protein: null, qty: 1, verified: false, freeze: true },
  mystery2: { id: "factor-mystery-2", name: "Unverified Factor meal #2", calories: null, protein: null, qty: 1, verified: false, freeze: true },
};

const D = (lunch, dinner, training, flex) => ({ lunch, dinner, training, flex });
export const FACTOR_SCHEDULE = [
  D("thai", "truffle", "Threshold run · Upper strength", [150, 180]),
  D("caesar", "jalapeno", "Easy aerobic · Lower strength", [100, 150]),
  D("tahini", "smoky", "Incline walk · Delts, arms, abs", [150, 200]),
  D("thai", "salsa", "Easy run · Lower hypertrophy", [180, 220]),
  D("caesar", "jalapeno", "Zone 2 · Upper hypertrophy", [100, 150]),
  D("tahini", "truffle", "Long run · Optional pump", [140, 180]),
  D("green", "smoky", "Recovery day", [0, 0]),
  D("athenian", "truffle", "Threshold run · Upper strength", [150, 180]),
  D("green", "smoky", "Easy aerobic · Lower strength", [180, 230]),
  D("athenian", "salsa", "Incline walk · Delts, arms, abs", [180, 220]),
  D("truffle", "smoky", "Easy run · Lower hypertrophy", [150, 170]),
  D("mystery1", "mystery2", "Zone 2 · Upper hypertrophy", [0, 230]),
];

function utcDay(value) {
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 86400000);
}

export function getFactorDayIndex(todayKey, start = FACTOR_PLAN_START) {
  const a = utcDay(todayKey);
  const b = utcDay(start);
  if (a == null || b == null) return -1;
  const index = a - b;
  return index >= 0 && index < FACTOR_PLAN_DAYS ? index : -1;
}

export function factorDayPlan(index) {
  const row = FACTOR_SCHEDULE[index];
  if (!row) return null;
  const lunch = FACTOR_MEALS[row.lunch];
  const dinner = FACTOR_MEALS[row.dinner];
  const known = [lunch, dinner].every(m => Number.isFinite(m.calories) && Number.isFinite(m.protein));
  const factorCalories = known ? lunch.calories + dinner.calories : null;
  const factorProtein = known ? lunch.protein + dinner.protein : null;
  const scaffoldCalories = FACTOR_SCAFFOLD.reduce((s, m) => s + m.calories, 0);
  const scaffoldProtein = FACTOR_SCAFFOLD.reduce((s, m) => s + m.protein, 0);
  return {
    day: index + 1,
    ...row,
    lunch,
    dinner,
    known,
    scaffoldCalories,
    scaffoldProtein,
    preFlexCalories: known ? scaffoldCalories + factorCalories : null,
    preFlexProtein: known ? scaffoldProtein + factorProtein : null,
  };
}

export function factorInventoryThroughDay(completedDayCount = 0) {
  const used = {};
  FACTOR_SCHEDULE.slice(0, Math.max(0, completedDayCount)).forEach(({ lunch, dinner }) => {
    used[lunch] = (used[lunch] || 0) + 1;
    used[dinner] = (used[dinner] || 0) + 1;
  });
  return Object.entries(FACTOR_MEALS).map(([key, meal]) => ({
    key,
    ...meal,
    remaining: Math.max(0, meal.qty - (used[key] || 0)),
  }));
}

export function factorFlexSuggestion(plan) {
  if (!plan) return "";
  if (plan.flex[1] === 0) return "Recovery day: skip the flex block unless hunger or recovery calls for it.";
  if (/Threshold|Long run/i.test(plan.training)) return "Prioritize fast carbs around the run: banana, rice, bagel, honey, or sports drink.";
  if (/Lower/i.test(plan.training)) return "Use the flex block around lower training: rice, potatoes, cereal, or fruit.";
  return "Use the flex block around training: fruit, rice, rice cakes, or honey in yogurt.";
}
