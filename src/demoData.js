import { buildDemoEntries as buildRichDemoEntries, buildDemoOura, buildDemoWhoop, buildDemoStrava, buildDemoFormHistory } from "./demo/demoDataset";

export const DEMO_USER = { id: "demo-user", email: "demo@0vertrained.local", user_metadata: { username: "demo" } };

export function isDemoMode() {
  return import.meta.env.VITE_DEMO_MODE === "true";
}


// V15.5 · Delegates to the seeded generator in demo/demoDataset.js — 140
// program-driven days so every intelligence system fires. Cached: builders are
// deterministic and consumers call these repeatedly.
let _entries;
export function buildDemoEntries() {
  if (!_entries) _entries = buildRichDemoEntries(140);
  return _entries;
}
let _whoop;
export function getDemoWhoopData() {
  if (!_whoop) _whoop = buildDemoWhoop(buildDemoEntries(), 35);
  return _whoop;
}
let _strava;
export function getDemoStravaActivities() {
  if (!_strava) _strava = buildDemoStrava(buildDemoEntries(), 30);
  return _strava;
}
export const DEMO_FORM_HISTORY = buildDemoFormHistory();

export const DEMO_SETTINGS = {
  goals: { calories: 3400, protein: 200, carbs: 380, fats: 95, water: 128 },
  supplements: ["Creatine", "Whey", "Vitamin D", "Magnesium", "Electrolytes"],
  dietaryRestrictions: [],
  theme: "whitepaperLight",
  onboarded: true,
  username: "demo",
  ouraConnected: true,
  hrvSource: "ourAlgorithm",
};


export function buildDemoOuraData() {
  return buildDemoOura(buildDemoEntries(), 35);
}

export const DEMO_OURA_DATA = buildDemoOuraData();
