// src/cascade.js
// The Cascade — drop sets and rest-pause as STRUCTURE, not notes.
//
// Model: a set may carry `type: "drop" | "rp"` plus `segments`
// [{weight, reps}] — the continuation work performed after the top effort.
// The top effort stays in the set's own weight/reps fields, which preserves
// every existing consumer by construction:
//   · e1RM: isStraightSet() already excludes any set with a non-straight
//     type.
//   · Volume audit: hard-set counting sees ONE set — a drop set is one hard
//     set taken past failure, not three sets.
//   · Tonnage: sums the top segment only (the honest comparable across days).
// Pure module; the UI lives in CascadeSet.jsx.

export const CASCADE_KINDS = {
  drop: { key: "drop", label: "DROP", stepPct: 0.75, hint: "past failure: strip ~25% and go straight back in, no rest" },
  rp: { key: "rp", label: "RP", stepPct: 1.0, hint: "same load: rest fifteen breaths, squeeze out more, repeat" },
};

const round2p5 = (w) => Math.round(w / 2.5) * 2.5;

export function seedSegmentWeight(topWeight, kind) {
  const w = parseFloat(topWeight);
  if (!Number.isFinite(w) || w <= 0) return "";
  const pct = CASCADE_KINDS[kind]?.stepPct ?? 1;
  return String(round2p5(w * pct));
}

export function startCascade(set, kind) {
  if (!CASCADE_KINDS[kind]) return set;
  return { ...set, type: kind, segments: [{ weight: seedSegmentWeight(set?.weight, kind), reps: "" }] };
}

export function addSegment(set) {
  const segs = Array.isArray(set?.segments) ? set.segments : [];
  const last = segs[segs.length - 1];
  const base = last?.weight ?? set?.weight;
  const next = set.type === "drop" ? seedSegmentWeight(base, "drop") : String(parseFloat(base) || "");
  return { ...set, segments: [...segs, { weight: next, reps: "" }] };
}

export function updateSegment(set, index, field, value) {
  const segs = Array.isArray(set?.segments) ? set.segments.slice() : [];
  if (!segs[index]) return set;
  segs[index] = { ...segs[index], [field]: value };
  return { ...set, segments: segs };
}

export function removeSegment(set, index) {
  const segs = (set?.segments || []).filter((_, i) => i !== index);
  if (!segs.length) return clearCascade(set);
  return { ...set, segments: segs };
}

export function clearCascade(set) {
  const { type, segments, ...rest } = set || {};
  void type; void segments;
  return rest;
}

// "90×12 ▸ 70×8 ▸ 50×10" — the collapsed figure.
export function cascadeSummary(set) {
  if (!set?.type || !set?.segments?.length) return null;
  const part = (w, r) => `${parseFloat(w) || "·"}×${parseFloat(r) || "·"}`;
  return [part(set.weight, set.reps), ...set.segments.map((s) => part(s.weight, s.reps))].join(" ▸ ");
}

export default { CASCADE_KINDS, startCascade, addSegment, updateSegment, removeSegment, clearCascade, cascadeSummary, seedSegmentWeight };
