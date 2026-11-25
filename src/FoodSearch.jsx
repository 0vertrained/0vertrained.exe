// Enhanced Food Search
// Search priority:
//   1. Local database (instant, always available)
//   2. USDA FoodData Central API (millions of foods, free, debounced + cached)
//
// Protections against rate limits:
//   - 400ms debounce — one request per search, not per keystroke
//   - In-memory session cache — repeated searches hit zero API calls
//   - Local-first — common staples resolve instantly without an API call
//   - Graceful degradation — API failure shows local results + subtle notice
//   - Free API key from env — raises threshold, enables monitoring

import { scoreFoods } from "./constants";
import { useState, useRef, useId } from "react";
import { Icon } from "./ui/ledger";

const USDA_KEY = import.meta.env.VITE_USDA_API_KEY;
const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

// In-memory cache: query string → results array (lives for the browser session)
const searchCache = new Map();

// Convert USDA food item to our { name, calories, protein, carbs, fats } shape.
// USDA returns nutrients by nutrient ID:
//   1008 = Energy (kcal), 1003 = Protein, 1005 = Carbs, 1004 = Total Fat
function parseUsdaItem(item) {
  const nutrients = {};
  for (const n of item.foodNutrients || []) {
    nutrients[n.nutrientId || n.nutrientNumber] = n.value || 0;
  }
  // Nutrient IDs differ slightly between search and detail endpoints
  const cal     = nutrients[1008] || nutrients["208"] || 0;
  const protein = nutrients[1003] || nutrients["203"] || 0;
  const carbs   = nutrients[1005] || nutrients["205"] || 0;
  const fats    = nutrients[1004] || nutrients["204"] || 0;

  // Clean up the description — USDA names can be verbose
  let name = item.description || item.lowercaseDescription || "Unknown";
  name = name.split(",").slice(0, 2).join(",").trim(); // truncate after 2 segments
  name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

  // Determine serving size label
  const serving = item.servingSize
    ? `${Math.round(item.servingSize)}${item.servingSizeUnit || "g"}`
    : "100g";

  return {
    name: `${name} (${serving})`,
    calories: Math.round(cal),
    protein:  Math.round(protein * 10) / 10,
    carbs:    Math.round(carbs * 10) / 10,
    fats:     Math.round(fats * 10) / 10,
    source:   "usda",
  };
}

// Backoff schedule for transient upstream failures (429 rate-limit / 5xx). Two
// retries at 1s then 2s; exported so tests can advance timers deterministically.
export const USDA_RETRY_DELAYS_MS = [1000, 2000];

// Generic, jargon-free copy for any USDA failure the user might see. We never
// surface the raw HTTP status or a slice of the upstream response body — those
// stay in `console` for debugging only.
const USDA_UNAVAILABLE_MSG = "Couldn't reach the food database — showing local results";

// Fetch from USDA FoodData Central search endpoint.
// Retries once on network failure (transient errors are common on mobile) and
// up to twice with backoff on a rate-limit (429) or upstream 5xx.
export async function fetchUsda(query, attempt = 0) {
  const cacheKey = query.toLowerCase().trim();
  if (searchCache.has(cacheKey)) return searchCache.get(cacheKey);

  const url = `${USDA_BASE}/foods/search?api_key=${USDA_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        query,
        pageSize: 8,
        dataType: ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"],
      }),
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    const msg = fetchErr.message || "";
    // Distinguish CSP block from genuine network failure
    if (msg.toLowerCase().includes("load failed") || msg.toLowerCase().includes("failed to fetch")) {
      // Retry once on transient failure
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 800));
        return fetchUsda(query, 1);
      }
      throw new Error("Network unavailable — USDA search offline", { cause: fetchErr });
    }
    if (fetchErr.name === "AbortError") throw new Error("USDA request timed out", { cause: fetchErr });
    throw new Error(`Network error: ${msg}`, { cause: fetchErr });
  }
  clearTimeout(timeout);

  if (!res.ok) {
    // A bad/missing API key is a config problem, not transient — don't retry.
    if (res.status === 403) throw new Error("USDA API key invalid or missing");

    // Read the body once for debugging, then decide. The raw status + body slice
    // are logged to the console only — they must never reach the user.
    const body = await res.text().catch(() => "");

    // 429 (rate limit) and 5xx (upstream trouble) are transient: retry with a
    // short backoff before giving up and degrading to local-only results.
    if (res.status === 429 || res.status >= 500) {
      if (attempt < USDA_RETRY_DELAYS_MS.length) {
        console.warn(`USDA ${res.status} (retry ${attempt + 1}/${USDA_RETRY_DELAYS_MS.length}):`, body.slice(0, 200));
        await new Promise(r => setTimeout(r, USDA_RETRY_DELAYS_MS[attempt]));
        return fetchUsda(query, attempt + 1);
      }
      console.warn(`USDA ${res.status} (retries exhausted):`, body.slice(0, 200));
      throw new Error(USDA_UNAVAILABLE_MSG);
    }

    // Any other non-OK status: log the detail, surface only the generic copy.
    console.warn(`USDA ${res.status}:`, body.slice(0, 200));
    throw new Error(USDA_UNAVAILABLE_MSG);
  }

  const json = await res.json();
  const results = (json.foods || [])
    .map(parseUsdaItem)
    .filter(f => f.calories > 0)
    .slice(0, 6);

  searchCache.set(cacheKey, results);
  return results;
}

export function FoodSearch({ onAdd }) {
  const id = useId();
  const [query, setQuery]           = useState("");
  const [localResults, setLocal]    = useState([]);
  const [usdaResults, setUsda]      = useState([]);
  const [usdaStatus, setUsdaStatus] = useState("idle"); // idle | loading | done | error | unavailable
  const debounceRef = useRef(null);

  const handleChange = (val) => {
    setQuery(val);
    const q = val.trim();

    // Local search — instant
    setLocal(q.length > 1 ? scoreFoods(q).map(f => ({ ...f, source: "local" })) : []);
    setUsda([]);

    // Clear existing debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < 2) { setUsdaStatus("idle"); return; }

    if (!USDA_KEY) { setUsdaStatus("unavailable"); return; }

    // Debounced USDA call — 400ms after user stops typing
    setUsdaStatus("loading");
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await fetchUsda(q);
        // Deduplicate against local results by name similarity
        const localNames = new Set(scoreFoods(q).map(f => f.name.toLowerCase().slice(0, 15)));
        const deduped = results.filter(r => !localNames.has(r.name.toLowerCase().slice(0, 15)));
        setUsda(deduped);
        setUsdaStatus("done");
      } catch (e) {
        console.warn("USDA search failed:", e.message);
        setUsdaStatus("error:" + e.message);
      }
    }, 400);
  };

  const handleAdd = (food) => {
    onAdd(food);
    setQuery(""); setLocal([]); setUsda([]); setUsdaStatus("idle");
  };

  const allResults = [...localResults, ...usdaResults];
  const searching = query.trim().length > 1;
  // Plain words for where the results came from. A database error is never
  // shown raw: each cause maps to a sentence that says what still works.
  const status = !searching ? ""
    : usdaStatus === "loading" ? "Searching the USDA database…"
    : usdaStatus.startsWith("error") ? (
      usdaStatus.includes("timed out") ? "The USDA database timed out. Built-in foods are shown."
      : usdaStatus.includes("API key") ? "The USDA database is not available. Built-in foods are shown."
      : "The USDA database can’t be reached. Built-in foods are shown."
    )
    : usdaStatus === "unavailable" ? "Showing built-in foods."
    : usdaStatus === "done" && allResults.length === 0 ? "No foods match that search."
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="field">
        <span className="lbl">Search foods</span>
        <input className="input" type="search" autoComplete="off" enterKeyHint="search" value={query} onChange={(event) => handleChange(event.target.value)} aria-describedby={`${id}-status`} />
      </label>
      <p id={`${id}-status`} className="t-s c2" role="status">{status}</p>

      {localResults.length > 0 && (
        <section aria-labelledby={`${id}-local`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 id={`${id}-local`} className="t-c c2">Built in</h3>
          <ul className="rows">{localResults.map((food, index) => <FoodRow key={`local-${index}`} food={food} onAdd={handleAdd} />)}</ul>
        </section>
      )}
      {usdaResults.length > 0 && (
        <section aria-labelledby={`${id}-usda`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 id={`${id}-usda`} className="t-c c2">USDA FoodData Central</h3>
          <ul className="rows">{usdaResults.map((food, index) => <FoodRow key={`usda-${index}`} food={food} onAdd={handleAdd} />)}</ul>
        </section>
      )}
    </div>
  );
}

function FoodRow({ food, onAdd }) {
  const NBSP = " ";
  return (
    <li className="row" style={{ minHeight: 56 }}>
      <span className="kv grow">
        <span className="t-bs clip">{food.name}</span>
        <span className="t-s c2">{[food.serving || null, `${Math.round(food.calories)}${NBSP}kcal`, `${Math.round(food.protein)}${NBSP}g protein`, `${Math.round(food.carbs)}${NBSP}g carbs`, `${Math.round(food.fats)}${NBSP}g fat`].filter(Boolean).join(" · ")}</span>
      </span>
      <button type="button" className="btn btn-s btn-sm" aria-label={`Add ${food.name}`} onClick={() => onAdd(food)}><Icon name="plus" size="s" />Add</button>
    </li>
  );
}
