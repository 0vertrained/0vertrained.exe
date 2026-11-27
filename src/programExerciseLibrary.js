// src/programExerciseLibrary.js
// Program Builder V2 — Exercise + Cardio Library
//
// A structured, deterministic library the program builder draws from so that
// generated weeks have real movement variety instead of a handful of hardcoded
// strings. Everything here is pure data + pure selection helpers — no React,
// no Supabase, no clocks or randomness — so it is fully unit testable.
//
// Each strength exercise carries a movement `pattern`, an `equipment` tag, a
// `difficulty`, sensible default sets/reps and a short, human-readable coaching
// note. Cardio sessions live in a separate catalog with intensity + effort so
// the builder can respect recovery spacing rules.

import { resolveTrackingMode, TRACKING_MODES } from "./workoutLogging.js";

// Movement patterns
export const MOVEMENT_LABELS = {
  squat: "Squat", hinge: "Hip hinge", singleLeg: "Single-leg work",
  horizontalPush: "Horizontal press", verticalPush: "Overhead press",
  horizontalPull: "Horizontal row", verticalPull: "Vertical pull",
  chestIsolation: "Chest isolation", backIsolation: "Back accessories",
  lateralDelts: "Side delts", rearDelts: "Rear delts", biceps: "Biceps", triceps: "Triceps",
  quadIso: "Quad isolation", hamstringIso: "Hamstring accessories", calves: "Calves", core: "Core",
  carry: "Loaded carries", conditioning: "Conditioning",
};
export const MOVEMENT_PATTERNS = Object.keys(MOVEMENT_LABELS);

// Patterns treated as compound (heavier, anchor lifts) vs. accessory work.
export const COMPOUND_PATTERNS = [
  "squat", "hinge", "singleLeg",
  "horizontalPush", "verticalPush",
  "horizontalPull", "verticalPull",
];
export function isCompoundPattern(pattern) {
  return COMPOUND_PATTERNS.includes(pattern);
}

// Equipment
// Exercise-level tag → which equipment MODES may use it.
export const EQUIPMENT_MODES = ["full_gym", "dumbbells", "bodyweight", "mixed"];

export const EQUIPMENT_LABELS = {
  barbell: "Barbell", dumbbell: "Dumbbell", kettlebell: "Kettlebell", plate: "Added weight",
  machine: "Machine", selectorized: "Selectorized machine", plate_loaded: "Plate-loaded machine",
  cable: "Cable", bodyweight: "Calisthenics", sled: "Sled",
};

const EQUIPMENT_ALLOW = {
  full_gym: Object.keys(EQUIPMENT_LABELS),
  mixed: Object.keys(EQUIPMENT_LABELS),
  dumbbells:  ["dumbbell", "bodyweight"],
  bodyweight: ["bodyweight"],
};

const DIFFICULTY_RANK = { beginner: 1, intermediate: 2, advanced: 3 };

// Compact constructor to keep the catalog readable.
function ex(name, pattern, equipment, difficulty, defaultSets, defaultReps, notes, alternatives = [], trackingMode) {
  return { name, pattern, equipment, difficulty, defaultSets, defaultReps, notes, alternatives, ...(trackingMode && { trackingMode }) };
}

// Strength catalog
export const EXERCISES = [
  // ── Squat pattern ──
  ex("Back Squat", "squat", "barbell", "intermediate", 4, 6, "Brace hard, sit between the hips, hit at least parallel. Controlled descent, drive the floor away.", ["Front Squat", "Goblet Squat"]),
  ex("Front Squat", "squat", "barbell", "advanced", 4, 6, "Elbows high, upright torso. More quad and upper-back demand than the back squat.", ["Back Squat", "Goblet Squat"]),
  ex("Goblet Squat", "squat", "dumbbell", "beginner", 3, 10, "Hold one dumbbell at the chest. Elbows track inside the knees, chest tall. Great for learning depth.", ["Bodyweight Squat", "Leg Press"]),
  ex("Leg Press", "squat", "machine", "beginner", 3, 12, "Adjust the seat and foot placement so your hips stay against the pad through each rep.", ["Goblet Squat", "Hack Squat"]),
  ex("Hack Squat", "squat", "machine", "intermediate", 3, 10, "Quad-biased squat with back support. Push through mid-foot, full depth.", ["Leg Press", "Front Squat"]),
  ex("Bodyweight Squat", "squat", "bodyweight", "beginner", 3, 15, "Feet shoulder-width, sit back and down, chest up. Slow tempo makes it harder.", ["Goblet Squat", "Bodyweight Split Squat"]),

  // ── Hinge pattern ──
  ex("Conventional Deadlift", "hinge", "barbell", "intermediate", 4, 5, "Bar over mid-foot, lats tight, push the floor away. Take warm-up sets seriously.", ["Trap Bar Deadlift", "Romanian Deadlift"]),
  ex("Trap Bar Deadlift", "hinge", "barbell", "beginner", 4, 6, "More forgiving than conventional — neutral grip, tall chest. A safe strength anchor.", ["Conventional Deadlift", "Romanian Deadlift"]),
  ex("Romanian Deadlift", "hinge", "barbell", "intermediate", 3, 8, "Push the hips back, soft knees, feel the hamstring stretch — not the low back.", ["DB Romanian Deadlift", "Conventional Deadlift"]),
  ex("DB Romanian Deadlift", "hinge", "dumbbell", "beginner", 3, 10, "Dumbbells against the legs, hinge back, flat back throughout. Control the stretch.", ["Romanian Deadlift", "Glute Bridge"]),
  ex("Barbell Hip Thrust", "hinge", "barbell", "intermediate", 3, 10, "Upper back on a bench, drive through heels, full lockout with a 1s glute squeeze.", ["Glute Bridge", "DB Romanian Deadlift"]),
  ex("Glute Bridge", "hinge", "bodyweight", "beginner", 3, 15, "Feet flat, drive hips up, squeeze glutes at the top. Add a pause to progress.", ["Barbell Hip Thrust", "DB Romanian Deadlift"]),

  // ── Single-leg ──
  ex("Bulgarian Split Squat", "singleLeg", "dumbbell", "intermediate", 3, 10, "Rear foot elevated, most weight through the front leg. Upright torso, controlled.", ["Walking Lunge", "Reverse Lunge"]),
  ex("Walking Lunge", "singleLeg", "dumbbell", "beginner", 3, 12, "Long strides, back knee toward the floor. Keep the torso tall. Per-leg reps.", ["Reverse Lunge", "Step-Up"]),
  ex("Step-Up", "singleLeg", "dumbbell", "beginner", 3, 10, "Sturdy box, drive through the lead heel, minimal push from the trailing foot.", ["Walking Lunge", "Reverse Lunge"]),
  ex("Reverse Lunge", "singleLeg", "bodyweight", "beginner", 3, 10, "Step back and down — easier on the knees than forward lunges. Per-leg reps.", ["Walking Lunge", "Step-Up"]),

  // ── Horizontal push ──
  ex("Barbell Bench Press", "horizontalPush", "barbell", "intermediate", 4, 6, "Scapulae retracted, controlled descent to the chest, drive up. Anchor pressing lift.", ["Dumbbell Bench Press", "Push-Up"]),
  ex("Dumbbell Bench Press", "horizontalPush", "dumbbell", "beginner", 3, 10, "Deeper stretch than the barbell. Lower under control, press without clashing the bells.", ["Barbell Bench Press", "Incline DB Press"]),
  ex("Incline DB Press", "horizontalPush", "dumbbell", "intermediate", 3, 10, "30–45° incline for the upper chest. Deep stretch, don't touch the bells at the top.", ["Dumbbell Bench Press", "Barbell Bench Press"]),
  ex("Push-Up", "horizontalPush", "bodyweight", "beginner", 3, 12, "Rigid plank, elbows ~45°, chest to the floor. Elevate the hands to regress.", ["Weighted Push-Up", "Dumbbell Bench Press"]),
  ex("Weighted Push-Up", "horizontalPush", "plate", "advanced", 3, 10, "Use a fitted weight vest or secured external load. Record the added weight.", ["Push-Up", "Dumbbell Bench Press"], TRACKING_MODES.LOADED_REPS),

  // ── Vertical push ──
  ex("Overhead Press", "verticalPush", "barbell", "intermediate", 4, 6, "Standing, brace the trunk, press to a full overhead lockout. Bar path close to the face.", ["Seated DB Press", "Pike Push-Up"]),
  ex("Seated DB Press", "verticalPush", "dumbbell", "beginner", 3, 10, "Stop just outside the head at the bottom, full lockout up. Don't lean back.", ["Overhead Press", "Pike Push-Up"]),
  ex("Pike Push-Up", "verticalPush", "bodyweight", "intermediate", 3, 10, "Hips high, press the head toward the floor. Elevate the feet to progress.", ["Seated DB Press", "Push-Up"]),

  // ── Horizontal pull ──
  ex("Barbell Row", "horizontalPull", "barbell", "intermediate", 4, 8, "Hinge to ~45°, pull to the lower chest, lead with the elbows. Flat back.", ["Chest-Supported Row", "One-Arm DB Row"]),
  ex("Chest-Supported Row", "horizontalPull", "machine", "beginner", 3, 10, "Chest on the pad removes the low back. Squeeze the shoulder blades at the top.", ["Cable Row", "One-Arm DB Row"]),
  ex("One-Arm DB Row", "horizontalPull", "dumbbell", "beginner", 3, 10, "Brace on a bench, pull the dumbbell to the hip, big stretch at the bottom.", ["Chest-Supported Row", "Cable Row"]),
  ex("Cable Row", "horizontalPull", "cable", "beginner", 3, 12, "Drive the elbows back, slight forward lean at the start for a lat stretch.", ["Chest-Supported Row", "One-Arm DB Row"]),
  ex("Inverted Row", "horizontalPull", "bodyweight", "beginner", 3, 10, "Use a fixed low bar or anchored rings. Keep the body straight and move your feet to adjust difficulty.", ["One-Arm DB Row", "Cable Row"]),

  // ── Vertical pull ──
  ex("Pull-Up", "verticalPull", "bodyweight", "advanced", 3, 8, "Full hang to chin over the bar. Add load once clean, or use a band to assist.", ["Lat Pulldown", "Assisted Pull-Up"]),
  ex("Lat Pulldown", "verticalPull", "cable", "beginner", 3, 12, "Drive the elbows down and back, chest tall, control the return.", ["Pull-Up", "Assisted Pull-Up"]),
  ex("Assisted Pull-Up", "verticalPull", "machine", "beginner", 3, 10, "Set the counterweight so you can complete controlled reps. Record pounds of assistance and reduce it as you progress.", ["Lat Pulldown", "Pull-Up"]),

  // ── Chest isolation ──
  ex("Cable Fly", "chestIsolation", "cable", "beginner", 3, 12, "Slight elbow bend, hug the arms together, 1s squeeze. Think chest, not arms.", ["Pec Deck", "DB Fly"]),
  ex("Pec Deck", "chestIsolation", "machine", "beginner", 3, 12, "Fixed path isolation. Controlled squeeze, slow return to a stretch.", ["Cable Fly", "DB Fly"]),
  ex("DB Fly", "chestIsolation", "dumbbell", "intermediate", 3, 12, "Soft elbows, wide arc, deep stretch. Light load, long tension.", ["Cable Fly", "Pec Deck"]),

  // ── Back isolation ──
  ex("Face Pull", "backIsolation", "cable", "beginner", 3, 20, "Rope to eye level, externally rotate at the end. Rear delts + healthy shoulders.", ["Rear Delt Fly", "Straight-Arm Pulldown"]),
  ex("Straight-Arm Pulldown", "backIsolation", "cable", "beginner", 3, 15, "Arms long, drive the bar to the thighs. Lat isolation with constant tension.", ["Face Pull", "Cable Row"]),
  ex("Shrugs", "backIsolation", "dumbbell", "beginner", 3, 15, "Straight up, pause at the top, no rolling. Traps.", ["Face Pull", "Cable Row"]),

  // ── Lateral delts ──
  ex("Lateral Raise", "lateralDelts", "dumbbell", "beginner", 4, 15, "Lead with the elbow, slight forward lean. Control down — no swinging.", ["Cable Lateral Raise"]),
  ex("Cable Lateral Raise", "lateralDelts", "cable", "beginner", 3, 15, "Constant tension through the full range. Great for a burnout drop set.", ["Lateral Raise"]),

  // ── Rear delts ──
  ex("Rear Delt Fly", "rearDelts", "dumbbell", "beginner", 3, 15, "Hinge over, arc the dumbbells out and back. Squeeze the rear delts, not the traps.", ["Reverse Pec Deck", "Face Pull"]),
  ex("Reverse Pec Deck", "rearDelts", "machine", "beginner", 3, 15, "Fixed-path rear delt isolation. Slow squeeze, controlled return.", ["Rear Delt Fly", "Face Pull"]),

  // ── Biceps ──
  ex("EZ Bar Curl", "biceps", "barbell", "beginner", 3, 10, "Elbows pinned, full range, no swing. The bread-and-butter mass builder.", ["Incline DB Curl", "Cable Curl"]),
  ex("Incline DB Curl", "biceps", "dumbbell", "intermediate", 3, 12, "Arms behind the torso for a long-head stretch. Slow negatives.", ["EZ Bar Curl", "Hammer Curl"]),
  ex("Hammer Curl", "biceps", "dumbbell", "beginner", 3, 12, "Neutral grip for brachialis and forearms — width, not just peak.", ["Incline DB Curl", "Cable Curl"]),
  ex("Cable Curl", "biceps", "cable", "beginner", 3, 15, "Constant tension, full range. A clean pump finisher.", ["EZ Bar Curl", "Hammer Curl"]),

  // ── Triceps ──
  ex("Triceps Pushdown", "triceps", "cable", "beginner", 3, 15, "Elbows pinned to the sides, full lockout, control the return.", ["Skull Crusher", "Overhead Triceps Extension"]),
  ex("Skull Crusher", "triceps", "barbell", "intermediate", 3, 12, "Lower to the forehead, elbows toward the ceiling — don't let them flare.", ["Triceps Pushdown", "Overhead Triceps Extension"]),
  ex("Overhead Triceps Extension", "triceps", "dumbbell", "beginner", 3, 12, "Long-head stretch behind the head. Elbows in, lower slowly.", ["Skull Crusher", "Triceps Pushdown"]),
  ex("Bench Dip", "triceps", "bodyweight", "beginner", 3, 12, "Hands on a bench, lower under control, press to lockout. Elevate feet to progress.", ["Triceps Pushdown", "Push-Up"]),

  // ── Quad isolation ──
  ex("Leg Extension", "quadIso", "machine", "beginner", 3, 15, "Full contraction with a 1s hold at the top, slow negative. Quad isolation.", ["Leg Press"]),

  // ── Hamstring isolation ──
  ex("Lying Leg Curl", "hamstringIso", "machine", "beginner", 3, 12, "Align the knee with the pivot and bend it smoothly. Keep the hips against the pad.", ["Seated Leg Curl", "DB Romanian Deadlift"]),
  ex("Seated Leg Curl", "hamstringIso", "machine", "beginner", 3, 12, "Deeper hamstring stretch than lying. Controlled tempo, full range.", ["Lying Leg Curl", "DB Romanian Deadlift"]),

  // ── Calves ──
  ex("Standing Calf Raise", "calves", "machine", "beginner", 4, 15, "Full stretch at the bottom, full contraction at the top. Gastrocnemius.", ["Seated Calf Raise", "DB Calf Raise"]),
  ex("Seated Calf Raise", "calves", "machine", "beginner", 3, 15, "Knees bent to bias the soleus. Pause 1s at the bottom stretch.", ["Standing Calf Raise", "DB Calf Raise"]),
  ex("DB Calf Raise", "calves", "dumbbell", "beginner", 3, 20, "One or two dumbbells, on a step for range. Full stretch and squeeze.", ["Standing Calf Raise", "Seated Calf Raise"]),
  ex("Bodyweight Calf Raise", "calves", "bodyweight", "beginner", 3, 20, "On a step for full range, one-legged to add load. Slow, full stretch and squeeze.", ["Standing Calf Raise", "DB Calf Raise"]),

  // ── Bodyweight leg accessories (home/travel fallbacks) ──
  ex("Sissy Squat", "quadIso", "bodyweight", "advanced", 3, 12, "Rise onto the toes, lean back and bend the knees — deep quad isolation. Hold support to scale.", ["Leg Extension"]),
  ex("Single-Leg Glute Bridge", "hamstringIso", "bodyweight", "intermediate", 3, 12, "One leg planted, drive the hip up, squeeze. Hamstring and glute focus. Per-leg reps.", ["Lying Leg Curl", "Glute Bridge"]),

  // ── Core ──
  ex("Plank", "core", "bodyweight", "beginner", 3, 45, "Hips in line with the shoulders, brace hard. Time under tension (seconds).", ["Dead Bug", "Hanging Leg Raise"]),
  ex("Dead Bug", "core", "bodyweight", "beginner", 3, 10, "Low back pressed to the floor, lower opposite arm/leg slowly. Per-side reps.", ["Plank", "Pallof Press"]),
  ex("Pallof Press", "core", "cable", "beginner", 3, 12, "Anti-rotation — resist the cable pulling you round. Press out and hold.", ["Dead Bug", "Plank"]),
  ex("Cable Crunch", "core", "cable", "beginner", 3, 15, "Round the spine down toward the knees, crunch with the abs, not the hips.", ["Hanging Leg Raise", "Plank"]),
  ex("Hanging Leg Raise", "core", "bodyweight", "intermediate", 3, 12, "Full hang, raise legs to parallel or above, no swinging. Control the descent.", ["Cable Crunch", "Dead Bug"]),
  // Free weights and loaded conditioning
  ex("Landmine Press", "verticalPush", "barbell", "beginner", 3, 10, "Secure the bar in its pivot. Press one end forward and up, keeping the ribs stacked.", ["Seated DB Press", "Machine Shoulder Press"]),
  ex("Dumbbell Curl", "biceps", "dumbbell", "beginner", 3, 10, "Turn the palm up as you curl and lower through a comfortable range.", ["Cable Curl", "Hammer Curl"]),
  ex("Kettlebell Deadlift", "hinge", "kettlebell", "beginner", 3, 10, "Stand over the bell, hinge to the handle and stand tall. Lower it between your feet.", ["Trap Bar Deadlift", "DB Romanian Deadlift"]),
  ex("Kettlebell Swing", "conditioning", "kettlebell", "intermediate", 3, 12, "Hinge to drive the bell forward. End the set when hip speed or technique drops.", ["Kettlebell Deadlift"]),
  ex("Farmer Carry", "carry", "dumbbell", "beginner", 3, 30, "Walk tall with a weight in each hand. Record the total external load and yards traveled.", ["Suitcase Carry"]),
  ex("Suitcase Carry", "carry", "kettlebell", "beginner", 3, 25, "Carry one weight at your side with a level trunk. Match the distance on each side.", ["Farmer Carry"]),
  ex("Sled Push", "conditioning", "sled", "beginner", 3, 20, "Use short driving steps. Record the same sled’s training load and the distance in yards.", ["Farmer Carry"], TRACKING_MODES.CARRY),
  ex("Backward Sled Drag", "conditioning", "sled", "beginner", 3, 20, "Face the sled with the straps taut. Walk backward on a clear lane and log load and yards.", ["Sled Push"], TRACKING_MODES.CARRY),

  // Selectorized and plate-loaded stations
  ex("Machine Chest Press", "horizontalPush", "selectorized", "beginner", 3, 10, "Set the seat so the handles meet mid-chest. Keep the same seat setting between sessions.", ["Dumbbell Bench Press", "Plate-Loaded Incline Press"]),
  ex("Plate-Loaded Incline Press", "horizontalPush", "plate_loaded", "beginner", 3, 10, "Set the seat to press up and forward. Log plate weight using the same convention each time.", ["Incline DB Press", "Machine Chest Press"]),
  ex("Machine Shoulder Press", "verticalPush", "selectorized", "beginner", 3, 10, "Set the handles around shoulder height and press through a comfortable arc.", ["Seated DB Press", "Landmine Press"]),
  ex("Plate-Loaded High Row", "horizontalPull", "plate_loaded", "beginner", 3, 10, "Set the chest pad, then draw the handles toward your ribs without lifting off the pad.", ["Cable Row", "Chest-Supported Row"]),
  ex("Belt Squat", "squat", "plate_loaded", "intermediate", 3, 10, "Center the belt over the loading point and use the handles for balance.", ["Hack Squat", "Leg Press"]),
  ex("Machine Hip Thrust", "hinge", "plate_loaded", "beginner", 3, 10, "Position the pad across the hips. Extend until the torso and thighs line up.", ["Barbell Hip Thrust", "Glute Bridge"]),
  ex("Machine Lateral Raise", "lateralDelts", "selectorized", "beginner", 3, 12, "Adjust the pads against the upper arms. Raise both elbows evenly.", ["Lateral Raise", "Cable Lateral Raise"]),
  ex("Assisted Dip", "triceps", "selectorized", "beginner", 3, 8, "Use the assistance pad to control the descent. Record the counterweight for each set.", ["Parallel Bar Dip", "Triceps Pushdown"]),
  ex("Machine Preacher Curl", "biceps", "selectorized", "beginner", 3, 12, "Keep the upper arms supported and aligned with the machine’s pivot.", ["Dumbbell Curl", "Cable Curl"]),
  ex("Single-Arm Lat Pulldown", "verticalPull", "cable", "beginner", 3, 10, "Brace the torso and draw one elbow toward the hip. Repeat with the other arm.", ["Lat Pulldown", "Assisted Pull-Up"]),
  ex("Overhead Cable Triceps Extension", "triceps", "cable", "intermediate", 3, 12, "Use a rope and face away from the pulley. Keep the upper arms steady.", ["Overhead Triceps Extension", "Triceps Pushdown"]),

  // Bodyweight regressions, progressions and unilateral work
  ex("Incline Push-Up", "horizontalPush", "bodyweight", "beginner", 3, 10, "Use a fixed rail or bench. Lower the support height as the sets get easier.", ["Push-Up", "Machine Chest Press"]),
  ex("Decline Push-Up", "horizontalPush", "bodyweight", "intermediate", 3, 8, "Elevate the feet on a stable platform and maintain a straight trunk.", ["Push-Up", "Pike Push-Up"]),
  ex("Chin-Up", "verticalPull", "bodyweight", "intermediate", 3, 6, "Use a fixed bar and a comfortable underhand grip. Lower with control.", ["Pull-Up", "Assisted Pull-Up"]),
  ex("Scapular Pull-Up", "verticalPull", "bodyweight", "beginner", 2, 8, "Hang from a bar with straight elbows. Draw the shoulders down and release slowly.", ["Inverted Row", "Chin-Up"]),
  ex("Parallel Bar Dip", "horizontalPush", "bodyweight", "intermediate", 3, 6, "Support yourself on fixed bars. Lower to a repeatable comfortable depth and press back up.", ["Assisted Dip", "Push-Up"]),
  ex("Bodyweight Split Squat", "singleLeg", "bodyweight", "beginner", 3, 10, "Stagger the feet and lower the rear knee. Use a rail for balance and match reps per leg.", ["Reverse Lunge", "Bodyweight Squat"]),
  ex("Sliding Leg Curl", "hamstringIso", "bodyweight", "intermediate", 3, 8, "Lie on your back with heels on sliders. Bridge the hips and bend the knees to pull the heels in.", ["Glute Bridge", "Seated Leg Curl"]),
  ex("Nordic Hamstring Curl", "hamstringIso", "bodyweight", "advanced", 2, 5, "Secure the ankles on a Nordic bench. Lower through the range you control and use your hands on the return.", ["Sliding Leg Curl", "Lying Leg Curl"]),
  ex("Single-Leg Calf Raise", "calves", "bodyweight", "beginner", 3, 12, "Balance with a fingertip support. Pause at the top and lower under control on each side.", ["Bodyweight Calf Raise", "DB Calf Raise"]),
  ex("Hollow Body Hold", "core", "bodyweight", "intermediate", 3, 20, "Keep the lower back in contact with the floor. Shorten the lever by bending the knees.", ["Dead Bug", "Plank"]),
  ex("Side Plank", "core", "bodyweight", "beginner", 3, 25, "Stack the elbow below the shoulder and hold the hips level. Match seconds per side.", ["Plank", "Dead Bug"]),

];

const exercisesByName = new Map(EXERCISES.map(exercise => [exercise.name.toLowerCase(), exercise]));

// Resolve a catalog name to the fields the program editor and set logger use.
export function findLibraryExercise(name) {
  const key = String(name || "").trim().toLowerCase();
  return exercisesByName.get(key) || null;
}

export function exercisePrescription(name) {
  const exercise = findLibraryExercise(name);
  if (!exercise) return null;
  const mode = resolveTrackingMode(exercise);
  const trackingMode = exercise.trackingMode ||
    (exercise.equipment === "bodyweight" && mode === TRACKING_MODES.LOADED_REPS ? TRACKING_MODES.BODYWEIGHT_REPS : undefined);
  return { name: exercise.name, sets: exercise.defaultSets, reps: exercise.defaultReps, notes: exercise.notes,
    ...(trackingMode && { trackingMode }) };
}

// Cardio catalog
// intensity buckets drive the builder's recovery-spacing rules.
export const CARDIO_INTENSITY = ["recovery", "easy", "moderate", "hard"];

export const CARDIO_SESSIONS = {
  easy_run:     { type: "Easy Run",       intensity: "easy",     equipment: "run",       defaultMiles: 4,   effort: "Zone 2",     notes: "Conversational pace throughout — you can speak in full sentences. Aerobic base." },
  zone2_run:    { type: "Zone 2 Run",     intensity: "easy",     equipment: "run",       defaultMiles: 5,   effort: "Zone 2",     notes: "Steady aerobic effort, nose-breathing pace. The bulk of endurance progress lives here." },
  long_run:     { type: "Long Run",       intensity: "moderate", equipment: "run",       defaultMiles: 8,   effort: "Zone 2",     notes: "Easy, conversational — your weekly mileage anchor. Add ~0.5mi per week, finish with mobility." },
  tempo_run:    { type: "Tempo Run",      intensity: "hard",     equipment: "run",       defaultMiles: 5,   effort: "Threshold",  notes: "Comfortably hard: 1mi easy warm-up, sustained tempo in the middle, 1mi cool-down." },
  intervals:    { type: "Intervals",      intensity: "hard",     equipment: "run",       defaultMiles: 5,   effort: "High",       notes: "Warm up, then 4–6 hard efforts (e.g. 4×3–4 min) with easy jog recovery. Cool down." },
  hill_repeats: { type: "Hill Repeats",   intensity: "hard",     equipment: "run",       defaultMiles: 4,   effort: "High",       notes: "Warm up, then 6–8 uphill efforts of ~45–60s, jog down to recover. Strength + speed." },
  recovery_walk:{ type: "Recovery Walk",  intensity: "recovery", equipment: "walk",      defaultMiles: 2,   effort: "Very Light", notes: "Optional easy movement to promote blood flow. Keep it genuinely easy." },
  incline_walk: { type: "Incline Walk",   intensity: "easy",     equipment: "treadmill", defaultMiles: 2.5, effort: "Light",      notes: "Treadmill at a brisk incline. Low-impact aerobic work, easy on the joints." },
  bike_zone2:   { type: "Bike Zone 2",    intensity: "easy",     equipment: "bike",      defaultMiles: 0, defaultMinutes: 30,   effort: "Zone 2",     notes: "Low-impact aerobic cross-training, ~30–45 min steady. Great when legs are beat up." },
  row_intervals:{ type: "Row Erg Intervals", intensity: "hard",  equipment: "rower",     defaultMiles: 0, defaultMinutes: 25, effort: "High", notes: "Five minutes easy, 4 × 2 minutes brisk with 2 minutes easy between efforts, then six minutes easy." },
  steady_row: { type: "Steady Row", intensity: "easy", equipment: "rower", defaultMiles: 0, defaultMinutes: 25, effort: "Conversational", notes: "Choose a stroke rate that lets you speak in full sentences. Ease in and out over the first and last few minutes." },
  elliptical: { type: "Elliptical", intensity: "easy", equipment: "elliptical", defaultMiles: 0, defaultMinutes: 30, effort: "Conversational", notes: "Adjust resistance and stride rate until breathing is steady. Keep the same settings to compare sessions." },
  stair_climb: { type: "Stair Climber", intensity: "moderate", equipment: "stairs", defaultMiles: 0, defaultMinutes: 20, effort: "Steady", notes: "Choose a sustainable step rate and use the rails lightly for balance." },
  ski_erg: { type: "Ski Erg", intensity: "easy", equipment: "ski", defaultMiles: 0, defaultMinutes: 20, effort: "Conversational", notes: "Drive the handles smoothly with the trunk and arms. Keep the easy opening and closing minutes in the target time." },
  bike_intervals: { type: "Bike Intervals", intensity: "hard", equipment: "bike", defaultMiles: 0, defaultMinutes: 30, effort: "Hard repetitions", notes: "Five minutes easy, 5 × 2 minutes hard with 2 minutes light spinning between efforts, then seven minutes easy." },
};

export const CARDIO_KEYS = Object.keys(CARDIO_SESSIONS);

const INTERVAL_BLOCKS = {
  bike_intervals: { warmup: 5, rounds: 5, work: 2, rest: 2, cooldown: 7 },
  row_intervals: { warmup: 5, rounds: 4, work: 2, rest: 2, cooldown: 6 },
};

// Build a program-shaped cardio object from a session key, allowing overrides
// (miles, effort, notes) for experience scaling and week-to-week variation.
export function buildCardio(key, overrides = {}) {
  const base = CARDIO_SESSIONS[key] || CARDIO_SESSIONS.easy_run;
  const miles = overrides.miles != null ? overrides.miles : base.defaultMiles;
  const minutes = Number(overrides.minutes ?? base.defaultMinutes);
  const block = INTERVAL_BLOCKS[key];
  let steps;
  if (block && !overrides.notes && minutes === base.defaultMinutes) {
    steps = [
      { kind: "warmup", minutes: block.warmup, intensity: "easy" },
      { kind: "repeat", reps: block.rounds, work: { minutes: block.work, intensity: "interval" }, recovery: { minutes: block.rest, intensity: "easy" } },
      { kind: "cooldown", minutes: block.cooldown, intensity: "easy" },
    ];
  }
  return {
    type: overrides.type || base.type,
    modality: ({ treadmill: "walk", rower: "row" })[base.equipment] || base.equipment,
    ...(Number.isFinite(minutes) && minutes > 0 && { minutes }),
    ...(steps && { steps }),
    miles: Number.isFinite(Number(miles)) ? Number(miles) : base.defaultMiles,
    effort: overrides.effort || base.effort,
    notes: overrides.notes || base.notes,
  };
}

export function cardioIntensity(key) {
  return CARDIO_SESSIONS[key]?.intensity || "easy";
}

// Structured view (patterns grouped by equipment mode)
// Kept for tests / callers that want to verify pattern coverage per mode.
export const EXERCISE_LIBRARY = EQUIPMENT_MODES.reduce((acc, mode) => {
  const allowed = EQUIPMENT_ALLOW[mode];
  const byPattern = {};
  for (const pattern of MOVEMENT_PATTERNS) byPattern[pattern] = [];
  for (const e of EXERCISES) {
    if (allowed.includes(e.equipment)) byPattern[e.pattern].push(e);
  }
  acc[mode] = byPattern;
  return acc;
}, {});

// Deterministic selection
// Returns `n` exercises for a movement pattern, filtered to the equipment mode
// and biased toward the experience level. A `seed` rotates the starting point
// so week-to-week variants pull different (but stable) movements. Falls back
// gracefully when a pattern has no match for the requested equipment.
export function selectExercises(pattern, equipmentMode, level = "intermediate", n = 1, seed = 0) {
  const allowed = EQUIPMENT_ALLOW[equipmentMode] || EQUIPMENT_ALLOW.full_gym;
  let pool = EXERCISES.filter((e) => e.pattern === pattern && allowed.includes(e.equipment));
  // Bodyweight is allowed in every mode, so it is the only safe fallback — never
  // return equipment the athlete said they don't have.
  if (pool.length === 0) pool = EXERCISES.filter((e) => e.pattern === pattern && allowed.includes("bodyweight") && e.equipment === "bodyweight");
  if (pool.length === 0) return [];

  const levelRank = DIFFICULTY_RANK[level] || 2;
  let filtered = pool.filter((e) => (DIFFICULTY_RANK[e.difficulty] || 2) <= levelRank);
  if (filtered.length < n) filtered = pool; // not enough at-or-below level — open it up

  const len = filtered.length;
  const start = ((seed % len) + len) % len;
  const out = [];
  for (let i = 0; i < n; i++) out.push(filtered[(start + i) % len]);
  return out;
}
