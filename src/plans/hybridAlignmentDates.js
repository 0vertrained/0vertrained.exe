export function validDateKey(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const time = Date.parse(key + "T12:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key;
}

// Revisions take effect on a particular day. A subsequent decision must not
// change the prescription that an athlete already started or logged.
export function alignmentOn(marker, dateKey) {
  if (marker?.id !== "roadTrailHybrid" || !Array.isArray(marker.alignments)) return null;
  const startDate = marker.startDate ?? marker.startMonday;
  let latest = null;
  for (const item of marker.alignments) {
    if (!validDateKey(item?.effectiveDate) || item.effectiveDate > dateKey) continue;
    if (item.raceDate !== null && (!validDateKey(item.raceDate) || item.raceDate < startDate)) continue;
    if (!latest || item.effectiveDate >= latest.effectiveDate) latest = item;
  }
  return latest?.raceDate ? latest : null;
}
