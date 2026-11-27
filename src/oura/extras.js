// src/oura/extras.js
// Oura's daytime stress, resilience and bedtime window (/api/oura/extras),
// and tags with the mornings after them (/api/oura/tags). The server reads
// them live from Oura and stores none of it; here each is kept a while per
// account so screens don't ask again. ./extrasView.js turns them into words.

import { supabase } from "../supabaseClient";
import { isDemoMode } from "../demoData";

const EXTRAS_TTL_MS = 30 * 60 * 1000;
const TAGS_TTL_MS = 3 * 60 * 60 * 1000;

function cachedRead(path, ttlMs) {
  let cache = null; // { userId, value, expiresAt }
  let inFlight = null; // { userId, promise }
  const read = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    const token = session?.access_token;
    if (!userId || !token) return null;
    if (cache && cache.userId === userId && cache.expiresAt > Date.now()) return cache.value;
    if (inFlight && inFlight.userId === userId) return inFlight.promise;
    const promise = fetch(path, { headers: { accept: "application/json", authorization: `Bearer ${token}` } })
      .then(async (response) => {
        // Not connected, or Oura said no: remembered as nothing, for a while.
        const value = response.ok ? await response.json() : null;
        cache = { userId, value, expiresAt: Date.now() + ttlMs };
        return value;
      })
      .catch(() => null)
      .finally(() => { inFlight = null; });
    inFlight = { userId, promise };
    return promise;
  };
  read.forget = () => { cache = null; };
  return read;
}

const readExtras = cachedRead("/api/oura/extras?days=14", EXTRAS_TTL_MS);
const readTags = cachedRead("/api/oura/tags?days=90", TAGS_TTL_MS);

function demoDay(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const DEMO_LEVELS = ["solid", "solid", "adequate", "adequate", "solid", "strong", "strong", "solid", "adequate", "limited", "adequate", "solid", "solid", "strong"];

function demoExtras() {
  return {
    stress: [
      { day: demoDay(-1), summary: "normal", stressMinutes: 75, recoveryMinutes: 140 },
      { day: demoDay(0), summary: null, stressMinutes: 20, recoveryMinutes: 35 },
    ],
    resilience: DEMO_LEVELS.map((level, index) => ({ day: demoDay(index - DEMO_LEVELS.length + 1), level, sleepRecovery: 72, daytimeRecovery: 48, stress: 61 })),
    bedtime: { day: demoDay(0), startMinutes: -75, endMinutes: -30, recommendation: "follow_optimal_bedtime" },
    unavailable: [],
  };
}

function demoTags() {
  const tags = [];
  const mornings = [];
  for (let offset = -60; offset <= 0; offset += 1) {
    const sauna = offset % 4 === 0;
    const alcohol = offset % 15 === 0;
    if (sauna) tags.push({ day: demoDay(offset), label: "Sauna" });
    if (alcohol) tags.push({ day: demoDay(offset), label: "Alcohol" });
    const afterSauna = (offset - 1) % 4 === 0;
    const afterAlcohol = (offset - 1) % 15 === 0;
    mornings.push({
      day: demoDay(offset),
      readiness: 78 + (afterSauna ? 4 : 0) - (afterAlcohol ? 9 : 0),
      hrv: 58 + (afterSauna ? 6 : 0) - (afterAlcohol ? 12 : 0),
      restingHr: 49 - (afterSauna ? 1 : 0) + (afterAlcohol ? 5 : 0),
    });
  }
  return { needsReconnect: false, days: 60, tags, mornings };
}

/** { stress, resilience, bedtime, unavailable }, or null without Oura. */
export async function loadOuraExtras() {
  if (isDemoMode()) return demoExtras();
  return readExtras();
}

/** { needsReconnect, tags, mornings }, or null without Oura. */
export async function loadOuraTags() {
  if (isDemoMode()) return demoTags();
  return readTags();
}

/** After connecting or reconnecting: read again next time. */
export function forgetOuraExtras() {
  readExtras.forget();
  readTags.forget();
}
