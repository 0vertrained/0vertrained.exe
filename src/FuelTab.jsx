// src/FuelTab.jsx
// Fuel answers one question first: what is still needed today. Under it sit
// the one best next thing to eat or drink, water, and the doors to the rest:
// Log food (search, quick adds, totals by hand), the meal plan with its
// recipes, and targets.
//
// Every write goes through the paths Fuel has always used: the day's
// nutrition totals, nutrition.plannedMeals.<slot> for a planned meal, and
// nutrition.water. A log is confirmed at once and can be undone from the
// confirmation.
import { useEffect, useRef, useState } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { Icon, Seg } from "./ui/ledger";
import { useTopBar } from "./ui/shell";
import { generateMealPlans, SLOTS, planMacros, SLOT_LABELS, swapCandidates, replaceMealInPlan } from "./mealPlan";
import { buildNutritionRecommendation } from "./nutritionCoach";
import { computeStillNeeded } from "./fuelNeeds";
import { buildFuelHero, buildFuelRecoveryInsight, buildMealPlanProgress, buildNextMealPreview } from "./fuelSummary";
import { FoodSearch } from "./FoodSearch";
import { LoadingShell } from "./ui/primitives";
import { getSkeletonPlan } from "./uiStability";
import { EnergyIntelligence } from "./EnergyIntelligence";

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

export function FuelTab({ settings, todayData, updateToday, showToast, todayKey, loaded, data }) {
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
    updateToday("nutrition", next);
  };
  const logged = (name, undo) => showToast?.(`${name} added to today`, { action: "Undo", onAction: undo });

  const addQuick = (add) => {
    applyNutrition(add);
    updateToday("intelligence.lastNutritionQuickAdd", { id: add.id, label: add.label, addedAt: new Date().toISOString() });
    logged(add.label, () => applyNutrition(add, -1));
  };
  const logFood = (food) => {
    applyNutrition(food);
    logged(food.name, () => applyNutrition(food, -1));
  };
  const addWater = (oz) => updateToday("nutrition.water", String(num(nut.water) + oz));

  const plan         = plans[planIdx];
  const checkedMeals = todayData?.nutrition?.plannedMeals || {};

  // Log a planned meal as eaten: its macros go on today's totals.
  const uncheckMeal = (recipe, slot, quiet = false) => {
    const current = nutRef.current || {};
    updateToday("nutrition.calories", String(Math.max(0, Math.round(num(current.calories) - recipe.macros.calories))));
    updateToday("nutrition.protein",  String(Math.max(0, Math.round(num(current.protein)  - recipe.macros.protein))));
    updateToday("nutrition.carbs",    String(Math.max(0, Math.round(num(current.carbs)    - recipe.macros.carbs))));
    updateToday("nutrition.fats",     String(Math.max(0, Math.round(num(current.fats)     - recipe.macros.fats))));
    updateToday(`nutrition.plannedMeals.${slot}`, null);
    if (!quiet) showToast?.(`${recipe.name} removed from today`);
  };
  const checkMeal = (recipe, slot) => {
    if (checkedMeals[slot]) return;
    const current = nutRef.current || {};
    updateToday("nutrition.calories", String(Math.round(num(current.calories) + recipe.macros.calories)));
    updateToday("nutrition.protein",  String(Math.round(num(current.protein)  + recipe.macros.protein)));
    updateToday("nutrition.carbs",    String(Math.round(num(current.carbs)    + recipe.macros.carbs)));
    updateToday("nutrition.fats",     String(Math.round(num(current.fats)     + recipe.macros.fats)));
    updateToday(`nutrition.plannedMeals.${slot}`, recipe.id);
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
      <FoodSearch onAdd={logFood} />
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

  if (fuelView === "log" && !isBroadsheet) {
    return <div className="shell" data-screen="fuel-log"><div className="main">{logPanel}</div></div>;
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
      </div>
    </div>
  );
}
