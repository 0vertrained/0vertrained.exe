// src/FuelTab.jsx
// Fuel answers one question first: what is still needed today. Under it sit
// the one best next thing to eat or drink, water, and the doors to the rest:
// Log food (search, quick adds, totals by hand), the meal plan with its
// recipes, and targets.
//
// Every food logged is kept on the day (nutrition.meals, see ./foodLog) and
// moves the day's totals by its share, so it can be changed or removed
// later; a planned meal also marks nutrition.plannedMeals.<slot>. Water and
// totals typed by hand write the totals directly. A log is confirmed at once
// and can be undone from the confirmation.
import { useEffect, useRef, useState } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { Icon, Seg } from "./ui/ledger";
import { useTopBar } from "./ui/shell";
import { generateMealPlans, SLOTS, planMacros, SLOT_LABELS, swapCandidates, replaceMealInPlan } from "./mealPlan";
import { buildNutritionRecommendation } from "./nutritionCoach";
import { computeStillNeeded } from "./fuelNeeds";
import { buildFuelHero, buildFuelRecoveryInsight, buildMealPlanProgress, buildNextMealPreview } from "./fuelSummary";
import { FoodSearch, fetchUsdaBarcode } from "./FoodSearch";
import { LoadingShell } from "./ui/primitives";
import { getSkeletonPlan } from "./uiStability";
import { EnergyIntelligence } from "./EnergyIntelligence";
import { addFoodToDay, dayFoods, makeFoodItem, recentFoods, removeFoodFromDay, savedFoods, setFoodServings, toggleSavedFood } from "./foodLog";
import { FoodEditSheet, SaveMealSheet, ScannedFoodSheet, TodayFoods, YourFoods } from "./FoodLog";
import { barcodeScanner, scanFood } from "./barcode";

const NBSP = " ";
const num = (value) => Number.parseFloat(value) || 0;
const fmt = (value) => Math.round(num(value)).toLocaleString("en-US");
const pct = (value, goal) => Math.min(100, goal > 0 ? Math.round((num(value) / goal) * 100) : 0);
const MACROS = ["calories", "protein", "carbs", "fats", "water"];
const SWAP_WINDOW = 6;

// What an add is made of, in the order people read it.
function addMeta(add) {
  return [
    add.calories ? `${fmt(add.calories)}${NBSP}kcal` : null,
    add.protein ? `${fmt(add.protein)}${NBSP}g protein` : null,
    add.water ? `${fmt(add.water)}${NBSP}oz water` : null,
  ].filter(Boolean).join(" · ");
}

// One target as a line: the name, where it stands, a bar, and what is left.
function Target({ label, now, goal, unit, compact = false }) {
  const left = Math.max(0, Math.round(goal - num(now)));
  const figure = <span><span className="n">{fmt(now)}/{fmt(goal)}</span> <span className="t-s c2">{unit}</span></span>;
  const bar = <span className="bar" role="img" aria-label={`${label}: ${fmt(now)} of ${fmt(goal)} ${unit}`}><i style={{ width: `${pct(now, goal)}%` }} /></span>;
  if (compact) return <span className="kv"><span className="t-c c2">{label}</span>{figure}{bar}</span>;
  return (
    <div className="kv" style={{ gap: 4 }}>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}><span className="t-bs">{label}</span>{figure}</span>
      {bar}
      <span className="t-s c2">{left > 0 ? `${fmt(left)}${NBSP}${unit} to go` : "Target met"}</span>
    </div>
  );
}

export function FuelTab({ settings, todayData, updateToday, showToast, todayKey, loaded, data, onPatchSettings = null }) {
  // today: what is needed · log: search and add · plan: meals and recipes ·
  // targets: what you burn and the calorie target that follows from it.
  const [fuelView, setFuelView] = useState("today");
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const goals        = settings?.goals || { calories: 3600, protein: 200, carbs: 400, fats: 100, water: 128 };
  const restrictions = settings?.dietaryRestrictions || [];
  const nut = todayData?.nutrition || {};
  // The totals as they stand now, for actions that run later (Undo).
  const nutRef = useRef(nut);
  useEffect(() => { nutRef.current = nut; });

  const nutritionRecommendation = buildNutritionRecommendation({ nutrition: nut, goals, todayProgram: null, recommendation: null });
  const stillNeeded = computeStillNeeded(nut, goals);

  const [seed, setSeed]         = useState(0);
  const [plans, setPlans]       = useState(() => generateMealPlans(goals, restrictions, 3, 0));
  const [planIdx, setPlanIdx]   = useState(0);
  const [expandedMeal, setExpandedMeal] = useState(null);
  // Which slot's swap chooser is open, and how far "More options" has paged.
  const [swapSlot, setSwapSlot]     = useState(null);
  const [swapOffset, setSwapOffset] = useState(0);
  const [handOpen, setHandOpen]     = useState(false);
  // The logged food whose sheet is open, and whether the save-a-meal sheet is.
  const [editingId, setEditingId]   = useState(null);
  const [saveMealOpen, setSaveMealOpen] = useState(false);
  // Barcode scanning, in app builds that have it: whether this phone can,
  // the food a scan found, and what to say when it found nothing.
  const [canScan, setCanScan] = useState(false);
  const [scanned, setScanned] = useState(null);
  const [scanNote, setScanNote] = useState("");
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(barcodeScanner()?.status?.())
      .then((status) => { if (!cancelled) setCanScan(Boolean(status?.supported)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A screen opened from Fuel starts at its top, not wherever Fuel was scrolled.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    (document.scrollingElement || document.documentElement).scrollTop = 0;
  }, [fuelView]);

  const subView = fuelView !== "today" && !(isBroadsheet && fuelView === "log");
  useTopBar(subView ? {
    title: fuelView === "log" ? "Log food" : fuelView === "plan" ? "Meal plan" : "Targets",
    back: "Fuel",
    onBack: () => setFuelView("today"),
  } : null);

  // Keep hooks above this guard so loading → loaded never changes hook order.
  if (!loaded) return <LoadingShell plan={getSkeletonPlan("Fuel")} />;

  // Add to (or take from) the day's totals. Amounts never go below zero.
  const applyNutrition = (delta, sign = 1) => {
    const current = nutRef.current || {};
    const next = { ...current };
    for (const key of MACROS) {
      if (!delta[key]) continue;
      next[key] = String(Math.max(0, Math.round(num(current[key]) + sign * delta[key])));
    }
    nutRef.current = next;
    updateToday("nutrition", next);
  };
  const logged = (name, undo) => showToast?.(`${name} added to today`, { action: "Undo", onAction: undo });

  // One write of the day's nutrition, seen at once by the next tap's write.
  const writeNutrition = (next) => {
    nutRef.current = next;
    updateToday("nutrition", next);
  };
  // Keep a food on the day; Undo takes that same item off again.
  const logItem = (item) => {
    if (!item) return;
    writeNutrition(addFoodToDay(nutRef.current || {}, item));
    logged(item.name, () => writeNutrition(removeFoodFromDay(nutRef.current || {}, item.id)));
  };

  const addQuick = (add) => {
    updateToday("intelligence.lastNutritionQuickAdd", { id: add.id, label: add.label, addedAt: new Date().toISOString() });
    const item = makeFoodItem({ name: add.label, calories: add.calories, protein: add.protein, carbs: add.carbs, fats: add.fats }, { source: "quick" });
    // Water alone isn't a food: it goes straight on the totals.
    if (!item) {
      applyNutrition(add);
      logged(add.label, () => applyNutrition(add, -1));
      return;
    }
    let next = addFoodToDay(nutRef.current || {}, item);
    if (add.water) next = { ...next, water: String(Math.max(0, Math.round(num(next.water) + add.water))) };
    writeNutrition(next);
    logged(add.label, () => {
      let undone = removeFoodFromDay(nutRef.current || {}, item.id);
      if (add.water) undone = { ...undone, water: String(Math.max(0, Math.round(num(undone.water) - add.water))) };
      writeNutrition(undone);
    });
  };
  const logFood = (food) => logItem(makeFoodItem(food, { source: food.source || "search" }));
  const scan = async () => {
    setScanNote("");
    const result = await scanFood({ usdaLookup: fetchUsdaBarcode });
    if (result.food) setScanned(result.food);
    else if (result.error === "camera") setScanNote("Allow 0VERTRAINED to use the camera in the iPhone’s Settings app, then scan again.");
    else if (result.notFound) setScanNote(result.offline ? "Couldn’t look that barcode up without a connection. Search for the food by name instead." : "That barcode isn’t in Open Food Facts or the USDA database yet. Search for the food by name instead.");
    else if (result.error) setScanNote("Couldn’t open the scanner. Search for the food by name instead.");
  };

  // Saved foods and meals live in settings; recent ones come from the log.
  const saved = savedFoods(settings);
  const recent = recentFoods(data, { todayKey, exclude: saved });
  const toggleSave = (food) => {
    if (!onPatchSettings) return;
    const next = toggleSavedFood(settings?.savedFoods, food);
    const nowSaved = next.length > (Array.isArray(settings?.savedFoods) ? settings.savedFoods.length : 0);
    void onPatchSettings({ savedFoods: next });
    showToast?.(nowSaved ? `${food.name} saved to your foods` : `${food.name} removed from your foods`);
  };
  const saveMeal = (meal) => {
    if (!onPatchSettings) return;
    void onPatchSettings({ savedFoods: toggleSavedFood((settings?.savedFoods || []).filter((food) => food?.name !== meal.name), meal) });
    showToast?.(`${meal.name} saved. It’s under Log food, Saved.`);
  };
  const editingItem = editingId ? dayFoods(nut).find((item) => item.id === editingId) || null : null;
  const changeServings = (id, qty) => writeNutrition(setFoodServings(nutRef.current || {}, id, qty));
  const removeItem = (id) => {
    const item = dayFoods(nutRef.current || {}).find((entry) => entry.id === id);
    setEditingId(null);
    if (!item) return;
    writeNutrition(removeFoodFromDay(nutRef.current || {}, id));
    showToast?.(`${item.name} removed from today`, { action: "Undo", onAction: () => writeNutrition(addFoodToDay(nutRef.current || {}, item)) });
  };
  const addWater = (oz) => updateToday("nutrition.water", String(num(nut.water) + oz));

  const plan         = plans[planIdx];
  const checkedMeals = todayData?.nutrition?.plannedMeals || {};

  // A planned meal eaten is kept on the day like any food, marked with its
  // slot; taking it off unmarks the slot. A meal logged before foods were
  // kept has no item, so its macros come straight off the totals.
  const uncheckMeal = (recipe, slot, quiet = false) => {
    const current = nutRef.current || {};
    const item = dayFoods(current).find((entry) => entry.source === "plan" && entry.slot === slot);
    if (item) writeNutrition(removeFoodFromDay(current, item.id));
    else {
      const next = { ...current, plannedMeals: { ...(current.plannedMeals || {}), [slot]: null } };
      for (const key of ["calories", "protein", "carbs", "fats"]) next[key] = String(Math.max(0, Math.round(num(current[key]) - recipe.macros[key])));
      writeNutrition(next);
    }
    if (!quiet) showToast?.(`${recipe.name} removed from today`);
  };
  const checkMeal = (recipe, slot) => {
    if (checkedMeals[slot]) return;
    const item = makeFoodItem({ name: recipe.name, ...recipe.macros }, { source: "plan", slot, planId: recipe.id });
    if (!item) return;
    writeNutrition(addFoodToDay(nutRef.current || {}, item));
    logged(recipe.name, () => uncheckMeal(recipe, slot, true));
  };

  const regenerate = () => {
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    setPlans(generateMealPlans(goals, restrictions, 3, nextSeed));
    setPlanIdx(0);
    setExpandedMeal(null);
    setSwapSlot(null);
    showToast?.("New plans generated");
  };

  // Replace one meal in the selected plan. If the meal being replaced was
  // already logged its macros come off first, and the new meal starts unlogged.
  const swapMeal = (slot, newRecipe) => {
    const current = plan?.meals?.[slot];
    if (!current || !newRecipe || current.id === newRecipe.id) { setSwapSlot(null); return; }
    if (checkedMeals[slot]) uncheckMeal(current, slot, true);
    setPlans((prev) => prev.map((p, i) => (i === planIdx ? replaceMealInPlan(p, slot, newRecipe, goals) : p)));
    setSwapSlot(null);
    if (expandedMeal === slot) setExpandedMeal(null);
    showToast?.(`Swapped to ${newRecipe.name}`);
  };

  const dayMacros = plan ? planMacros(plan) : { calories: 0, protein: 0, carbs: 0, fats: 0 };

  // Display models (pure helpers: no writes, no algorithm changes).
  const fuelHero = buildFuelHero({ nutrition: nut, goals, recommendation: nutritionRecommendation, stillNeeded });
  const fuelInsight = buildFuelRecoveryInsight({ nutrition: nut, goals, stillNeeded });
  const mealProgress = buildMealPlanProgress({ checkedMeals, slots: SLOTS });
  const nextMeal = buildNextMealPreview({ meals: plan?.meals, checkedMeals, slots: SLOTS, slotLabels: SLOT_LABELS });
  const nextRecipe = nextMeal.slot ? plan?.meals?.[nextMeal.slot] : null;
  const alternativeQuickAdds = fuelHero.suggestionAdd
    ? nutritionRecommendation.quickAdds.filter((add) => add.id !== fuelHero.suggestionAdd.id)
    : nutritionRecommendation.quickAdds;

  // Search, quick adds and totals by hand. A screen on a phone; docked on the
  // right at the desktop tier.
  const logPanel = (
    <>
      {canScan && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button type="button" className="btn btn-s btn-b" onClick={scan}>Scan a barcode</button>
          {scanNote && <p className="t-s c2" role="status">{scanNote}</p>}
        </div>
      )}
      <FoodSearch onAdd={logFood} />
      <YourFoods
        saved={saved}
        recent={recent}
        onAdd={(food) => logItem(makeFoodItem(food, { source: food.source || "saved" }))}
        onToggleSave={onPatchSettings ? toggleSave : null}
      />
      {nutritionRecommendation.quickAdds.length > 0 && (
        <section aria-labelledby="fuel-quick" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 id="fuel-quick" className="t-c c2">Quick add</h2>
          <ul className="rows">
            {nutritionRecommendation.quickAdds.map((add) => (
              <li key={add.id} className="row" style={{ minHeight: 56 }}>
                <span className="kv grow"><span className="t-bs clip">{add.label}</span><span className="n-s c2">{addMeta(add)}</span></span>
                <button type="button" className="btn btn-s btn-sm" aria-label={`Add ${add.label}`} onClick={() => addQuick(add)}><Icon name="plus" size="s" />Add</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button type="button" className="row" aria-expanded={handOpen} aria-controls="fuel-hand" onClick={() => setHandOpen((open) => !open)}>
          <span className="kv grow"><span className="t-bs">Add by hand</span><span className="t-s c2">Enter calories, macros or water directly</span></span>
          <Icon name={handOpen ? "up" : "down"} size="s" className="c2" />
        </button>
        {handOpen && (
          <div id="fuel-hand" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p className="t-s c2">These are today’s totals. Change a number to correct it.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
              {[["calories", "Calories (kcal)"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fats", "Fat (g)"], ["water", "Water (oz)"]].map(([key, label]) => (
                <label key={key} className="field">
                  <span className="lbl">{label}</span>
                  <input className="input n" type="number" inputMode="numeric" min="0" autoComplete="off" value={nut[key] || ""} onChange={(event) => updateToday(`nutrition.${key}`, event.target.value)} />
                </label>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );

  if (fuelView === "targets") {
    return <div className="shell" data-screen="fuel-targets"><div className="main"><EnergyIntelligence data={data} settings={settings} /></div></div>;
  }

  if (fuelView === "plan") {
    return (
      <div className="shell" data-screen="fuel-plan">
        <div className="main">
          {!plan ? (
            <p className="banner"><Icon name="info" size="s" /><span>No recipes match your dietary restrictions. Change them in Settings, under Dietary.</span></p>
          ) : (
            <>
              <div className="sec"><h2 className="t-h">Today’s meals</h2><span className="t-s c2">{mealProgress.logged} of {mealProgress.total} logged</span></div>
              {plans.length > 1 && (
                <Seg label="Plan" options={plans.map((_, index) => ({ value: index, label: `Plan ${index + 1}` }))} value={planIdx} onChange={(index) => { setPlanIdx(index); setExpandedMeal(null); setSwapSlot(null); }} />
              )}
              <section aria-labelledby="plan-totals" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <h3 id="plan-totals" className="t-ss">This plan against your targets</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
                  <Target compact label="Protein" now={dayMacros.protein} goal={goals.protein} unit="g" />
                  <Target compact label="Calories" now={dayMacros.calories} goal={goals.calories} unit="kcal" />
                  <Target compact label="Carbs" now={dayMacros.carbs} goal={goals.carbs} unit="g" />
                  <Target compact label="Fat" now={dayMacros.fats} goal={goals.fats} unit="g" />
                </div>
              </section>

              <ul style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--line)" }}>
                {SLOTS.map((slot) => {
                  const recipe     = plan.meals[slot];
                  const isChecked  = !!checkedMeals[slot];
                  const isExpanded = expandedMeal === slot;
                  const isSwapping = swapSlot === slot;
                  // Ranked alternates for this slot, six at a time; "More
                  // options" pages through the rest and wraps.
                  const swapAll  = isSwapping ? swapCandidates(goals, restrictions, slot, plan) : [];
                  const swapShown = isSwapping
                    ? Array.from({ length: Math.min(SWAP_WINDOW, swapAll.length) }, (_, k) => swapAll[(swapOffset + k) % swapAll.length])
                    : [];
                  return (
                    <li key={slot} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button type="button" className="ibtn ibtn-o" aria-pressed={isChecked} aria-label={`${recipe.name}, ${SLOT_LABELS[slot]}, logged`} onClick={() => (isChecked ? uncheckMeal(recipe, slot) : checkMeal(recipe, slot))}><Icon name="check" size="s" /></button>
                        <span className="kv grow">
                          <span className="t-c c2">{SLOT_LABELS[slot]}{isChecked ? " · logged" : ""}</span>
                          <span className="t-bs">{recipe.name}</span>
                          <span className="n-s c2">{fmt(recipe.macros.calories)}{NBSP}kcal · {recipe.macros.protein}{NBSP}g protein · {recipe.prepMins + recipe.cookMins}{NBSP}min</span>
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, paddingLeft: 54 }}>
                        <button type="button" className="btn btn-s btn-sm" aria-expanded={isSwapping} aria-label={`Swap ${recipe.name}`} onClick={() => { const opening = swapSlot !== slot; setSwapSlot(opening ? slot : null); setSwapOffset(0); if (opening) setExpandedMeal(null); }}>Swap</button>
                        <button type="button" className="btn btn-s btn-sm" aria-expanded={isExpanded} aria-label={`Recipe for ${recipe.name}`} onClick={() => { setExpandedMeal(isExpanded ? null : slot); setSwapSlot(null); }}>Recipe</button>
                      </div>

                      {isSwapping && (
                        <section aria-label={`Swap ${SLOT_LABELS[slot]}`} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0 4px 54px" }}>
                          <p className="t-s c2">{swapShown.length ? "Best fit for your targets first." : "No other recipes fit this meal within your dietary restrictions."}</p>
                          <ul className="rows">
                            {swapShown.map((alt) => (
                              <li key={alt.id}>
                                <button type="button" className="row" onClick={() => swapMeal(slot, alt)}>
                                  <span className="kv grow"><span className="t-bs">{alt.name}</span><span className="n-s c2">{fmt(alt.macros.calories)}{NBSP}kcal · {alt.macros.protein}{NBSP}g protein · {alt.prepMins + alt.cookMins}{NBSP}min</span></span>
                                  <Icon name="next" size="s" className="c2" />
                                </button>
                              </li>
                            ))}
                          </ul>
                          {swapAll.length > SWAP_WINDOW && <button type="button" className="btn btn-s btn-sm" onClick={() => setSwapOffset((offset) => (offset + SWAP_WINDOW) % swapAll.length)} style={{ alignSelf: "flex-start" }}>More options</button>}
                        </section>
                      )}

                      {isExpanded && (
                        <section aria-label={`Recipe: ${recipe.name}`} style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0 8px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                            {[["Calories", fmt(recipe.macros.calories), "kcal"], ["Protein", recipe.macros.protein, "g"], ["Carbs", recipe.macros.carbs, "g"], ["Fat", recipe.macros.fats, "g"]].map(([label, value, unit]) => (
                              <span key={label} className="kv"><span className="t-c c2">{label}</span><span><span className="n">{value}</span> <span className="t-s c2">{unit}</span></span></span>
                            ))}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <h4 className="t-ss">Ingredients</h4>
                            <ul className="rows">
                              {recipe.ingredients.map((ingredient, index) => (
                                <li key={index} className="row" style={{ minHeight: 52 }}>
                                  <span className="kv grow"><span className="t-bs">{ingredient.name}</span><span className="t-s c2">{ingredient.calories}{NBSP}kcal · {ingredient.protein}{NBSP}g protein · {ingredient.carbs}{NBSP}g carbs · {ingredient.fats}{NBSP}g fat</span></span>
                                  <span className="n-s">{ingredient.qty}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <h4 className="t-ss">Method</h4>
                            <ol style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 22, listStyle: "decimal" }}>
                              {recipe.steps.map((step, index) => <li key={index} className="t-b">{step}</li>)}
                            </ol>
                          </div>
                        </section>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="row"><span className="t-bs grow">Total prep and cook</span><span className="n">{SLOTS.reduce((total, slot) => total + plan.meals[slot].prepMins + plan.meals[slot].cookMins, 0)}{NBSP}min</span></div>
              <button type="button" className="btn btn-s btn-b" onClick={regenerate}>Generate new plans</button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Changing or removing a logged food, and saving several as one meal.
  const sheets = (
    <>
      <FoodEditSheet
        item={editingItem}
        saved={saved}
        onClose={() => setEditingId(null)}
        onServings={changeServings}
        onRemove={removeItem}
        onToggleSave={onPatchSettings ? toggleSave : null}
      />
      {onPatchSettings && <SaveMealSheet open={saveMealOpen} nutrition={nut} onClose={() => setSaveMealOpen(false)} onSave={saveMeal} />}
      <ScannedFoodSheet food={scanned} onClose={() => setScanned(null)} onAdd={(food, qty) => { setScanned(null); logItem(makeFoodItem(food, { qty, source: "scan" })); }} />
    </>
  );

  if (fuelView === "log" && !isBroadsheet) {
    return <div className="shell" data-screen="fuel-log"><div className="main">{logPanel}{sheets}</div></div>;
  }

  return (
    <div className="shell" data-screen="fuel" style={isBroadsheet ? { maxWidth: "none" } : undefined}>
      <div className="main" style={isBroadsheet ? { display: "grid", gridTemplateColumns: "1fr var(--ovt-rail-s)", gap: 24, alignItems: "start" } : undefined}>
        <section data-section="fuel-main" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 16, minWidth: 0, maxWidth: "var(--ovt-content-width)" } : { display: "contents" }}>
          <section aria-labelledby="fuel-need" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="kv" style={{ gap: 4 }}>
              <p className="t-s c2">Still needed today</p>
              <h2 id="fuel-need" className="t-hl">{fuelHero.title}</h2>
              <p className="t-s c2">{fuelHero.subtext}</p>
            </div>
            <Target label="Protein" now={nut.protein} goal={goals.protein} unit="g" />
            <Target label="Calories" now={nut.calories} goal={goals.calories} unit="kcal" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
              <Target compact label="Carbs" now={nut.carbs} goal={goals.carbs} unit="g" />
              <Target compact label="Fat" now={nut.fats} goal={goals.fats} unit="g" />
            </div>
          </section>

          {!isBroadsheet && <button type="button" className="btn btn-p btn-b" onClick={() => setFuelView("log")}>Log food</button>}

          <TodayFoods nutrition={nut} onEdit={setEditingId} onSaveMeal={onPatchSettings ? () => setSaveMealOpen(true) : null} />

          <section className="card" aria-labelledby="fuel-next" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p className="t-c c2">Next fuel action · closes the gap best</p>
            {fuelHero.onTarget || !fuelHero.suggestionAdd ? (
              <h3 id="fuel-next" className="t-h">{fuelHero.onTarget ? "Targets met. Nothing more to add." : "Log what you eat next."}</h3>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="kv grow"><h3 id="fuel-next" className="t-h">{fuelHero.suggestionAdd.label}</h3><span className="n-s c2">{addMeta(fuelHero.suggestionAdd)}</span></span>
                <button type="button" className="btn btn-s btn-sm" aria-label={`Log ${fuelHero.suggestionAdd.label}`} onClick={() => addQuick(fuelHero.suggestionAdd)}>Log it</button>
              </div>
            )}
            {!fuelHero.onTarget && alternativeQuickAdds.length > 0 && (
              <ul className="rows" style={{ borderTop: "1px solid var(--line)", paddingTop: 4 }}>
                {alternativeQuickAdds.slice(0, 3).map((add) => (
                  <li key={add.id} className="row" style={{ minHeight: 56 }}>
                    <span className="kv grow"><span className="t-bs clip">{add.label}</span><span className="n-s c2">{addMeta(add)}</span></span>
                    <button type="button" className="btn btn-s btn-sm" aria-label={`Add ${add.label}`} onClick={() => addQuick(add)}>Add</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {plan && (
            <div className="row" style={{ minHeight: 56 }}>
              {nextRecipe ? (
                <>
                  <span className="kv grow"><span className="t-c c2">Next planned meal · {SLOT_LABELS[nextMeal.slot]}</span><span className="t-bs clip">{nextRecipe.name}</span><span className="n-s c2">{fmt(nextRecipe.macros.calories)}{NBSP}kcal · {nextRecipe.macros.protein}{NBSP}g protein · {nextRecipe.prepMins + nextRecipe.cookMins}{NBSP}min</span></span>
                  <button type="button" className="btn btn-s btn-sm" aria-label={`Log ${nextRecipe.name}`} onClick={() => checkMeal(nextRecipe, nextMeal.slot)}>Log it</button>
                </>
              ) : (
                <><Icon name="done" className="good" /><span className="t-bs grow">Every planned meal is logged.</span></>
              )}
            </div>
          )}

          <section aria-labelledby="fuel-water" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="sec"><h2 id="fuel-water" className="t-ss">Water</h2><span><span className="n">{fmt(nut.water)}/{fmt(goals.water)}</span> <span className="t-s c2">oz</span></span></div>
            <span className="bar" role="img" aria-label={`Water: ${fmt(nut.water)} of ${fmt(goals.water)} ounces`}><i style={{ width: `${pct(nut.water, goals.water)}%` }} /></span>
            <div className="seg" role="group" aria-label="Add water">
              {[8, 16, 32].map((oz) => <button key={oz} type="button" className="n" aria-label={`Add ${oz} ounces of water`} onClick={() => addWater(oz)}>+{oz}{NBSP}oz</button>)}
            </div>
          </section>

          {fuelInsight?.body && <p className="banner"><Icon name="info" size="s" /><span>{fuelInsight.body}</span></p>}

          <ul className="rows">
            <li>
              <button type="button" className="row" onClick={() => setFuelView("plan")}>
                <span className="kv grow"><span className="t-bs">Meal plan</span><span className="t-s c2">{plan ? `${mealProgress.logged} of ${mealProgress.total} planned meals logged` : "No recipes match your dietary restrictions"}</span></span>
                <Icon name="next" size="s" className="c2" />
              </button>
            </li>
            <li>
              <button type="button" className="row" onClick={() => setFuelView("targets")}>
                <span className="kv grow"><span className="t-bs">Targets</span><span className="t-s c2">What you burn, measured from your own log</span></span>
                <Icon name="next" size="s" className="c2" />
              </button>
            </li>
          </ul>
        </section>

        {isBroadsheet && (
          <section data-section="fuel-dock" aria-labelledby="fuel-dock-title" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <h2 id="fuel-dock-title" className="t-title">Log food</h2>
            {logPanel}
          </section>
        )}
        {sheets}
      </div>
    </div>
  );
}
