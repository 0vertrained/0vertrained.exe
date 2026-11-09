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
import { useState, useRef } from "react";
import { useTheme } from "./theme";

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

export function FoodSearch({ onAdd, showToast }) {
  const { C, S } = useTheme();
  const [query, setQuery]           = useState("");
  const [open, setOpen]             = useState(false);
  const [localResults, setLocal]    = useState([]);
  const [usdaResults, setUsda]      = useState([]);
  const [usdaStatus, setUsdaStatus] = useState("idle"); // idle | loading | done | error | unavailable
  const debounceRef = useRef(null);

  // Reset on close
  const handleToggle = () => {
    setOpen(o => !o);
    setQuery(""); setLocal([]); setUsda([]); setUsdaStatus("idle");
  };

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
    if (showToast) showToast(`+ ${food.name}`);
  };

  const allResults = [...localResults, ...usdaResults];

  return (
    <div>
      <button style={S.foodBtn} onClick={handleToggle}>
        {open ? "[ − ] Close Food Search" : "[ + ] Search / Add Food"}
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          <input
            style={{ ...S.cell, padding: "10px 10px", textAlign: "left", fontSize: 16, fontWeight: 400 }}
            placeholder="search millions of foods..."
            value={query}
            onChange={e => handleChange(e.target.value)}
            autoFocus
          />

          {/* Status line */}
          {query.length > 1 && (
            <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.08em", padding: "5px 2px", display: "flex", justifyContent: "space-between" }}>
              <span>
                {localResults.length > 0 && `${localResults.length} local`}
                {localResults.length > 0 && usdaResults.length > 0 && " · "}
                {usdaResults.length > 0 && `${usdaResults.length} from USDA`}
                {usdaStatus === "loading" && "searching USDA..."}
                {usdaStatus.startsWith("error") && (() => {
                  // Only pre-mapped, jargon-free copy renders here — never the raw
                  // Error message (which may reference internal detail).
                  const msg = usdaStatus.slice(6);
                  if (msg.includes("unavailable") || msg.includes("offline")) return "// USDA offline — local results only";
                  if (msg.includes("timed out")) return "// USDA timed out — try again";
                  if (msg.includes("API key")) return "// USDA key issue — check VITE_USDA_API_KEY";
                  // Generic transient/upstream failure (429/5xx after backoff, other statuses).
                  return "// food database unavailable — local results only";
                })()}
                {usdaStatus === "unavailable" && "// add USDA key for extended search"}
                {usdaStatus === "done" && allResults.length === 0 && "// no matches found"}
              </span>
              {usdaResults.length > 0 && (
                <span style={{ color: C.textFaint }}>USDA FoodData</span>
              )}
            </div>
          )}

          {/* Results list */}
          {allResults.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${C.lineBright}` }}>
              {/* Local results section */}
              {localResults.length > 0 && (
                <>
                  {localResults.length > 0 && usdaResults.length > 0 && (
                    <div style={{ padding: "4px 10px", fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", background: C.block, borderBottom: `1px solid ${C.line}` }}>
                      Local database
                    </div>
                  )}
                  {localResults.map((f, i) => (
                    <FoodRow key={`local-${i}`} food={f} onAdd={handleAdd} isLast={i === localResults.length - 1 && usdaResults.length === 0} />
                  ))}
                </>
              )}

              {/* USDA results section */}
              {usdaResults.length > 0 && (
                <>
                  <div style={{ padding: "4px 10px", fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", background: C.block, borderBottom: `1px solid ${C.line}` }}>
                    USDA FoodData Central
                  </div>
                  {usdaResults.map((f, i) => (
                    <FoodRow key={`usda-${i}`} food={f} onAdd={handleAdd} isLast={i === usdaResults.length - 1} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* Loading spinner row */}
          {usdaStatus === "loading" && localResults.length === 0 && (
            <div style={{ padding: "12px 10px", fontSize: 11.5, color: C.textDim, borderTop: `1px solid ${C.line}` }}>
              // searching...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FoodRow({ food, onAdd, isLast }) {
  const { C } = useTheme();
  return (
    <div
      onClick={() => onAdd(food)}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "9px 10px",
        borderBottom: isLast ? "none" : `1px solid ${C.line}`,
        cursor: "pointer",
        background: "transparent",
      }}
      onMouseEnter={e => e.currentTarget.style.background = C.line}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{food.name}</div>
        <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{food.protein}g P · {food.carbs}g C · {food.fats}g F</div>
      </div>
      <span style={{ fontSize: 13.5, color: C.text, fontWeight: 600, marginLeft: 12, flexShrink: 0 }}>{food.calories}</span>
    </div>
  );
}
