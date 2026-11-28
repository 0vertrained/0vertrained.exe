import { ascentLegs } from "./ascent";
import { gradeAt, lowerBound } from "./course";

const profiles = new WeakMap();
export const GRADE_HOLD_MS = 3000;
const MAX_DISTANCE_INTERVAL_MS = 10000;

function visitProfile(course, start, end, visit) {
  let legs = profiles.get(course);
  if (!legs) { legs = ascentLegs(course.points); profiles.set(course, legs); }
  for (let i = Math.max(1, lowerBound(course.points, "meters", start)); i < legs.length; i++) {
    const a = course.points[i - 1].meters;
    if (a >= end) break;
    const b = course.points[i].meters, lo = Math.max(a,start), hi = Math.min(b,end);
    const leg = legs[i];
    if (hi <= lo || !leg) continue;
    const ascendingLength = Math.max(0, hi - Math.max(lo, leg.riseStart));
    const rise = leg.rise && leg.rise * ascendingLength / (b - leg.riseStart);
    visit(lo, hi, rise, ascendingLength);
  }
}

const emptyRow = mark => ({ id: mark.id, reachedMeters: 0, profileMeters: 0, targetAscent: 0,
  beltMeters: 0, beltAscent: 0, comparableMeters: 0, comparableTarget: 0, comparableBelt: 0,
  cueMeters: 0, cueMatchedMeters: 0, cappedMeters: 0, capProfileMeters: 0, capTargetAscent: 0,
  limitedObservedMeters: 0, downhillCueMeters: 0 });

function addDistance(course, sections, from, to, grade, cap) {
  let start = 0;
  for (let i = 0; i < course.landmarks.length && start < to; i++) {
    const mark = course.landmarks[i], lo = Math.max(start, from), hi = Math.min(mark.meters, to);
    start = mark.meters;
    if (hi <= lo) continue;
    const row = { ...(sections[i] || emptyRow(mark)) };
    sections[i] = row;
    if (grade === null) {
      row.reachedMeters += hi - lo;
      visitProfile(course, lo, hi, (a, b, rise, ascendingLength) => {
        row.profileMeters += b - a;
        row.targetAscent += rise;
        if (Number.isFinite(cap) && cap >= 0) {
          row.capProfileMeters += b - a;
          const attainable = Math.min(rise, ascendingLength * cap / 100);
          row.capTargetAscent += attainable;
          if (rise - attainable > 1e-8) row.cappedMeters += ascendingLength;
        }
      });
      continue;
    }
    // A treadmill counter measures travel along the sloping belt. Grade
    // represents rise / horizontal run. This is estimated vertical gain.
    const verticalFraction = Math.max(0, grade) / Math.hypot(100, grade);
    row.beltMeters += hi - lo;
    row.beltAscent += (hi - lo) * verticalFraction;
    visitProfile(course, lo, hi, (a, b, rise) => {
      const length = b - a;
      row.comparableMeters += length;
      row.comparableTarget += rise;
      row.comparableBelt += length * verticalFraction;
      const cue = gradeAt(course, (a + b) / 2);
      if (!Number.isFinite(cue)) return;
      row.cueMeters += length;
      if (Math.abs(cue - grade) <= 1) row.cueMatchedMeters += length;
      if (cue < 0 || (Number.isFinite(cap) && cue > cap)) row.limitedObservedMeters += length;
      if (cue < 0) row.downhillCueMeters += length;
    });
  }
}

export function gradeSamples(event, previous, continuous) {
  if (event.source !== "belt" || event.estimated) return [];
  const combined = [...(continuous && previous?.gradeSample ? [previous.gradeSample] : []),
    ...(Array.isArray(event.grades) ? event.grades : [])];
  const earliest = continuous ? previous?.gradeEpoch ?? previous?.now : event.now;
  const byTime = new Map();
  for (const sample of combined) {
    if (Number.isFinite(sample?.at) && sample.at >= earliest && sample.at <= event.now && Number.isFinite(sample.percent) &&
        Math.abs(sample.percent) <= 100) byTime.set(sample.at, sample);
  }
  return [...byTime.values()].sort((a, b) => a.at - b.at);
}

export function accountSectionTerrain(course, state, {target, delta, event, continuous, grades}) {
  if (target <= state.distanceMeters) return {};
  const sections = [...(state.terrainSections || [])];
  // Restore the attempted course profile on an old in-progress journal. Earlier
  // whole-run deck aggregates cannot be assigned retrospectively to landmarks.
  const start = state.distanceMeters;
  if (!sections.length && start > 0) addDistance(course, sections, 0, start, null);
  addDistance(course, sections, start, target, null, event.gradeCap);
  const dt = event.now - state.lastAt;
  if (continuous && event.source === "belt" && !event.estimated && dt > 0 && dt <= MAX_DISTANCE_INTERVAL_MS) {
    const distanceAt = at => Math.min(target, start + delta * (at - state.lastAt) / dt);
    for (let i = 0; i < grades.length; i++) {
      const sample = grades[i];
      const from = Math.max(state.lastAt, sample.at);
      const to = Math.min(event.now, sample.at + GRADE_HOLD_MS, grades[i + 1]?.at ?? Infinity);
      if (to > from) addDistance(course, sections, distanceAt(from), distanceAt(to), sample.percent, event.gradeCap);
    }
  }
  const total = field => sections.reduce((n,r)=>n+r[field],0);
  const legacy = state.legacyDeckTotals ?? (!state.terrainSections && state.deckObservedMeters > 0 ? {
    observed:state.deckObservedMeters, matched:state.deckMatchedMeters || 0, limited:state.deckLimitedMeters || 0
  } : null);
  return { terrainSections:sections, ...(legacy && {legacyDeckTotals:legacy}),
    deckObservedMeters:total("cueMeters") + (legacy?.observed || 0),
    deckMatchedMeters:total("cueMatchedMeters") + (legacy?.matched || 0),
    deckLimitedMeters:total("limitedObservedMeters") + (legacy?.limited || 0) };
}

export function describeTerrainSections(course, run) {
  if (!Array.isArray(run?.terrainSections) || !Array.isArray(course?.landmarks)) return [];
  return run.terrainSections.flatMap((r,i) => {
    const landmark = course.landmarks[i];
    if (!r || r.id !== landmark?.id || !(r.reachedMeters > 0)) return [];
    const start = i === 0 ? 0 : course.landmarks[i-1].meters;
    const end = Math.min(landmark.meters, start + r.reachedMeters);
    const fraction = n => Math.max(0, Math.min(1, n / r.reachedMeters));
    return [{...r, start, end, name:landmark.name, partial:end < landmark.meters - .02,
      coverage:fraction(r.beltMeters), profileCoverage:fraction(r.profileMeters),
      comparableCoverage:fraction(r.comparableMeters), deficit:r.comparableTarget - r.comparableBelt}];
  });
}
