// Reconcile separate recordings of the same training activity by identity,
// timing and sport. A group contains aliases for one physical activity.

export function sportKind(value) {
  const sport = String(value || "").toLowerCase();
  if (/lift|strength|weight.?training/.test(sport)) return "lift";
  if (/run|jog|walk|hike/.test(sport)) return "run";
  if (/ride|cycl|bik|spin/.test(sport)) return "ride";
  if (/swim/.test(sport)) return "swim";
  return null;
}

// Higher scores mean stronger evidence: a provider ID, overlapping recordings,
// or compatible sport and duration/distance. With no timestamps, ambiguous
// same-day recordings remain context. Known distinct modalities can coexist.
function matchScore(a, b) {
  if (a.source && a.source === b.source && a.id && b.id) return String(a.id) === String(b.id) ? 5 : 0;
  const startA = Date.parse(a.startTime), startB = Date.parse(b.startTime);
  if (Number.isFinite(startA) && Number.isFinite(startB)) {
    const gap = Math.abs(startA - startB) / 60000;
    if (gap <= 3) return 4;
    const earlier = startA < startB ? a : b;
    if (earlier.minutes > 0 && gap >= earlier.minutes) return 0;
    if (gap >= 240 && !earlier.minutes) return 0;
    if (a.minutes > 0 && b.minutes > 0) {
      const overlap = Math.min(startA / 60000 + a.minutes, startB / 60000 + b.minutes) - Math.max(startA, startB) / 60000;
      if (overlap >= 0.5 * Math.min(a.minutes, b.minutes)) return 3;
    }
  }
  if (a.kind && b.kind && a.kind !== b.kind) {
    if (![a.kind, b.kind].includes("cardio") || [a.kind, b.kind].includes("lift")) return 0;
  }
  if (a.minutes > 0 && b.minutes > 0 && Math.abs(a.minutes - b.minutes) <= Math.max(2, .1 * Math.min(a.minutes, b.minutes))) return 2;
  if (a.miles > 0 && b.miles > 0 && Math.abs(a.miles - b.miles) <= Math.max(.1, .05 * Math.min(a.miles, b.miles))) return 2;
  return 1;
}

// Each higher-priority workout can match at most one record from this source.
// Match the strongest evidence first so an ambiguous record cannot take the
// place of a later exact match. Retain aliases for the next source.
export function reconcileActivities(groups, records) {
  // Older confirmed Apple and Strava fills stored one summed time/distance
  // for several activities. Recognize the whole total before pairing records.
  const legacy = groups.filter(group => group.length === 1 && !group[0].source && !group[0].startTime && group[0].kind !== "lift");
  if (legacy.length === 1 && records.length > 1) {
    const logged = legacy[0][0];
    const compatible = records.filter(record => matchScore(logged, record) > 0);
    if (compatible.length > 1) {
      const totals = compatible.reduce((t, r) => ({ minutes: t.minutes + (r.minutes || 0), miles: t.miles + (r.miles || 0) }), { minutes: 0, miles: 0 });
      const comparable = ["minutes", "miles"].filter(key => logged[key] > 0 && totals[key] > 0);
      if (comparable.length && comparable.every(key => Math.abs(totals[key] - logged[key]) <= Math.max(.05, logged[key] * .025))) {
        groups.splice(groups.indexOf(legacy[0]), 1, ...compatible.map(record => [record]));
      }
    }
  }
  const matches = [];
  groups.forEach((group, index) => {
    records.forEach((record, r) => {
      const prior = group.find(item => item.source === record.source && item.id && record.id);
      const score = prior ? matchScore(prior, record) : Math.max(...group.map(item => matchScore(item, record)));
      if (score) matches.push({ index, r, score });
    });
  });
  const usedGroups = new Set(), covered = new Set();
  for (const { index, r } of matches.sort((a, b) => b.score - a.score)) {
    if (covered.has(r) || usedGroups.has(index)) continue;
    groups[index].push(records[r]);
    usedGroups.add(index);
    covered.add(r);
  }
  const added = records.filter((_, r) => !covered.has(r));
  for (const record of added) groups.push([record]);
  return added;
}
