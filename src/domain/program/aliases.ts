// Name variants → library ids, so v19 programs and years of logs keyed by
// free-text names ("Pull Ups", "DB Lunges", "Pec Deck / Cable Fly") resolve
// to one movement.
//
// New: v19 had no aliasing; each module re-guessed from names with regexes.
// Keys are normalized (see normalizeName), so case, punctuation, spacing,
// plurals and DB/Dumbbell spellings never need their own entry. Variants
// whose loads differ from the base lift (single-arm, Smith, barbell vs
// dumbbell shrugs) get their own library entry instead, so their history
// and progression never mix with the base lift's.

const TOKEN_SYNONYMS: Readonly<Record<string, string>> = { db: "dumbbell", bb: "barbell", kb: "kettlebell" };

function singular(word: string): string {
  if (word.length <= 2) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/** "Pull-Ups", "pull ups" and "Pullup" → "pullup"; "DB Rows" → "dumbbellrow". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => {
      const s = singular(w);
      return TOKEN_SYNONYMS[s] ?? s;
    })
    .join("");
}

// Readable source: library id → the names that mean it.
export const ALIAS_NAMES: Readonly<Record<string, readonly string[]>> = {
  "back-squat": ["Squat", "Barbell Squat", "Barbell Back Squat", "High-Bar Squat", "Low-Bar Squat"],
  "pendulum-squat": ["Pendulum Squat / V-Squat", "V-Squat", "Pendulum"],
  "leg-press": ["Leg Press Feet Low", "Leg Press Light", "Leg Press Machine"],
  "bodyweight-squat": ["Squat (bodyweight)", "Air Squat", "BW Squat"],
  "conventional-deadlift": ["Deadlift", "Barbell Deadlift", "DL"],
  "trap-bar-deadlift": ["Hex Bar Deadlift", "Trap Bar DL"],
  "romanian-deadlift": ["RDL", "Barbell RDL", "Barbell Romanian Deadlift"],
  "db-romanian-deadlift": ["DB RDL"],
  "barbell-hip-thrust": ["Hip Thrust"],
  "bodyweight-good-morning": ["Good Morning"],
  "back-extension": ["Hyperextension", "Back Extension (weighted)", "45° Back Extension"],
  "walking-lunge": ["Lunge", "DB Lunges", "Walking DB Lunge", "Forward Lunge"],
  "step-up": ["Box Step-Up", "DB Step-Up"],
  "barbell-bench-press": ["Bench Press", "Bench", "Flat Bench", "Flat Bench Press", "Barbell Bench"],
  "dumbbell-bench-press": ["DB Press", "Flat Dumbbell Press", "DB Bench"],
  "incline-db-press": ["Incline Dumbbell Bench Press", "Incline DB Bench"],
  "machine-chest-press": ["Chest Press", "Chest Press Machine"],
  "incline-machine-press": ["Machine Incline Press"],
  "close-grip-bench-press": ["Close Grip Bench", "CGBP"],
  "push-up": ["Push-Ups (floor)", "Press-Up", "Deficit Push-Up"],
  "dip": ["Parallel Bar Dip", "Chest Dip"],
  "overhead-press": ["OHP", "Military Press", "Standing Overhead Press", "Barbell Overhead Press", "Strict Press"],
  "seated-db-press": ["Seated DB Shoulder Press", "Shoulder Press", "Seated Shoulder Press", "DB Shoulder Press"],
  "barbell-row": ["Pendlay Row", "Bent-Over Row", "Bent Over Barbell Row"],
  "chest-supported-row": ["Machine Row", "Chest-Supported DB Row", "Seal Row"],
  "one-arm-db-row": ["DB Row", "Single-Arm DB Row"],
  "cable-row": ["Cable Row (Close Grip)", "Seated Cable Row", "Close-Grip Cable Row", "Seated Row"],
  "single-arm-lat-pulldown": ["Single-Arm Pulldown", "One-Arm Lat Pulldown"],
  "inverted-row": ["Australian Pull-Ups", "Australian Row", "Bodyweight Row", "Table Row"],
  "weighted-pull-up": ["Weighted Chin-Up"],
  "lat-pulldown": ["Pulldown", "Neutral-Grip Lat Pulldown", "Lat Pulldown Neutral Wide", "Wide-Grip Lat Pulldown"],
  "cable-fly": ["Cable Fly Low-to-High", "Cable Fly High-to-Low", "Cable Crossover", "Cable Flyes"],
  "pec-deck": ["Pec Deck / Cable Fly", "Pec Fly", "Machine Fly"],
  "db-fly": ["DB Flyes"],
  "face-pull": ["Rope Face Pull", "Cable Face Pull"],
  "shrugs": ["DB Shrug"],
  "lateral-raise": ["Lateral Raise Mechanical Dropset", "DB Lateral Raise", "Side Raise", "Side Lateral Raise"],
  "rear-delt-fly": ["Rear Delt Cable Fly", "Cable Rear Fly", "Reverse Fly", "Rear Delt Flyes"],
  "reverse-pec-deck": ["Reverse Pec Deck Fly", "Rear Delt Machine"],
  "ez-bar-curl": ["EZ Curl"],
  "dumbbell-curl": ["DB Alternating Curl", "Alternating Dumbbell Curl", "Bicep Curl"],
  "triceps-pushdown": ["Pushdown", "Rope Pushdown", "Rope Tricep Pushdown", "Rope Pressdown", "Cable Pushdown", "Tricep Rope Pushdown"],
  "skull-crusher": ["EZ Bar Skull Crushers", "Lying Triceps Extension", "DB Skullcrusher"],
  "overhead-triceps-extension": ["Overhead Extension", "Overhead DB Tricep Extension", "Overhead Cable Extension", "Overhead Cable Triceps Extension", "Overhead Rope Extension"],
  "lying-leg-curl": ["Leg Curl", "Hamstring Curl", "Prone Leg Curl"],
  "standing-calf-raise": ["Calf Raise", "Machine Calf Raise"],
  "plank": ["Core Plank", "Plank Hold", "Weighted Plank", "Front Plank"],
  "hanging-leg-raise": ["Hanging Knee Raise", "Leg Raise"],
  "crunch": ["Core Work", "Sit-Up", "Ab Crunch"],
  "farmer-carry": ["Farmer Walk"],
};

/** Normalized name → library id. */
export const ALIASES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ALIAS_NAMES).flatMap(([id, names]) => names.map((n) => [normalizeName(n), id]))),
);
