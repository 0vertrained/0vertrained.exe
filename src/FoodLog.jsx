// src/FoodLog.jsx
// The food log's pieces for Fuel: today's foods with a sheet to change or
// remove one, a sheet to save several as one meal, and your saved and recent
// foods for one-tap logging. The rules for what each change does to the
// day's totals live in ./foodLog.
import { useState } from "react";
import { Icon, Sheet } from "./ui/ledger";
import { selectionHaptic } from "./native";
import {
  SERVING_STEP, MAX_SERVINGS, dayFoods, foodsTotal, itemTotals, isSavedFood, mealFromFoods, servingsLabel, untrackedTotals,
} from "./foodLog";

const NBSP = " ";
const fmt = (value) => Math.round(Number(value) || 0).toLocaleString("en-US");
const SHOWN = 6;

// "300 kcal · 34 g protein", for a food as eaten.
export function foodMeta(totals, { full = false } = {}) {
  return [
    `${fmt(totals.calories)}${NBSP}kcal`,
    `${fmt(totals.protein)}${NBSP}g protein`,
    full ? `${fmt(totals.carbs)}${NBSP}g carbs` : null,
    full ? `${fmt(totals.fats)}${NBSP}g fat` : null,
  ].filter(Boolean).join(" · ");
}

function timeOf(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Today's foods, each opening a sheet to change or remove it. */
export function TodayFoods({ nutrition, onEdit, onSaveMeal }) {
  const [all, setAll] = useState(false);
  const items = dayFoods(nutrition);
  const extra = untrackedTotals(nutrition);
  const total = foodsTotal(items);
  const shown = all ? items : items.slice(-SHOWN);
  return (
    <section aria-labelledby="fuel-foods" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="sec">
        <h2 id="fuel-foods" className="t-ss">Today’s food</h2>
        {items.length > 0 && <span className="t-s c2">{items.length} logged · {fmt(total.calories)}{NBSP}kcal</span>}
      </div>
      {items.length === 0 && !extra && <p className="t-s c2">Nothing logged yet. Foods you log are listed here, where you can change or remove them.</p>}
      {items.length > SHOWN && !all && (
        <button type="button" className="btn btn-g btn-sm" onClick={() => setAll(true)} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
          Show {items.length - SHOWN} earlier
        </button>
      )}
      {shown.length > 0 && (
        <ul className="rows">
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" className="row" style={{ minHeight: 56 }} onClick={() => onEdit(item.id)} aria-label={`${item.name}, ${foodMeta(itemTotals(item))}. Change or remove`}>
                <span className="kv grow">
                  <span className="t-bs clip">{item.name}</span>
                  <span className="n-s c2">{[servingsLabel(item.qty), foodMeta(itemTotals(item)), timeOf(item.at)].filter(Boolean).join(" · ")}</span>
                </span>
                <Icon name="next" size="s" className="c2" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {extra && (
        <p className="t-s c2">
          {items.length ? "Plus " : ""}{[extra.calories ? `${fmt(extra.calories)}${NBSP}kcal` : null, extra.protein ? `${fmt(extra.protein)}${NBSP}g protein` : null].filter(Boolean).join(" and ")} entered as totals.
        </p>
      )}
      {items.length >= 2 && onSaveMeal && (
        <button type="button" className="btn btn-g btn-sm" onClick={onSaveMeal} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>Save foods as a meal</button>
      )}
    </section>
  );
}

/** Servings, save and remove for one logged food. */
export function FoodEditSheet({ item, saved, onClose, onServings, onRemove, onToggleSave }) {
  const open = Boolean(item);
  const qty = Number(item?.qty) || 1;
  const step = (delta) => {
    const next = Math.min(MAX_SERVINGS, Math.max(SERVING_STEP, qty + delta));
    if (next === qty) return;
    selectionHaptic();
    onServings(item.id, next);
  };
  const isSaved = open && isSavedFood(saved, item);
  return (
    <Sheet open={open} title={item?.name || "Food"} onClose={onClose}>
      {open && (
        <>
          {item.serving && <p className="t-s c2">One serving is {item.serving}.</p>}
          {item.parts?.length > 0 && <p className="t-s c2">{item.parts.join(", ")}</p>}
          <div className="row" style={{ minHeight: 64 }}>
            <span className="t-bs grow">Servings</span>
            <div className="step" role="group" aria-label="Servings" style={{ width: 216 }}>
              <button type="button" aria-label="Fewer servings" aria-disabled={qty <= SERVING_STEP || undefined} onClick={() => step(-SERVING_STEP)}><Icon name="minus" /></button>
              <span className="stepv"><span className="n-md" aria-live="polite">{qty}</span></span>
              <button type="button" aria-label="More servings" aria-disabled={qty >= MAX_SERVINGS || undefined} onClick={() => step(SERVING_STEP)}><Icon name="plus" /></button>
            </div>
          </div>
          <p className="n-s c2">{foodMeta(itemTotals(item), { full: true })}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {onToggleSave && (
              <button type="button" className="btn btn-s" aria-pressed={isSaved} onClick={() => onToggleSave(item)}>
                <Icon name={isSaved ? "done" : "plus"} size="s" />{isSaved ? "Saved to your foods" : "Save to your foods"}
              </button>
            )}
            <button type="button" className="btn btn-s" onClick={() => onRemove(item.id)}>Remove from today</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Pick several of today's foods and save them under one name. */
export function SaveMealSheet({ open, nutrition, onClose, onSave }) {
  const items = dayFoods(nutrition);
  const [name, setName] = useState("");
  const [left, setLeft] = useState({});
  const chosen = items.filter((item) => !left[item.id]);
  const meal = mealFromFoods(chosen, name);
  const close = () => { setName(""); setLeft({}); onClose(); };
  return (
    <Sheet open={open} title="Save as a meal" onClose={close}>
      {open && (
        <>
          <label className="field">
            <span className="lbl">Meal name</span>
            <input className="input" type="text" autoComplete="off" placeholder="Breakfast" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <ul className="rows" aria-label="Foods in the meal">
            {items.map((item) => {
              const included = !left[item.id];
              return (
                <li key={item.id}>
                  <button type="button" className="row" aria-pressed={included} onClick={() => setLeft((current) => ({ ...current, [item.id]: included }))} style={{ minHeight: 56 }}>
                    <Icon name={included ? "done" : "plus"} className={included ? "good" : "c2"} />
                    <span className="kv grow">
                      <span className="t-bs clip">{item.name}</span>
                      <span className="n-s c2">{[servingsLabel(item.qty), foodMeta(itemTotals(item))].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="n-s c2">{chosen.length ? foodMeta(foodsTotal(chosen), { full: true }) : "Pick at least one food."}</p>
          <button type="button" className="btn btn-p btn-b" aria-disabled={!meal || undefined} onClick={() => { if (!meal) return; onSave(meal); close(); }}>Save meal</button>
        </>
      )}
    </Sheet>
  );
}

function PickRow({ food, onAdd, action = "Add", actionLabel, aside = null }) {
  const qty = Number(food.qty) || 1;
  const totals = itemTotals({ ...food, qty });
  return (
    <li className="row" style={{ minHeight: 56 }}>
      <span className="kv grow">
        <span className="t-bs clip">{food.name}</span>
        <span className="n-s c2">{[servingsLabel(qty), foodMeta(totals)].filter(Boolean).join(" · ")}</span>
      </span>
      {aside}
      <button type="button" className="btn btn-s btn-sm" aria-label={actionLabel || `Add ${food.name}`} onClick={() => onAdd(food)}>
        {action === "Add" && <Icon name="plus" size="s" />}{action}
      </button>
    </li>
  );
}

/** Saved foods and meals, then recent foods, each one tap from today's log. */
export function YourFoods({ saved, recent, onAdd, onToggleSave }) {
  const [managing, setManaging] = useState(false);
  if (!saved.length && !recent.length) return null;
  return (
    <>
      {saved.length > 0 && (
        <section aria-labelledby="fuel-saved" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="sec">
            <h2 id="fuel-saved" className="t-c c2">Saved</h2>
            {onToggleSave && <button type="button" className="btn btn-g btn-sm" aria-pressed={managing} onClick={() => setManaging((value) => !value)}>{managing ? "Done" : "Edit"}</button>}
          </div>
          <ul className="rows">
            {saved.map((food) => (
              <PickRow
                key={`${food.name}|${food.serving || ""}`}
                food={food}
                onAdd={managing ? onToggleSave : onAdd}
                action={managing ? "Remove" : "Add"}
                actionLabel={managing ? `Remove ${food.name} from your saved foods` : `Add ${food.name}`}
              />
            ))}
          </ul>
        </section>
      )}
      {recent.length > 0 && (
        <section aria-labelledby="fuel-recent" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="fuel-recent" className="t-c c2">Recent</h2>
          <ul className="rows">
            {recent.map((food) => (
              <PickRow
                key={`${food.name}|${food.serving || ""}`}
                food={food}
                onAdd={onAdd}
                aside={onToggleSave ? <button type="button" className="btn btn-g btn-sm" aria-label={`Save ${food.name} to your foods`} onClick={() => onToggleSave(food)}>Save</button> : null}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** A scanned food, with its servings chosen before it goes on today. */
export function ScannedFoodSheet({ food, onAdd, onClose }) {
  const [qty, setQty] = useState(1);
  const [shown, setShown] = useState(food);
  // A new scan starts again at one serving.
  if (food !== shown) {
    setShown(food);
    setQty(1);
  }
  const step = (delta) => {
    const next = Math.min(MAX_SERVINGS, Math.max(SERVING_STEP, qty + delta));
    if (next === qty) return;
    selectionHaptic();
    setQty(next);
  };
  return (
    <Sheet open={Boolean(food)} title={food?.name || "Scanned food"} onClose={onClose}>
      {food && (
        <>
          <p className="t-s c2">One serving is {food.serving}.</p>
          <div className="row" style={{ minHeight: 64 }}>
            <span className="t-bs grow">Servings</span>
            <div className="step" role="group" aria-label="Servings" style={{ width: 216 }}>
              <button type="button" aria-label="Fewer servings" aria-disabled={qty <= SERVING_STEP || undefined} onClick={() => step(-SERVING_STEP)}><Icon name="minus" /></button>
              <span className="stepv"><span className="n-md" aria-live="polite">{qty}</span></span>
              <button type="button" aria-label="More servings" aria-disabled={qty >= MAX_SERVINGS || undefined} onClick={() => step(SERVING_STEP)}><Icon name="plus" /></button>
            </div>
          </div>
          <p className="n-s c2">{foodMeta(itemTotals({ ...food, qty }), { full: true })}</p>
          <button type="button" className="btn btn-p btn-b" onClick={() => onAdd(food, qty)}>Add to today</button>
        </>
      )}
    </Sheet>
  );
}
