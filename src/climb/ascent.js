// Allocate ascent to the part of each route leg where a qualifying rise occurs.
// A two-metre valley-to-peak threshold prevents small GPS oscillations from
// adding climbing, even when a landmark splits a sustained uphill.
export function ascentLegs(points) {
  const legs = new Array(points.length).fill(null);
  let valley = null, peak = null, climbing = false, pending = [];
  function reset(elevation) {
    valley = elevation;
    peak = elevation;
    climbing = false;
    pending = [];
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = b.meters - a.meters, z = b.elevationMeters;
    if (!Number.isFinite(a.elevationMeters) || !Number.isFinite(z) || length > 250 ||
        Math.abs(z - a.elevationMeters) > Math.max(5, length * .65)) {
      reset(null);
      continue;
    }
    if (length <= 0) {
      // Stations can repeat the same coordinates while the altimeter drifts.
      // A vertical jump at zero horizontal distance has no route incline.
      if (z !== a.elevationMeters) reset(z);
      continue;
    }
    legs[i] = { length, rise: 0, riseStart: b.meters };
    if (valley === null) reset(a.elevationMeters);
    if (z < valley || (climbing && peak - z >= 2)) {
      reset(z);
      continue;
    }
    if (z <= peak) continue;
    const rise = z - peak;
    const riseStart = b.meters - length * rise / (z - a.elevationMeters);
    peak = z;
    if (climbing) Object.assign(legs[i], { rise, riseStart });
    else {
      pending.push({ i, rise, riseStart });
      if (peak - valley >= 2) {
        for (const item of pending) Object.assign(legs[item.i], { rise: item.rise, riseStart: item.riseStart });
        pending = [];
        climbing = true;
      }
    }
  }
  return legs;
}

export function profileSummary(points) {
  let ascent = 0, elevationCoverage = 0;
  for (const leg of ascentLegs(points)) {
    if (!leg) continue;
    ascent += leg.rise;
    elevationCoverage += leg.length;
  }
  return { ascent, elevationCoverage };
}
