// src/physique.js
// Physique measurements kept with each day's body log, in inches:
// body.waist (as before), body.shoulders, body.chest and body.arm. Each
// reads as its latest value and the change since the measurement before,
// and shoulders over waist as a ratio over time, pairing each shoulder
// measurement with the waist measured nearest to it within a week.

export const MEASUREMENTS = [
  { key: "shoulders", label: "Shoulders", hint: "Enter around the widest part of your shoulders, in inches, for example 48.5." },
  { key: "chest", label: "Chest", hint: "Enter around the fullest part of your chest, in inches, for example 41." },
  { key: "arm", label: "Arms", hint: "Enter around your flexed upper arm, in inches, for example 15.5." },
];

const PAIR_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const round1 = (value) => Math.round(value * 10) / 10;
const round2 = (value) => Math.round(value * 100) / 100;
const dayNumber = (dateKey) => Math.round(new Date(`${dateKey}T12:00:00`).getTime() / DAY_MS);

function reading(value) {
  const number = Number.parseFloat(value);
  // Circumferences in inches; anything else is a slip of the keyboard.
  return Number.isFinite(number) && number >= 4 && number <= 90 ? number : null;
}

/** One measurement over time, oldest first: [{ date, value }]. */
export function measurementSeries(data, key) {
  return Object.keys(data || {})
    .sort()
    .map((date) => ({ date, value: reading(data[date]?.body?.[key]) }))
    .filter((point) => point.value != null);
}

/**
 * The latest of a series and how it moved since the one before:
 * { value, date, change, since } (change and since null with one reading).
 */
export function latestReading(series) {
  if (!series?.length) return null;
  const last = series[series.length - 1];
  const before = series.length > 1 ? series[series.length - 2] : null;
  return { value: last.value, date: last.date, change: before ? round1(last.value - before.value) : null, since: before?.date || null };
}

/**
 * Shoulders over waist, oldest first: [{ date, value }], on each day
 * shoulders were measured with a waist within a week of it.
 */
export function shoulderToWaist(data) {
  const waists = measurementSeries(data, "waist");
  if (!waists.length) return [];
  return measurementSeries(data, "shoulders")
    .map((shoulders) => {
      const day = dayNumber(shoulders.date);
      let nearest = null;
      for (const waist of waists) {
        const gap = Math.abs(dayNumber(waist.date) - day);
        if (gap <= PAIR_DAYS && (!nearest || gap < nearest.gap)) nearest = { gap, value: waist.value };
      }
      return nearest ? { date: shoulders.date, value: round2(shoulders.value / nearest.value) } : null;
    })
    .filter(Boolean);
}
