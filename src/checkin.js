// src/checkin.js
// Pure helper for the Today "Check-in" card collapsed summary.
// No React, no network, no writes.

// Count how many of the user's supplements are marked taken today.
export function countSupplements(supplements = {}, supplementNames = []) {
  return supplementNames.filter(name => supplements?.[name]).length;
}

// Build the compact one-line check-in summary parts, e.g.
// ["184.5 lb", "6.6h sleep", "E6/S2", "2/5 supps", "note"].
export function summarizeCheckin({ body = {}, workout = {}, supplements = {}, supplementNames = [] } = {}) {
  const parts = [];
  if (body.weight) parts.push(`${body.weight} lb`);
  if (body.sleep) parts.push(`${body.sleep}h sleep`);
  if (body.energy || body.soreness) {
    parts.push(`E${body.energy || "–"}/S${body.soreness || "–"}`);
  }
  parts.push(`${countSupplements(supplements, supplementNames)}/${supplementNames.length} supps`);
  parts.push(workout.notes ? "note" : "no note");
  return parts;
}

export default { countSupplements, summarizeCheckin };
