// src/FuelTab.jsx
// V8 refactor · Extracted verbatim from App.jsx (no behavior change): the
// Fuel tab (Log/Plan sub-tabs) plus its private FuelHero, QuickAddSection,
// and FuelRecoveryInsight pieces.
import { useState } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { useTheme } from "./theme";
import { generateMealPlans, SLOTS, planMacros, SLOT_LABELS, swapCandidates, replaceMealInPlan } from "./mealPlan";
import { buildNutritionRecommendation } from "./nutritionCoach";
import { computeStillNeeded, formatStillNeeded } from "./fuelNeeds";
import { buildFuelHero, buildFuelRecoveryInsight, buildMealPlanProgress, buildNextMealPreview } from "./fuelSummary";
import { FoodSearch } from "./FoodSearch";
import { LoadingShell, SectionHeader } from "./ui/primitives";
import { getSkeletonPlan } from "./uiStability";
import { EnergyIntelligence } from "./EnergyIntelligence";
import { FACTOR_PLAN_DAYS, FACTOR_SCAFFOLD, FACTOR_TARGETS, factorDayPlan, factorFlexSuggestion, getFactorDayIndex } from "./factorCutPlan";
import { buildNutritionAutopilot, buildInventoryAdjustment, readLatestNutritionAutopilotState } from "./nutritionAutopilot";

// Shared meal check circle (○ / ✓). Same 26px ledger checkbox used by the Next
// Meal preview and each full-plan row — one definition so the two never drift.
const mealCheckBtn = (C, isChecked) => ({
  width: 26, height: 26, borderRadius: 0,
  border: `1px solid ${isChecked ? C.text : C.lineBright}`,
  background: isChecked ? C.text : "none",
  color: isChecked ? C.bg : C.textDim,
  fontSize: 13, cursor: "pointer", display: "flex",
  alignItems: "center", justifyContent: "center", flexShrink: 0,
});


// ─── Fuel: Still Needed Hero (V2.4D) ──────────────────────────────────────────
// Execution-first lead for Fuel: "what should I eat/drink next?" before the raw
// ledger. Presentation only — buildFuelHero reshapes the already-computed
// stillNeeded/recommendation and the suggestion button reuses the existing
// addNutrition write path. No backend writes, no algorithm changes here.
function FuelHero({ hero, needs, onAddSuggestion }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const parts = formatStillNeeded(needs);

  return (
    <div style={{ padding: "16px", borderBottom: `1px solid ${C.line}`, background: C.block }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.textDim }}>Still needed today</span>
        {hero.onTarget && <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.green }}>on target</span>}
      </div>
      <div style={{ fontFamily: S.fontSerif, fontSize: 22, fontWeight: 600, color: hero.onTarget ? C.green : C.text, lineHeight: 1.15, marginTop: 6 }}>
        {hero.title}
      </div>

      {/* Primary remaining metrics: protein / calories / water */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12, marginBottom: 10 }}>
        {hero.metrics.map(m => (
          <div key={m.key} style={{ border: `1px solid ${C.line}`, padding: "8px 6px", textAlign: "center", background: C.bg }}>
            <div style={{ fontSize: 18, fontWeight: 600, fontFamily: mono, color: m.remaining > 0 ? C.text : C.green }}>
              {m.remaining > 0 ? m.remaining : "✓"}
            </div>
            <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint, marginTop: 3 }}>
              {m.remaining > 0 ? `${m.label} left · ${m.unit}` : m.label}
            </div>
            <div style={{ fontSize: 9.5, color: C.textDim, fontFamily: mono, marginTop: 4 }}>
              {m.current}/{m.target}{m.unit === "kcal" ? "" : m.unit}
            </div>
          </div>
        ))}
      </div>

      {parts.length > 0 && (
        <div style={{ fontSize: 11.5, color: C.textDim, fontFamily: mono, letterSpacing: "0.02em", marginBottom: 8 }}>
          {parts.join("  ·  ")}
        </div>
      )}
      <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5 }}>{hero.subtext}</div>
      {hero.emptyDay && !hero.onTarget && (
        <div style={{ marginTop: 8, padding: "8px 10px", border: `1px solid ${C.line}`, background: C.bg, fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>
          Empty log so far — the app is not missing data. Start with the next fuel action or open the manual ledger if you need exact totals.
        </div>
      )}

      {/* Next action — reuses the existing quick-add write path */}
      {!hero.onTarget && hero.suggestion && hero.suggestionAdd && (
        <button
          type="button"
          style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 14px", marginTop: 10, background: C.text, color: C.bg, border: `1px solid ${C.text}`, fontFamily: mono, cursor: "pointer" }}
          onClick={() => onAddSuggestion(hero.suggestionAdd)}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}>Next fuel action</span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{hero.primaryActionLabel}: {hero.suggestion.replace(/^Try\s+/i, "").replace(/\.$/, "")}</span>
          </span>
          <span style={{ fontSize: 10, color: C.bg, opacity: 0.72, whiteSpace: "nowrap" }}>{hero.suggestionAdd.calories || 0}kcal · {hero.suggestionAdd.protein || 0}P{hero.suggestionAdd.water ? ` · ${hero.suggestionAdd.water}oz` : ""} →</span>
        </button>
      )}
      {hero.onTarget && hero.suggestion && (
        <div style={{ fontSize: 11.5, color: C.green, marginTop: 8, fontFamily: mono }}>{hero.suggestion}</div>
      )}
    </div>
  );
}

// ─── Fuel: Quick Add / common foods (V2.4D) ───────────────────────────────────
// Low-friction adds broken out below the hero. Every button reuses an existing
// write path (addNutrition / addWater) — no new persistence.
function QuickAddSection({ quickAdds, onAdd, waterBehind, onWater, title = "> Quick add" }) {
  const { C, S } = useTheme();
  if (!(quickAdds?.length > 0) && !waterBehind) return null;

  return (
    <div style={S.block}>
      <SectionHeader title={title} />
      {quickAdds?.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {quickAdds.map(add => (
            <button
              key={add.id}
              type="button"
              style={{ ...S.smallBtn, textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px" }}
              onClick={() => onAdd(add)}
            >
              <span>+ {add.label}</span>
              <span style={{ fontSize: 10, color: C.textFaint }}>{add.calories || 0}kcal · {add.protein || 0}P · {add.carbs || 0}C · {add.fats || 0}F{add.water ? ` · ${add.water}oz` : ""}</span>
            </button>
          ))}
        </div>
      )}
      {waterBehind && (
        <div style={{ marginTop: quickAdds?.length > 0 ? 12 : 0 }}>
          <div style={{ fontSize: 9.5, color: C.textDim, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>Water still behind</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[8, 16, 32].map(oz => <button key={oz} style={S.waterB} onClick={() => onWater(oz)}>+{oz}oz</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Fuel ↔ Recovery insight (V2.4D) ──────────────────────────────────────────
// Display-only coaching copy derived from current fuel gaps (no recovery
// plumbing). Never a medical/nutrition diagnosis.
function FuelRecoveryInsight({ insight }) {
  const { C, S } = useTheme();
  if (!insight) return null;
  const tone = insight.tone === "caution" ? C.amber : insight.tone === "good" ? C.green : C.textDim;
  return (
    <div style={S.block}>
      <SectionHeader title="> Fuel ↔ Recovery" />
      <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.55, display: "flex", gap: 8 }}>
        <span aria-hidden="true" style={{ color: tone, flexShrink: 0 }}>—</span>
        <span>{insight.body}</span>
      </div>
    </div>
  );
}

// ─── Fuel: Next Meal preview (Phase 2) ────────────────────────────────────────
// Compact single-meal lead for the Log view so "what should I eat next" sits
// beside Still Needed + Quick Add. Reuses the existing buildNextMealPreview model
// plus the checkMeal/uncheckMeal write paths — no new state, no plan mutation.
// The "Plan ▸" button just switches sub-tabs (display-only) for full recipes.
function NextMealPreview({ plan, nextMeal, checkedMeals, progressLabel, slotLabels, onCheck, onUncheck, onOpenPlan }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  if (!plan) return null;

  const openBtn = (
    <button
      type="button"
      onClick={onOpenPlan}
      style={{ background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: mono, padding: "4px 8px", flexShrink: 0 }}
    >
      Plan ▸
    </button>
  );

  if (nextMeal.allLogged) {
    return (
      <div style={S.block}>
        <SectionHeader title="> Next meal" stat={progressLabel} tone="good" />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, color: C.green, letterSpacing: "0.02em" }}>
          <span>✓ Every planned meal is logged.</span>
          {openBtn}
        </div>
      </div>
    );
  }

  const slot = nextMeal.slot;
  if (!slot || !plan.meals?.[slot]) return null;
  const recipe = plan.meals[slot];
  const isChecked = !!checkedMeals[slot];

  return (
    <div style={S.block}>
      <SectionHeader title="> Next meal" stat={progressLabel} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={() => (isChecked ? onUncheck(recipe, slot) : onCheck(recipe, slot))}
          style={mealCheckBtn(C, isChecked)}
        >
          {isChecked ? "✓" : "○"}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9.5, color: isChecked ? C.greenMid : C.textDim, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>{slotLabels[slot]}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: isChecked ? C.green : C.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{recipe.name}</div>
          <div style={{ fontSize: 9.5, color: C.textFaint, marginTop: 2, fontFamily: mono }}>
            {recipe.macros.calories} kcal · {recipe.macros.protein}g pro · {recipe.prepMins + recipe.cookMins} min
          </div>
        </div>
        {openBtn}
      </div>
    </div>
  );
}


function FactorCutView({ todayKey, todayData, updateToday, showToast, data, goals }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const activeIndex = getFactorDayIndex(todayKey);
  const [selectedDay, setSelectedDay] = useState(activeIndex >= 0 ? activeIndex : 0);
  const [rescueOpen, setRescueOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const day = factorDayPlan(selectedDay);
  const logged = todayData?.nutrition?.factorPlan || {};
  const autopilot = buildNutritionAutopilot({
    data,
    todayKey,
    nutrition: todayData?.nutrition || {},
    goals,
    hour: new Date().getHours(),
  });
  const latestState = readLatestNutritionAutopilotState(data);
  const isTodayPlan = selectedDay === activeIndex;
  const flexLabel = day?.flex?.[1] === 0 ? "Optional" : `${day?.flex?.[0] ?? 0}–${day?.flex?.[1] ?? 0} kcal`;
  const scheduledMeals = day ? [
    ...FACTOR_SCAFFOLD.slice(0, 2).map((meal) => ({ ...meal, kind: "scaffold", verified: true })),
    { id: day.lunch.id, slot: "factorLunch", label: "Lunch · Factor", name: day.lunch.name, calories: day.lunch.calories, protein: day.lunch.protein, verified: day.lunch.verified, kind: "factor" },
    { id: day.dinner.id, slot: "factorDinner", label: "Dinner · Factor", name: day.dinner.name, calories: day.dinner.calories, protein: day.dinner.protein, verified: day.dinner.verified, kind: "factor" },
    { ...FACTOR_SCAFFOLD[2], kind: "scaffold", verified: true },
  ] : [];
  const meals = isTodayPlan ? autopilot.sequence : scheduledMeals;

  const toggle = (meal) => {
    if (!Number.isFinite(meal.calories) || !Number.isFinite(meal.protein)) {
      showToast("Verify the tray label before logging this meal");
      return;
    }
    const isLogged = logged[meal.slot] === meal.id;
    const nut = todayData?.nutrition || {};
    const sign = isLogged ? -1 : 1;
    updateToday("nutrition.calories", String(Math.max(0, Math.round((parseFloat(nut.calories)||0) + sign * meal.calories))));
    updateToday("nutrition.protein", String(Math.max(0, Math.round((parseFloat(nut.protein)||0) + sign * meal.protein))));
    updateToday(`nutrition.factorPlan.${meal.slot}`, isLogged ? null : meal.id);
    showToast(isLogged ? `${meal.name} removed` : `${meal.name} logged ✓`);
  };

  const addRescue = (option) => {
    const nut = todayData?.nutrition || {};
    updateToday("nutrition", {
      ...nut,
      calories: String(Math.round((parseFloat(nut.calories)||0) + option.calories)),
      protein: String(Math.round((parseFloat(nut.protein)||0) + option.protein)),
      carbs: String(Math.round((parseFloat(nut.carbs)||0) + option.carbs)),
      fats: String(Math.round((parseFloat(nut.fats)||0) + option.fats)),
      water: String(Math.round((parseFloat(nut.water)||0) + (option.water || 0))),
    });
    updateToday("nutrition.autopilot.lastRescue", { id: option.id, label: option.label, loggedAt: new Date().toISOString() });
    showToast(`${option.label} logged`);
  };

  const adjustInventory = (mealId, delta) => {
    updateToday("nutrition.autopilot", buildInventoryAdjustment(latestState, mealId, delta));
    showToast(delta > 0 ? "Tray added to inventory" : "Tray removed from inventory");
  };

  const gapColor = autopilot.rescueMode ? C.amber : autopilot.onTarget ? C.green : C.text;

  return (
    <div>
      <div style={{ padding:"16px", borderBottom:`1px solid ${C.line}`, background:C.block }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:12 }}>
          <div>
            <div style={{ fontSize:10, color:C.textDim, letterSpacing:"0.16em", textTransform:"uppercase" }}>Nutrition autopilot · prepared meals</div>
            <div style={{ fontFamily:S.fontSerif, fontSize:24, fontWeight:600, marginTop:4, color:gapColor }}>{isTodayPlan ? autopilot.headline : `Factor Cut · Day ${day?.day || selectedDay + 1}`}</div>
          </div>
          <span style={{ fontFamily:mono, fontSize:10, color:isTodayPlan ? C.green : C.textDim }}>{isTodayPlan ? "TODAY" : `DAY ${day?.day || selectedDay + 1}`}</span>
        </div>
        <div style={{ fontSize:12.5, color:C.textDim, lineHeight:1.55, marginTop:8 }}>
          {isTodayPlan ? autopilot.summary : day?.training}
        </div>

        {isTodayPlan && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:1, background:C.lineBright, border:`1px solid ${C.lineBright}`, marginTop:12 }}>
            {[
              ["Protein left", `${autopilot.macros.gaps.protein}g`, `${autopilot.macros.current.protein}/${autopilot.macros.target.protein || "—"}`],
              ["Calories left", autopilot.macros.gaps.calories, `${autopilot.macros.current.calories}/${autopilot.macros.target.calories || "—"}`],
              ["Trays left", autopilot.traysRemaining, autopilot.useFirst.length ? `${autopilot.useFirst.length} use first` : "inventory live"],
            ].map(([label, value, sub]) => (
              <div key={label} style={{ background:C.bg, padding:"9px 6px", textAlign:"center" }}>
                <div style={{ fontFamily:mono, fontSize:17, fontWeight:600, color:label === "Protein left" && autopilot.macros.gaps.protein > 40 ? C.amber : C.text }}>{value}</div>
                <div style={{ fontSize:9, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginTop:3 }}>{label}</div>
                <div style={{ fontSize:9.5, color:C.textDim, marginTop:3 }}>{sub}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop:12, padding:"10px 12px", border:`1px solid ${C.lineBright}`, background:C.bg }}>
          <div style={{ fontSize:9.5, color:C.textFaint, letterSpacing:"0.14em", textTransform:"uppercase" }}>{isTodayPlan ? "Next action" : "Training pairing"}</div>
          <div style={{ fontSize:14, fontWeight:600, marginTop:4 }}>{isTodayPlan ? (autopilot.nextMeal?.name || "Scheduled meals complete") : day?.training}</div>
          {isTodayPlan && autopilot.nextMeal && <div style={{ fontFamily:mono, fontSize:10, color:C.textDim, marginTop:4 }}>{autopilot.nextMeal.calories ?? "TBD"} kcal · {autopilot.nextMeal.protein ?? "TBD"}g protein</div>}
        </div>

        {!isTodayPlan && day && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, marginTop:10 }}>
              <div style={{ border:`1px solid ${C.line}`, padding:9, background:C.bg }}><div style={{ fontSize:9, color:C.textFaint, letterSpacing:"0.12em" }}>PRE-FLEX</div><div style={{ fontFamily:mono, fontSize:17, marginTop:4 }}>{day.preFlexCalories ?? "TBD"}</div><div style={{ fontSize:9.5, color:C.textDim }}>kcal</div></div>
              <div style={{ border:`1px solid ${C.line}`, padding:9, background:C.bg }}><div style={{ fontSize:9, color:C.textFaint, letterSpacing:"0.12em" }}>PROTEIN</div><div style={{ fontFamily:mono, fontSize:17, marginTop:4 }}>{day.preFlexProtein ?? "TBD"}</div><div style={{ fontSize:9.5, color:C.textDim }}>grams</div></div>
              <div style={{ border:`1px solid ${C.line}`, padding:9, background:C.bg }}><div style={{ fontSize:9, color:C.textFaint, letterSpacing:"0.12em" }}>FLEX</div><div style={{ fontFamily:mono, fontSize:17, marginTop:4 }}>{flexLabel}</div><div style={{ fontSize:9.5, color:C.textDim }}>training carbs</div></div>
            </div>
            <div style={{ marginTop:10, fontSize:12, color:C.textDim, lineHeight:1.55 }}>{factorFlexSuggestion(day)}</div>
          </>
        )}
      </div>

      <div style={{ display:"flex", gap:6, overflowX:"auto", padding:"10px 16px", borderBottom:`1px solid ${C.line}`, background:C.panel }}>
        {Array.from({length: FACTOR_PLAN_DAYS}, (_, i) => (
          <button key={i} onClick={() => setSelectedDay(i)} style={{ minWidth:34, height:30, border:`1px solid ${selectedDay===i ? C.text : C.lineBright}`, background:selectedDay===i ? C.text : "none", color:selectedDay===i ? C.bg : C.textDim, fontFamily:mono, cursor:"pointer" }}>{i+1}</button>
        ))}
      </div>

      <div style={{ borderBottom:`1px solid ${C.line}` }}>
        <div style={{ padding:"12px 16px", background:C.panel, borderBottom:`1px solid ${C.line}` }}>
          <div style={{ fontSize:10, color:C.textDim, letterSpacing:"0.16em", textTransform:"uppercase" }}>Meal sequence</div>
          <div style={{ fontSize:12, color:C.textFaint, marginTop:3 }}>Tap a circle to add or remove the meal from today’s totals.</div>
        </div>
        {meals.map((meal) => {
          const isLogged = logged[meal.slot] === meal.id;
          const unknown = !Number.isFinite(meal.calories);
          return <div key={meal.slot} style={{ padding:"12px 16px", display:"flex", gap:11, alignItems:"center", borderBottom:`1px solid ${C.line}`, background:C.bg }}>
            <button type="button" onClick={() => toggle(meal)} style={mealCheckBtn(C, isLogged)}>{isLogged ? "✓" : "○"}</button>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:9.5, color:isLogged ? C.greenMid : C.textDim, letterSpacing:"0.12em", textTransform:"uppercase" }}>{meal.label}</div>
              <div style={{ fontSize:14, fontWeight:600, color:isLogged ? C.green : C.text, marginTop:2 }}>{meal.name}</div>
              <div style={{ fontFamily:mono, fontSize:9.5, color:C.textFaint, marginTop:3 }}>{unknown ? "VERIFY LABEL" : `${meal.calories} kcal · ${meal.protein}g protein`}</div>
            </div>
            {meal.verified === false && <span style={{ border:`1px solid ${C.amber}`, color:C.amber, padding:"3px 5px", fontSize:8.5, letterSpacing:"0.1em" }}>EST.</span>}
          </div>;
        })}
      </div>

      {isTodayPlan && (
        <div style={S.block}>
          <button type="button" onClick={() => setRescueOpen((value) => !value)} style={{ width:"100%", padding:0, display:"flex", justifyContent:"space-between", background:"none", border:"none", color:C.text, fontFamily:mono, cursor:"pointer" }}>
            <span style={S.blockTitle}>{"> "}{autopilot.rescueMode ? "Rescue mode recommended" : "Rescue options"}</span>
            <span style={{ fontSize:10, color:autopilot.rescueMode ? C.amber : C.textFaint }}>{rescueOpen ? "▲" : "▼"}</span>
          </button>
          {rescueOpen && <div style={{ display:"grid", gap:7, marginTop:10 }}>
            {autopilot.rescueOptions.map((option) => (
              <button key={option.id} type="button" onClick={() => addRescue(option)} style={{ ...S.smallBtn, textAlign:"left", padding:"10px 11px", display:"flex", justifyContent:"space-between", gap:10 }}>
                <span><span style={{ color:C.text }}>{option.category} · {option.label}</span><span style={{ display:"block", color:C.textFaint, fontSize:9.5, marginTop:3 }}>{option.note}</span></span>
                <span style={{ color:C.textDim, fontSize:9.5, whiteSpace:"nowrap" }}>{option.calories} kcal · {option.protein}P</span>
              </button>
            ))}
          </div>}
        </div>
      )}

      <div style={S.block}>
        <button type="button" onClick={() => setInventoryOpen((value) => !value)} style={{ width:"100%", padding:0, display:"flex", justifyContent:"space-between", background:"none", border:"none", color:C.text, fontFamily:mono, cursor:"pointer" }}>
          <span style={S.blockTitle}>{"> "}Live box inventory</span>
          <span style={{ fontSize:10, color:C.textFaint }}>{autopilot.traysRemaining} trays · {inventoryOpen ? "▲" : "▼"}</span>
        </button>
        {inventoryOpen && <div style={{ display:"grid", gap:4, marginTop:10 }}>
          {autopilot.inventory.map((meal) => <div key={meal.id} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, alignItems:"center", padding:"7px 0", borderBottom:`1px solid ${C.line}` }}>
            <div style={{ minWidth:0 }}><div style={{ fontSize:11.5, color:C.text }}>{meal.name}</div><div style={{ fontSize:9.5, color:meal.urgency === "use_first" ? C.amber : C.textFaint, marginTop:2 }}>{meal.urgency === "use_first" ? "use first · refrigerated" : meal.freeze ? "freezer-safe" : "refrigerated"} · used {meal.consumed}</div></div>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <button type="button" aria-label={`Remove one ${meal.name}`} onClick={() => adjustInventory(meal.id, -1)} style={{ ...S.smallBtn, padding:"3px 7px" }}>−</button>
              <span style={{ fontFamily:mono, fontSize:12, color:C.text, minWidth:26, textAlign:"center" }}>×{meal.remaining}</span>
              <button type="button" aria-label={`Add one ${meal.name}`} onClick={() => adjustInventory(meal.id, 1)} style={{ ...S.smallBtn, padding:"3px 7px" }}>+</button>
            </div>
          </div>)}
        </div>}
      </div>

      {isTodayPlan && <div style={S.block}>
        <SectionHeader title="> Grocery support" />
        {autopilot.groceryPrompts.map((item) => <div key={item.id} style={{ padding:"7px 0", borderBottom:`1px solid ${C.line}` }}>
          <div style={{ fontSize:11.5, color:C.text }}>{item.label}</div>
          <div style={{ fontSize:9.5, color:C.textFaint, marginTop:2 }}>{item.why}</div>
        </div>)}
      </div>}

      <div style={{ padding:"12px 16px", fontSize:10.5, color:C.textFaint, lineHeight:1.55 }}>
        Target: ~{FACTOR_TARGETS.calories} kcal and {FACTOR_TARGETS.protein}g+ protein. {autopilot.caveat}
      </div>
    </div>
  );
}

export function FuelTab({ settings, todayData, updateToday, showToast, todayKey, loaded, data }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  // V6 · Fuel splits into Log / Plan sub-tabs (same underline pattern as
  // Progress). "Log what I just ate" and "what should I eat this week" are
  // different tasks on different time horizons; interleaving them forced the
  // three logging surfaces (quick add, ledger, search) apart. Display-only.
  const factorDayIndex = getFactorDayIndex(todayKey);
  const [fuelView, setFuelView] = useState(factorDayIndex >= 0 ? "factor" : "log"); // "log" | "factor" | "plan"
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY); // V15.1 · docked-ledger spread
  const goals        = settings?.goals || { calories: 3600, protein: 200, carbs: 400, fats: 100, water: 128 };
  const restrictions = settings?.dietaryRestrictions || [];
  const nut = todayData?.nutrition || {};
  const pct = (v, g) => Math.min(100, g > 0 ? Math.round((v / g) * 100) : 0);
  const proteinHit = (parseFloat(nut.protein)||0) >= goals.protein;
  const carbsHit   = (parseFloat(nut.carbs)||0)   >= goals.carbs;
  const fatsHit    = (parseFloat(nut.fats)||0)    >= goals.fats;
  const calHit     = (parseFloat(nut.calories)||0) >= goals.calories;
  const waterHit   = (parseFloat(nut.water)||0)   >= goals.water;
  const nutritionRecommendation = buildNutritionRecommendation({
    nutrition: nut,
    goals,
    todayProgram: null,
    recommendation: null,
  });
  const stillNeeded = computeStillNeeded(nut, goals);

  // Shared quick-add path: batches a macro/water bump through the existing
  // updateToday("nutrition", ...) write, preserving existing macro logging.
  const addNutrition = (add) => {
    updateToday("nutrition", {
      ...nut,
      calories: String(Math.round((parseFloat(nut.calories)||0) + (add.calories || 0))),
      protein:  String(Math.round((parseFloat(nut.protein)||0)  + (add.protein || 0))),
      carbs:    String(Math.round((parseFloat(nut.carbs)||0)    + (add.carbs || 0))),
      fats:     String(Math.round((parseFloat(nut.fats)||0)     + (add.fats || 0))),
      water:    String(Math.round((parseFloat(nut.water)||0)    + (add.water || 0))),
    });
    updateToday("intelligence.lastNutritionQuickAdd", { id: add.id, label: add.label, addedAt: new Date().toISOString() });
  };
  const addWater = (oz) => updateToday("nutrition.water", String((parseFloat(nut.water)||0)+oz));

  const [seed, setSeed]               = useState(0);
  const [plans, setPlans]             = useState(() => generateMealPlans(goals, restrictions, 3, 0));
  const [planIdx, setPlanIdx]         = useState(0);
  const [expandedMeal, setExpandedMeal] = useState(null);
  // V12.1 · Per-meal Swap: which slot's inline recipe chooser is open (null =
  // none) and how far the "More options" control has paged into the ranked
  // alternates. Lives only in the full-day plan rows; display-only until a pick.
  const [swapSlot, setSwapSlot]     = useState(null);
  const [swapOffset, setSwapOffset] = useState(0);
  // V2.4D: the meal plan is a preview by default; the full recipe/alternates
  // detail expands in place. Execution context (hero + quick add) stays above.
  const [showFullPlan, setShowFullPlan] = useState(false);
  // Phase 2 · The Log view leads with Still Needed + Quick Add + Next Meal; the
  // dense manual macro/hydration/search ledger is collapsed behind a disclosure
  // (display-only — the inputs and write paths inside are unchanged).
  const [showLedger, setShowLedger] = useState(false);

  // Show loading state if app data hasn't loaded yet. Keep hooks above this guard
  // so switching from loading → loaded never changes hook order. The shell mirrors
  // the loaded section rhythm (target → quick add → meal plan) so Fuel never
  // appears blank or snaps in.
  if (!loaded) return <LoadingShell plan={getSkeletonPlan("Fuel")} />;

  const plan        = plans[planIdx];
  const checkedMeals = todayData?.nutrition?.plannedMeals || {};

  // Check a meal as eaten — adds macros to today's nutrition totals
  const checkMeal = (recipe, slot) => {
    if (checkedMeals[slot]) return;
    const nut = todayData?.nutrition || {};
    updateToday("nutrition.calories", String(Math.round((parseFloat(nut.calories)||0) + recipe.macros.calories)));
    updateToday("nutrition.protein",  String(Math.round((parseFloat(nut.protein)||0)  + recipe.macros.protein)));
    updateToday("nutrition.carbs",    String(Math.round((parseFloat(nut.carbs)||0)    + recipe.macros.carbs)));
    updateToday("nutrition.fats",     String(Math.round((parseFloat(nut.fats)||0)     + recipe.macros.fats)));
    updateToday(`nutrition.plannedMeals.${slot}`, recipe.id);
    showToast(`${recipe.name} logged ✓`);
  };

  const uncheckMeal = (recipe, slot) => {
    const nut = todayData?.nutrition || {};
    updateToday("nutrition.calories", String(Math.max(0, Math.round((parseFloat(nut.calories)||0) - recipe.macros.calories))));
    updateToday("nutrition.protein",  String(Math.max(0, Math.round((parseFloat(nut.protein)||0)  - recipe.macros.protein))));
    updateToday("nutrition.carbs",    String(Math.max(0, Math.round((parseFloat(nut.carbs)||0)    - recipe.macros.carbs))));
    updateToday("nutrition.fats",     String(Math.max(0, Math.round((parseFloat(nut.fats)||0)     - recipe.macros.fats))));
    updateToday(`nutrition.plannedMeals.${slot}`, null);
    showToast(`${recipe.name} removed`);
  };

  const regenerate = () => {
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    setPlans(generateMealPlans(goals, restrictions, 3, nextSeed));
    setPlanIdx(0);
    setExpandedMeal(null);
    setSwapSlot(null);
    showToast("New plans generated");
  };

  // V12.1 · Replace a single meal in the currently selected plan with a chosen
  // alternate. Immutable (replaceMealInPlan) so other slots are preserved. If
  // the swapped meal was already logged, reverse its macros through the existing
  // uncheckMeal write path first so the ledger stays consistent — the new meal
  // then starts unlogged, leaving today's totals otherwise untouched.
  const swapMeal = (slot, newRecipe) => {
    const current = plan?.meals?.[slot];
    if (!current || !newRecipe || current.id === newRecipe.id) { setSwapSlot(null); return; }
    if (checkedMeals[slot]) uncheckMeal(current, slot);
    setPlans(prev => prev.map((p, i) => (i === planIdx ? replaceMealInPlan(p, slot, newRecipe, goals) : p)));
    setSwapSlot(null);
    if (expandedMeal === slot) setExpandedMeal(null);
    showToast(`Swapped to ${newRecipe.name}`);
  };

  const dayMacros = plan ? planMacros(plan) : { calories:0, protein:0, carbs:0, fats:0 };
  const macroColor = (v, g) => pct(v, g) >= 85 && pct(v, g) <= 115 ? C.green : pct(v, g) < 85 ? C.textDim : C.textDim;

  // V2.4D display models (pure helpers — no writes, no algorithm changes).
  const fuelHero = buildFuelHero({ nutrition: nut, goals, recommendation: nutritionRecommendation, stillNeeded });
  const fuelInsight = buildFuelRecoveryInsight({ nutrition: nut, goals, stillNeeded });
  const mealProgress = buildMealPlanProgress({ checkedMeals, slots: SLOTS });
  // V2.6: compact "next meal" preview so Fuel leads with one meal, not all five.
  const nextMeal = buildNextMealPreview({ meals: plan?.meals, checkedMeals, slots: SLOTS, slotLabels: SLOT_LABELS });
  // Which slots to render as full rows: everything when expanded, otherwise just
  // the next unlogged meal (a compact preview). Check/uncheck still works on it.
  const visibleSlots = showFullPlan
    ? SLOTS
    : (nextMeal.slot ? [nextMeal.slot] : []);
  const waterBehind = !waterHit && stillNeeded.water > 0;
  const alternativeQuickAdds = fuelHero.suggestionAdd
    ? nutritionRecommendation.quickAdds.filter((add) => add.id !== fuelHero.suggestionAdd.id)
    : nutritionRecommendation.quickAdds;

  return (
    <div>
      {/* Macro summary bar */}
      <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.line}`, background:C.panel, display:"flex", justifyContent:"space-between", gap:8 }}>
        <span style={{ fontSize:10, color:C.textDim, letterSpacing:"0.1em", textTransform:"uppercase" }}>Today's intake</span>
        <span style={{ fontSize:10, color:C.text, fontFamily:mono }}>{nut.calories||0}/{goals.calories} kcal · {nut.protein||0}/{goals.protein}g pro</span>
      </div>
      
      {/* Log / Plan sub-tabs — underline pattern shared with Progress */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <button onClick={() => setFuelView("log")} style={{ flex: 1, padding: "10px 6px", background: "none", border: "none", borderBottom: fuelView === "log" ? `1px solid ${C.text}` : "1px solid transparent", marginBottom: -1, color: fuelView === "log" ? C.text : C.textFaint, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer" }}>Log</button>
        <button onClick={() => setFuelView("factor")} style={{ flex: 1, padding: "10px 6px", background: "none", border: "none", borderBottom: fuelView === "factor" ? `1px solid ${C.text}` : "1px solid transparent", marginBottom: -1, color: fuelView === "factor" ? C.text : C.textFaint, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer" }}>Factor</button>
        <button onClick={() => setFuelView("plan")} style={{ flex: 1, padding: "10px 6px", background: "none", border: "none", borderBottom: fuelView === "plan" ? `1px solid ${C.text}` : "1px solid transparent", marginBottom: -1, color: fuelView === "plan" ? C.text : C.textFaint, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer" }}>Recipes</button>
      </div>

      {/* V15.1 · Broadsheet Fuel (mockup 1g essence): the execution column
          stays left; the manual macro/hydration ledger — with FoodSearch
          inside it — DOCKS permanently on the right instead of hiding behind
          the disclosure. Below the tier (and in Plan view) this container is
          display:contents: layout byte-identical to V14. The mockup's
          per-item meal ledger needs a logged-items data model that doesn't
          exist yet — out of "no feature moves" scope, tracked in the plan. */}
      {fuelView === "factor" && <FactorCutView todayKey={todayKey} todayData={todayData} updateToday={updateToday} showToast={showToast} data={data} goals={goals} />}
      <div style={isBroadsheet && fuelView === "log" ? { display: "grid", gridTemplateColumns: "1fr var(--ovt-rail-s)", gap: 20, alignItems: "start" } : isBroadsheet ? { maxWidth: "var(--ovt-content-width)", margin: "0 auto", width: "100%" } : { display: fuelView === "factor" ? "none" : "contents" }}>
      {fuelView === "log" && (<section data-section="fuel-main" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
      {/* 1 · Still Needed Hero — execution-first lead */}
      <FuelHero hero={fuelHero} needs={stillNeeded} onAddSuggestion={addNutrition} />

      {/* 2 · Quick add / common foods */}
      <QuickAddSection quickAdds={alternativeQuickAdds} onAdd={addNutrition} waterBehind={waterBehind} onWater={addWater} title={fuelHero.suggestionAdd ? "> Alternatives" : "> Quick add"} />

      {/* 3 · Next meal — compact preview; reuses checkMeal/uncheckMeal + nextMeal */}
      <NextMealPreview
        plan={plan}
        nextMeal={nextMeal}
        checkedMeals={checkedMeals}
        progressLabel={mealProgress.label}
        slotLabels={SLOT_LABELS}
        onCheck={checkMeal}
        onUncheck={uncheckMeal}
        onOpenPlan={() => setFuelView("plan")}
      />
      </section>)}

      {fuelView === "plan" && (<>
      {/* ── V11 · Adaptive TDEE — measured expenditure + goal targets ── */}
      <EnergyIntelligence data={data} settings={settings} />

      {/* 3 · Meal plan — preview always visible; full recipes/alternates on demand */}
      {!plan ? (
        <div style={S.block}>
          <SectionHeader title="> Meal plan" />
          <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.7 }}>
            No recipes match your current dietary restrictions.{"\n"}
            Adjust under Settings → Dietary.
          </div>
        </div>
      ) : (
      <div style={{ borderBottom: `1px solid ${C.line}` }}>
        {/* Header + logged progress */}
        <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.18em", color: C.text, textTransform: "uppercase" }}>Meal Plan</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginTop: 2 }}>
              {showFullPlan ? `Today · ${SLOTS.length} meals` : nextMeal.allLogged ? "All meals logged" : "Next meal"}
            </div>
          </div>
          <div style={{ fontSize: 11, color: mealProgress.allLogged ? C.green : C.textDim, fontFamily: mono, letterSpacing: "0.04em" }}>{mealProgress.label}</div>
        </div>

        {/* Compact all-logged state (collapsed view) — nothing left to preview */}
        {!showFullPlan && nextMeal.allLogged && (
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.line}`, background: C.bg, fontSize: 13, color: C.green, letterSpacing: "0.02em" }}>
            ✓ Every planned meal is logged. Open the full plan to review recipes or adjust.
          </div>
        )}

        {/* Alternate plan selector (full view) */}
        {showFullPlan && plans.length > 1 && (
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.line}`, background: C.block, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 9.5, color: C.textDim, letterSpacing: "0.14em", textTransform: "uppercase" }}>Plan</span>
            <div style={{ display: "flex", gap: 6 }}>
              {plans.map((_, i) => (
                <button key={i} onClick={() => setPlanIdx(i)}
                  style={{ width: 26, height: 26, borderRadius: 0, border: `1px solid ${i === planIdx ? C.text : C.lineBright}`, background: "none", color: i === planIdx ? C.text : C.textDim, fontSize: 11, cursor: "pointer", fontFamily: mono }}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Day macro summary (full view) */}
        {showFullPlan && (
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, background: C.block }}>
          <div style={{ fontSize: 9.5, color: C.textDim, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>Plan totals vs goals</div>
          {[
            { label: "PROTEIN",  val: dayMacros.protein,  goal: goals.protein,  unit: "g" },
            { label: "CARBS",    val: dayMacros.carbs,    goal: goals.carbs,    unit: "g" },
            { label: "FATS",     val: dayMacros.fats,     goal: goals.fats,     unit: "g" },
            { label: "CALORIES", val: dayMacros.calories, goal: goals.calories, unit: "" },
          ].map(({ label, val, goal, unit }) => (
            <div key={label} style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ fontSize: 9.5, color: C.textDim, letterSpacing: "0.12em" }}>{label}</span>
                <span style={{ fontSize: 10, color: macroColor(val, goal), fontFamily: mono }}>{val}{unit} / {goal}{unit}</span>
              </div>
              <div style={S.bar}><div style={{ height: "100%", background: macroColor(val, goal), width: `${pct(val, goal)}%`, transition: "width 0.3s" }} /></div>
            </div>
          ))}
        </div>
        )}

        {/* Meal rows — compact next-meal preview by default; full 5-meal plan and
            recipe detail on demand. Check/uncheck is always available. */}
        {visibleSlots.map(slot => {
          const recipe   = plan.meals[slot];
          const isChecked  = !!checkedMeals[slot];
          const isExpanded = expandedMeal === slot;
          const isSwapping = showFullPlan && swapSlot === slot;

          // Ranked alternates for this slot (pure helper). Window 6 at a time;
          // "More options" pages through the rest, wrapping so it never dead-ends.
          const SWAP_WINDOW = 6;
          const swapAll  = isSwapping ? swapCandidates(goals, restrictions, slot, plan) : [];
          const swapMore = swapAll.length > SWAP_WINDOW;
          const swapShown = isSwapping
            ? Array.from({ length: Math.min(SWAP_WINDOW, swapAll.length) },
                (_, k) => swapAll[(swapOffset + k) % swapAll.length])
            : [];

          return (
            <div key={slot} style={{ borderBottom: `1px solid ${C.line}` }}>
              <div style={{ padding: "12px 16px", background: C.bg, display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => isChecked ? uncheckMeal(recipe, slot) : checkMeal(recipe, slot)}
                  style={mealCheckBtn(C, isChecked)}>
                  {isChecked ? "✓" : "○"}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9.5, color: isChecked ? C.greenMid : C.textDim, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>{SLOT_LABELS[slot]}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: isChecked ? C.green : C.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{recipe.name}</div>
                  <div style={{ fontSize: 9.5, color: C.textFaint, marginTop: 2, fontFamily: mono }}>
                    {recipe.macros.calories} kcal · {recipe.macros.protein}g pro · {recipe.prepMins + recipe.cookMins} min
                  </div>
                </div>
                {showFullPlan && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-expanded={isSwapping}
                    onClick={() => {
                      const opening = swapSlot !== slot;
                      setSwapSlot(opening ? slot : null);
                      setSwapOffset(0);
                      if (opening) setExpandedMeal(null);
                    }}
                    style={{ background: isSwapping ? C.text : "none", border: `1px solid ${isSwapping ? C.text : C.lineBright}`, color: isSwapping ? C.bg : C.textDim, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: mono, padding: "4px 8px" }}>
                    Swap
                  </button>
                  <button type="button" aria-expanded={isExpanded} aria-label={isExpanded ? "Hide recipe" : "Show recipe"}
                    onClick={() => { setExpandedMeal(isExpanded ? null : slot); setSwapSlot(null); }}
                    style={{ background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontFamily: mono, padding: "4px 8px" }}>
                    {isExpanded ? "▲" : "Recipe"}
                  </button>
                </div>
                )}
              </div>

              {isSwapping && (
                <div style={{ background: C.cell, borderTop: `1px solid ${C.lineBright}`, padding: "10px 16px 12px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 9.5, color: C.text, letterSpacing: "0.16em", textTransform: "uppercase" }}>Swap {SLOT_LABELS[slot]}</span>
                    <span style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.06em" }}>best fit for your targets</span>
                  </div>
                  {swapShown.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.6 }}>No other recipes fit this slot within your dietary restrictions.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {swapShown.map(alt => (
                        <button
                          key={alt.id}
                          type="button"
                          onClick={() => swapMeal(slot, alt)}
                          style={{ textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 11px", background: C.bg, border: `1px solid ${C.lineBright}`, cursor: "pointer", fontFamily: mono }}>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alt.name}</span>
                            <span style={{ display: "block", fontSize: 9.5, color: C.textFaint, marginTop: 2 }}>{alt.prepMins + alt.cookMins} min · {alt.tags.length} tag{alt.tags.length === 1 ? "" : "s"}</span>
                          </span>
                          <span style={{ fontSize: 10, color: C.textDim, whiteSpace: "nowrap" }}>{alt.macros.calories}kcal · {alt.macros.protein}P →</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {swapMore && (
                    <button
                      type="button"
                      onClick={() => setSwapOffset(o => (o + SWAP_WINDOW) % swapAll.length)}
                      style={{ ...S.smallBtn, width: "100%", padding: "8px", marginTop: 8, fontSize: 10, letterSpacing: "0.12em" }}>
                      ↻ More options
                    </button>
                  )}
                </div>
              )}

              {showFullPlan && isExpanded && (
                <div style={{ background: C.cell, borderTop: `1px solid ${C.lineBright}` }}>
                  {/* Macro grid */}
                  <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.lineBright}`, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }}>
                    {[["Cal", recipe.macros.calories, ""], ["Pro", recipe.macros.protein, "g"], ["Carbs", recipe.macros.carbs, "g"], ["Fats", recipe.macros.fats, "g"]].map(([l,v,u]) => (
                      <div key={l} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{v}{u}</div>
                        <div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase" }}>{l}</div>
                      </div>
                    ))}
                  </div>

                  {/* Ingredients */}
                  <div style={{ padding: "10px 16px 0" }}>
                    <div style={{ fontSize: 9.5, color: C.text, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 8 }}>Ingredients</div>
                    {recipe.ingredients.map((ing, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.lineBright}`, fontSize: 11.5 }}>
                        <span style={{ color: C.text }}>{ing.name}</span>
                        <span style={{ color: C.textDim, fontFamily: mono, fontSize: 11 }}>{ing.qty}</span>
                      </div>
                    ))}
                  </div>

                  {/* Per-ingredient macro breakdown */}
                  <div style={{ padding: "10px 16px 0" }}>
                    <div style={{ fontSize: 9.5, color: C.text, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>Macro breakdown</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px 44px", gap: 2, marginBottom: 4 }}>
                      {["", "Cal", "Pro", "Carb", "Fat"].map(h => <div key={h} style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: h ? "center" : "left" }}>{h}</div>)}
                    </div>
                    {recipe.ingredients.map((ing, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px 44px", gap: 2, padding: "3px 0", borderBottom: `1px solid ${C.lineBright}` }}>
                        <div style={{ fontSize: 11, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ing.name}</div>
                        {[ing.calories, `${ing.protein}g`, `${ing.carbs}g`, `${ing.fats}g`].map((v, j) => (
                          <div key={j} style={{ fontSize: 11, color: C.text, textAlign: "center", fontFamily: mono }}>{v}</div>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Steps */}
                  <div style={{ padding: "10px 16px 14px" }}>
                    <div style={{ fontSize: 9.5, color: C.text, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 8 }}>Method</div>
                    {recipe.steps.map((step, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 0, background: C.bg, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: mono, fontSize: 10, color: C.text }}>{idx + 1}</div>
                        <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, paddingTop: 1 }}>{step}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Show / hide full plan (recipes, alternates, regenerate) */}
        <div style={{ padding: "12px 16px", borderBottom: showFullPlan ? `1px solid ${C.line}` : "none" }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); const next = !showFullPlan; setShowFullPlan(next); if (!next) { setExpandedMeal(null); setSwapSlot(null); } }}
            style={{ ...S.smallBtn, width: "100%", padding: "10px", fontSize: 11, letterSpacing: "0.1em" }}>
            {showFullPlan ? "▲ Hide full day plan" : `▾ Show full day plan · ${SLOTS.length} meals, recipes & regenerate`}
          </button>
        </div>

        {/* Total prep time + regenerate (full view) */}
        {showFullPlan && (<>
        <div style={{ padding: "10px 16px", background: C.block, borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.06em" }}>Total prep + cook</span>
          <span style={{ fontSize: 11, color: C.text, fontFamily: mono }}>
            {SLOTS.reduce((t, s) => t + plan.meals[s].prepMins + plan.meals[s].cookMins, 0)} min
          </span>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <button onClick={regenerate} style={{ ...S.smallBtn, width: "100%", padding: "11px", fontSize: 11.5, letterSpacing: "0.1em" }}>
            ↻ Generate new plans
          </button>
        </div>
        </>)}
      </div>
      )}
      </>)}

      {fuelView === "log" && (<section data-section="fuel-dock" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
      {/* 4 · Manual ledger disclosure — dense macro/hydration/search area is
          collapsed by default so the Log view leads with execution. Toggle is
          display-only; every input and write path inside is unchanged. */}
      {!isBroadsheet && (<div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}` }}>
        <button
          type="button"
          onClick={() => setShowLedger(v => !v)}
          aria-expanded={showLedger}
          style={{ ...S.smallBtn, width: "100%", padding: "10px", fontSize: 11, letterSpacing: "0.1em" }}
        >
          {showLedger ? "▲ Hide manual macro & hydration ledger" : "▾ Manual macro & hydration ledger · search, edit totals"}
        </button>
      </div>)}

      {(showLedger || isBroadsheet) && (<>
      {/* 4a · Macro ledger / manual edit */}
      <div style={S.block}>
        <SectionHeader title="> Macro ledger · manual edit" stat={`${nut.calories||0}/${goals.calories} KCAL`} />
        <div style={S.macroLine}>
          <div style={S.macroCell}><input style={{ ...S.macroInput, color:C.text }} type="number" inputMode="numeric" placeholder="0" value={nut.calories} onChange={e => updateToday("nutrition.calories", e.target.value)} /><div style={S.macroL}>Cal</div></div>
          <div style={S.macroCell}><input style={S.macroInput} type="number" inputMode="numeric" placeholder="0" value={nut.protein} onChange={e => updateToday("nutrition.protein", e.target.value)} /><div style={S.macroL}>Pro</div></div>
          <div style={S.macroCell}><input style={S.macroInput} type="number" inputMode="numeric" placeholder="0" value={nut.carbs} onChange={e => updateToday("nutrition.carbs", e.target.value)} /><div style={S.macroL}>Carb</div></div>
          <div style={S.macroCell}><input style={S.macroInput} type="number" inputMode="numeric" placeholder="0" value={nut.fats} onChange={e => updateToday("nutrition.fats", e.target.value)} /><div style={S.macroL}>Fat</div></div>
        </div>
        <div style={S.progRow}><span>PROTEIN {proteinHit ? "✓" : ""}</span><span style={{ color: proteinHit ? C.green : C.textDim }}>{nut.protein||0}/{goals.protein}g</span></div>
        <div style={S.bar}><div style={{ height:"100%", background: proteinHit ? C.green : C.line, width:`${pct(nut.protein, goals.protein)}%`, transition:"width 0.3s" }} /></div>
        <div style={S.progRow}><span>CARBS {carbsHit ? "✓" : ""}</span><span style={{ color: carbsHit ? C.green : C.textDim }}>{nut.carbs||0}/{goals.carbs}g</span></div>
        <div style={S.bar}><div style={{ height:"100%", background: carbsHit ? C.green : C.line, width:`${pct(nut.carbs, goals.carbs)}%`, transition:"width 0.3s" }} /></div>
        <div style={S.progRow}><span>FATS {fatsHit ? "✓" : ""}</span><span style={{ color: fatsHit ? C.green : C.textDim }}>{nut.fats||0}/{goals.fats}g</span></div>
        <div style={S.bar}><div style={{ height:"100%", background: fatsHit ? C.green : C.line, width:`${pct(nut.fats, goals.fats)}%`, transition:"width 0.3s" }} /></div>
        <div style={S.progRow}><span>CALORIES {calHit ? "✓" : ""}</span><span style={{ color: calHit ? C.green : C.textDim }}>{nut.calories||0}/{goals.calories}</span></div>
        <div style={S.bar}><div style={{ height:"100%", background: calHit ? C.green : C.line, width:`${pct(nut.calories, goals.calories)}%`, transition:"width 0.3s" }} /></div>
        <FoodSearch
          onAdd={food => {
            updateToday("nutrition.calories", String(Math.round((parseFloat(nut.calories)||0) + food.calories)));
            updateToday("nutrition.protein",  String(Math.round((parseFloat(nut.protein)||0)  + food.protein)));
            updateToday("nutrition.carbs",    String(Math.round((parseFloat(nut.carbs)||0)    + food.carbs)));
            updateToday("nutrition.fats",     String(Math.round((parseFloat(nut.fats)||0)     + food.fats)));
          }}
          showToast={showToast}
        />
      </div>

      {/* 4b · Hydration ledger */}
      <div style={S.block}>
        <SectionHeader title="> Hydration" stat={`${Math.round(pct(nut.water, goals.water))}%`} />
        <div style={S.waterRow}>
          <input
            style={{ ...S.waterV, background:"none", border:"none", outline:"none", width:90, fontFamily:C.fontFamily, padding:0 }}
            type="number" inputMode="numeric"
            value={nut.water || ""}
            placeholder="0"
            onChange={e => updateToday("nutrition.water", e.target.value)}
          />
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
            <div style={S.waterBtns}>{[8,16,32].map(oz => <button key={oz} style={S.waterB} onClick={() => updateToday("nutrition.water", String((parseFloat(nut.water)||0)+oz))}>+{oz}</button>)}</div>
            <span style={{ fontSize:9.5, color:C.textFaint, letterSpacing:"0.06em" }}>/{goals.water}oz goal</span>
          </div>
        </div>
        <div style={{ ...S.bar, marginTop:10 }}><div style={{ height:"100%", background: waterHit ? C.green : C.text, width:`${pct(nut.water, goals.water)}%`, transition:"width 0.3s" }} /></div>
      </div>
      </>)}

      {/* 5 · Fuel ↔ Recovery insight (display-only) — kept outside the disclosure
          so the Fuel↔Recovery coaching stays reachable in the default view. */}
      <FuelRecoveryInsight insight={fuelInsight} />
      </section>)}
      </div>
  </div>
  );
}

