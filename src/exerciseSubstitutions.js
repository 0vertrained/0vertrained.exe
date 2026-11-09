// src/exerciseSubstitutions.js
// "Rack's taken" substitutions. Matches an exercise name to a movement
// pattern by keyword and returns 3-4 curated equivalents with a short note on
// how the stimulus shifts. Curated and conservative on purpose: pattern-true
// swaps only, no creative programming — the goal is same-session equivalence,
// not a new program. Pure data + lookup, no state.

const PATTERNS = [
  {
    key: "squat",
    label: "Squat pattern",
    match: ["back squat", "front squat", "squat", "hack squat", "leg press", "goblet"],
    subs: [
      { name: "Hack squat / pendulum", note: "quad focus preserved · less spinal load" },
      { name: "Leg press", note: "load matches or exceeds · no balance demand" },
      { name: "Goblet squat", note: "load drops ~50% · chase reps + tempo" },
      { name: "Bulgarian split squat", note: "unilateral · ~40% of bar load per side" },
    ],
  },
  {
    key: "hinge",
    label: "Hip hinge",
    match: ["deadlift", "rdl", "romanian", "hinge", "good morning", "hip thrust"],
    subs: [
      { name: "DB Romanian deadlift", note: "hamstring stimulus preserved · grip limits first" },
      { name: "Hip thrust", note: "glute-dominant · drop hamstring expectation" },
      { name: "Back extension (weighted)", note: "similar posterior chain · easier recovery" },
      { name: "Trap-bar deadlift", note: "closest 1:1 if a trap bar is free" },
    ],
  },
  {
    key: "h_press",
    label: "Horizontal press",
    match: ["bench", "chest press", "push-up", "pushup", "dip"],
    subs: [
      { name: "DB bench press", note: "stability↑ · expect ~20% less total load" },
      { name: "Machine chest press", note: "stimulus preserved · easier to push near failure" },
      { name: "Weighted push-up", note: "bodyweight + plate · chase reps" },
      { name: "Dips", note: "shifts lower-chest/triceps · joint-angle change" },
    ],
  },
  {
    key: "v_press",
    label: "Vertical press",
    match: ["overhead", "ohp", "shoulder press", "military", "push press", "arnold"],
    subs: [
      { name: "Seated DB shoulder press", note: "closest swap · slightly less core demand" },
      { name: "Machine shoulder press", note: "stimulus preserved · safest near failure" },
      { name: "Landmine press", note: "shoulder-friendly arc · unilateral option" },
    ],
  },
  {
    key: "v_pull",
    label: "Vertical pull",
    match: ["pull-up", "pullup", "chin-up", "chinup", "lat pulldown", "pulldown"],
    subs: [
      { name: "Lat pulldown", note: "1:1 pattern swap · easy load matching" },
      { name: "Assisted pull-up", note: "same movement · adjust assistance to rep target" },
      { name: "Straight-arm pulldown", note: "lat isolation · drop weight, chase stretch" },
    ],
  },
  {
    key: "row",
    label: "Horizontal row",
    match: ["barbell row", "bent-over", "bent over", "row", "seal row", "t-bar"],
    subs: [
      { name: "Chest-supported DB row", note: "removes lower-back limiter · same lat/mid-back work" },
      { name: "Seated cable row", note: "constant tension · easy load matching" },
      { name: "Single-arm DB row", note: "unilateral · ~half load per side" },
    ],
  },
  {
    key: "lunge",
    label: "Lunge / split stance",
    match: ["lunge", "split squat", "step-up", "step up"],
    subs: [
      { name: "Walking DB lunge", note: "1:1 swap · grip becomes the limiter" },
      { name: "Smith split squat", note: "balance removed · push closer to failure" },
      { name: "Step-ups", note: "similar stimulus · pick a knee-height box" },
    ],
  },
  {
    key: "curl",
    label: "Biceps",
    match: ["curl"],
    subs: [
      { name: "DB alternating curl", note: "1:1 swap" },
      { name: "Cable curl", note: "constant tension · slightly lighter" },
      { name: "Hammer curl", note: "adds brachialis · similar load" },
    ],
  },
  {
    key: "triceps",
    label: "Triceps",
    match: ["pushdown", "push-down", "skull", "skullcrusher", "extension", "close-grip", "close grip"],
    subs: [
      { name: "Cable pushdown (any handle)", note: "1:1 swap across attachments" },
      { name: "Overhead cable extension", note: "long-head bias · drop weight ~20%" },
      { name: "DB skullcrusher", note: "free-weight equivalent" },
    ],
  },
  {
    key: "lateral",
    label: "Lateral delts",
    match: ["lateral raise", "lateral", "side raise"],
    subs: [
      { name: "Cable lateral raise", note: "better bottom-range tension · go lighter" },
      { name: "Machine lateral raise", note: "1:1 swap" },
      { name: "DB upright row (wide)", note: "compound alternative · moderate loads" },
    ],
  },
  {
    key: "calf",
    label: "Calves",
    match: ["calf"],
    subs: [
      { name: "Standing DB calf raise", note: "1:1 with a step + dumbbell" },
      { name: "Leg-press calf raise", note: "heavy loading without balance demand" },
    ],
  },
];

export function getSubstitutions(exerciseName) {
  if (!exerciseName || typeof exerciseName !== "string") return null;
  const n = exerciseName.toLowerCase();
  for (const p of PATTERNS) {
    if (p.match.some(k => n.includes(k))) {
      // Never suggest the exercise itself as its own substitute.
      const subs = p.subs.filter(s => !n.includes(s.name.toLowerCase()));
      return { pattern: p.label, subs: subs.slice(0, 4) };
    }
  }
  return null;
}

const REASON_LABELS = Object.freeze({
  equipment: "Equipment",
  joint: "Joint-friendly",
  fatigue: "Lower fatigue",
});

function substitutionTraits(substitution) {
  const text = `${substitution.name} ${substitution.note}`.toLowerCase();
  return {
    equipment: /(db|dumbbell|cable|machine|bodyweight|push-up|step-up|landmine)/.test(text) ? 2 : 1,
    joint: /(shoulder-friendly|safest|supported|machine|landmine|less spinal|easier recovery|balance removed)/.test(text) ? 3 : 1,
    fatigue: /(supported|machine|easier recovery|less spinal|no balance|isolation|cable|bodyweight)/.test(text) ? 3 : 1,
  };
}

export function getRankedSubstitutions(exerciseName, { reason = "equipment" } = {}) {
  const base = getSubstitutions(exerciseName);
  if (!base) return null;
  const safeReason = REASON_LABELS[reason] ? reason : "equipment";
  const subs = base.subs
    .map((substitution, index) => {
      const traits = substitutionTraits(substitution);
      return {
        ...substitution,
        rank: traits[safeReason] * 10 - index,
        tags: [
          traits.joint >= 3 ? "joint-friendly" : null,
          traits.fatigue >= 3 ? "lower fatigue" : null,
        ].filter(Boolean),
      };
    })
    .sort((a, b) => b.rank - a.rank)
    .map(({ rank, ...substitution }) => substitution);
  return { ...base, reason: safeReason, reasonLabel: REASON_LABELS[safeReason], subs };
}

export { REASON_LABELS };
