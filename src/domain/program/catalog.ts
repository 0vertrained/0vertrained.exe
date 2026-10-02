// The exercise catalog: every movement a preset, the generator or a
// substitution can name, with the metadata training rules need to log it.
//
// Ported from src/programExerciseLibrary.js (EXERCISES) @ c955d5a.
// Deliberate changes:
//   - Stable kebab-case ids; logs and plans reference ids, not names.
//   - Explicit trackingMode / isBarbell / largeIncrement / bwFactor per entry
//     instead of v19's name regexes. isBarbell means a straight bar loaded
//     with plates on both ends (trap bar, EZ bar, Smith and T-bar are not).
//   - Walking Lunge and Step-Up are bodyweight moves (dumbbells are added
//     load), so bodyweight plans can use them.
//   - The free-text `alternatives` moved to substitutions.ts as ids.
//   - 35 entries added so every movement in the default program and the
//     presets resolves (pendulum squat, dips, chin-ups, machine presses, the
//     calisthenics holds, …). `specialty` marks technique-heavy or niche
//     variants the generator and substitutions never pick.
//   - Weighted variants log the added load as loaded_reps and carry the
//     bwFactor of the bodyweight move they load.

import type { TrackingMode } from "../day/schema";
import type { Difficulty, Equipment, ExerciseMeta, MovementPattern } from "../exercise";

export interface LibraryExercise extends ExerciseMeta {
  id: string;
  name: string;
  pattern: MovementPattern;
  equipment: Equipment;
  difficulty: Difficulty;
  defaultSets: number;
  /** Target reps; seconds for timed holds, metres for carries. */
  defaultReps: string;
  notes: string;
  /** Valid in plans and history, but never generated or offered as a swap. */
  specialty?: boolean;
}

type Extra = Pick<LibraryExercise, "isBarbell" | "largeIncrement" | "bwFactor" | "specialty">;

const BAR: Extra = { isBarbell: true };
const BAR_HEAVY: Extra = { isBarbell: true, largeIncrement: true };
const HEAVY: Extra = { isBarbell: false, largeIncrement: true };
const NONE: Extra = { isBarbell: false };
const bw = (bwFactor: number): Extra => ({ isBarbell: false, bwFactor });
const special = (extra: Extra): Extra => ({ ...extra, specialty: true });

const L: TrackingMode = "loaded_reps";
const BW: TrackingMode = "bodyweight_reps";

function ex(
  id: string, name: string, pattern: MovementPattern, equipment: Equipment, difficulty: Difficulty,
  trackingMode: TrackingMode, defaultSets: number, defaultReps: number, notes: string, extra: Extra,
): LibraryExercise {
  return { id, name, pattern, equipment, difficulty, trackingMode, defaultSets, defaultReps: String(defaultReps), notes, ...extra };
}

export const LIBRARY: readonly LibraryExercise[] = Object.freeze([
  // ── Squat ──
  ex("back-squat", "Back Squat", "squat", "barbell", "intermediate", L, 4, 6, "Brace hard, sit between the hips, hit at least parallel. Controlled descent, drive the floor away.", BAR_HEAVY),
  ex("front-squat", "Front Squat", "squat", "barbell", "advanced", L, 4, 6, "Elbows high, upright torso. More quad and upper-back demand than the back squat.", BAR_HEAVY),
  ex("goblet-squat", "Goblet Squat", "squat", "dumbbell", "beginner", L, 3, 10, "Hold one dumbbell at the chest. Elbows track inside the knees, chest tall. Great for learning depth.", NONE),
  ex("leg-press", "Leg Press", "squat", "machine", "beginner", L, 3, 12, "Shoulder-width feet, full but safe range, no lower-back rounding at the bottom.", HEAVY),
  ex("hack-squat", "Hack Squat", "squat", "machine", "intermediate", L, 3, 10, "Quad-biased squat with back support. Push through mid-foot, full depth.", HEAVY),
  ex("pendulum-squat", "Pendulum Squat", "squat", "machine", "intermediate", L, 3, 12, "Narrow stance, knees travel out over the toes. Back-supported, so go deeper than a free squat. Pure quad work.", HEAVY),
  ex("bodyweight-squat", "Bodyweight Squat", "squat", "bodyweight", "beginner", BW, 3, 15, "Feet shoulder-width, sit back and down, chest up. Slow tempo makes it harder.", bw(0.6)),

  // ── Hinge ──
  ex("conventional-deadlift", "Conventional Deadlift", "hinge", "barbell", "intermediate", L, 4, 5, "Bar over mid-foot, lats tight, push the floor away. Take warm-up sets seriously.", BAR_HEAVY),
  ex("trap-bar-deadlift", "Trap Bar Deadlift", "hinge", "barbell", "beginner", L, 4, 6, "More forgiving than conventional — neutral grip, tall chest. A safe strength anchor.", HEAVY),
  ex("romanian-deadlift", "Romanian Deadlift", "hinge", "barbell", "intermediate", L, 3, 8, "Push the hips back, soft knees, feel the hamstring stretch — not the low back.", BAR_HEAVY),
  ex("db-romanian-deadlift", "DB Romanian Deadlift", "hinge", "dumbbell", "beginner", L, 3, 10, "Dumbbells against the legs, hinge back, flat back throughout. Control the stretch.", NONE),
  ex("barbell-hip-thrust", "Barbell Hip Thrust", "hinge", "barbell", "intermediate", L, 3, 10, "Upper back on a bench, drive through heels, full lockout with a 1s glute squeeze.", BAR_HEAVY),
  ex("glute-bridge", "Glute Bridge", "hinge", "bodyweight", "beginner", BW, 3, 15, "Feet flat, drive hips up, squeeze glutes at the top. Add a pause to progress.", bw(0.5)),
  ex("bodyweight-good-morning", "Bodyweight Good Morning", "hinge", "bodyweight", "beginner", BW, 3, 12, "Hands behind the head, soft knees, push the hips back until the hamstrings stretch. Flat back throughout.", bw(0.5)),
  ex("back-extension", "Back Extension", "hinge", "machine", "beginner", BW, 3, 12, "Hips on the pad, hinge down with a flat back, drive up to a straight line. Hold a plate to progress.", bw(0.5)),
  ex("deficit-deadlift", "Deficit Deadlift", "hinge", "barbell", "advanced", L, 3, 5, "Stand on a 2–5 cm plate, same setup as the conventional pull. Builds speed off the floor; expect lighter loads.", special(BAR_HEAVY)),
  ex("rack-pull", "Rack Pull", "hinge", "barbell", "advanced", L, 3, 5, "Bar on the pins just below the knee. Lockout strength; heavier than the full pull, so cap the ego.", special(BAR_HEAVY)),
  ex("power-clean", "Power Clean", "hinge", "barbell", "advanced", L, 3, 3, "Explosive pull from the floor, fast elbows, catch in a quarter squat. Speed and technique, never a grind.", special(BAR)),

  // ── Single-leg ──
  ex("bulgarian-split-squat", "Bulgarian Split Squat", "singleLeg", "dumbbell", "intermediate", L, 3, 10, "Rear foot elevated, most weight through the front leg. Upright torso, controlled.", NONE),
  ex("walking-lunge", "Walking Lunge", "singleLeg", "bodyweight", "beginner", BW, 3, 12, "Long strides, back knee toward the floor. Keep the torso tall. Per-leg reps.", bw(0.6)),
  ex("step-up", "Step-Up", "singleLeg", "bodyweight", "beginner", BW, 3, 10, "Sturdy box, drive through the lead heel, minimal push from the trailing foot.", bw(0.6)),
  ex("reverse-lunge", "Reverse Lunge", "singleLeg", "bodyweight", "beginner", BW, 3, 10, "Step back and down — easier on the knees than forward lunges. Per-leg reps.", bw(0.6)),

  // ── Horizontal push ──
  ex("barbell-bench-press", "Barbell Bench Press", "horizontalPush", "barbell", "intermediate", L, 4, 6, "Scapulae retracted, controlled descent to the chest, drive up. Anchor pressing lift.", BAR),
  ex("dumbbell-bench-press", "Dumbbell Bench Press", "horizontalPush", "dumbbell", "beginner", L, 3, 10, "Deeper stretch than the barbell. Lower under control, press without clashing the bells.", NONE),
  ex("incline-db-press", "Incline DB Press", "horizontalPush", "dumbbell", "intermediate", L, 3, 10, "30–45° incline for the upper chest. Deep stretch, don't touch the bells at the top.", NONE),
  ex("machine-chest-press", "Machine Chest Press", "horizontalPush", "machine", "beginner", L, 3, 10, "Handles at mid-chest height. Controlled eccentric, press without slamming the lockout.", NONE),
  ex("incline-machine-press", "Incline Machine Press", "horizontalPush", "machine", "beginner", L, 3, 10, "Upper-chest bias on a fixed path. Deep stretch, smooth press, no bouncing.", NONE),
  ex("close-grip-bench-press", "Close-Grip Bench Press", "horizontalPush", "barbell", "intermediate", L, 3, 6, "Hands just inside shoulder width, elbows tucked, touch low on the chest. Triceps-biased bench.", BAR),
  ex("incline-smith-press", "Incline Smith Press", "horizontalPush", "machine", "intermediate", L, 3, 8, "Bench at 30°, bar to the upper chest. The fixed path lets you push close to failure safely.", NONE),
  ex("push-up", "Push-Up", "horizontalPush", "bodyweight", "beginner", BW, 3, 12, "Rigid plank, elbows ~45°, chest to the floor. Elevate the hands to regress.", bw(0.64)),
  ex("incline-push-up", "Incline Push-Up", "horizontalPush", "bodyweight", "beginner", BW, 3, 10, "Hands on a bench or counter — easier than the floor. Lower the surface as you get stronger.", bw(0.45)),
  ex("dip", "Dip", "horizontalPush", "bodyweight", "intermediate", BW, 3, 10, "Parallel bars, slight forward lean, lower until the upper arm is level, press to lockout.", bw(0.9)),
  ex("weighted-push-up", "Weighted Push-Up", "horizontalPush", "bodyweight", "advanced", L, 3, 10, "Plate on the upper back or a band for load. Full range, controlled tempo.", bw(0.64)),
  ex("weighted-dip", "Weighted Dip", "horizontalPush", "bodyweight", "advanced", L, 3, 8, "Belt or a dumbbell between the feet. Add load only when every rep is clean and full depth.", bw(0.9)),

  // ── Vertical push ──
  ex("overhead-press", "Overhead Press", "verticalPush", "barbell", "intermediate", L, 4, 6, "Standing, brace the trunk, press to a full overhead lockout. Bar path close to the face.", BAR),
  ex("seated-db-press", "Seated DB Press", "verticalPush", "dumbbell", "beginner", L, 3, 10, "Stop just outside the head at the bottom, full lockout up. Don't lean back.", NONE),
  ex("machine-shoulder-press", "Machine Shoulder Press", "verticalPush", "machine", "beginner", L, 3, 10, "Handles at shoulder height, press to lockout without shrugging. The safest press to take near failure.", NONE),
  ex("pike-push-up", "Pike Push-Up", "verticalPush", "bodyweight", "intermediate", BW, 3, 10, "Hips high, press the head toward the floor. Elevate the feet to progress.", bw(0.5)),
  ex("push-press", "Push Press", "verticalPush", "barbell", "advanced", L, 3, 4, "Dip and drive with the legs, then press to lockout. Explosive; heavier than a strict press.", special(BAR)),

  // ── Horizontal pull ──
  ex("barbell-row", "Barbell Row", "horizontalPull", "barbell", "intermediate", L, 4, 8, "Hinge to ~45°, pull to the lower chest, lead with the elbows. Flat back.", BAR),
  ex("chest-supported-row", "Chest-Supported Row", "horizontalPull", "machine", "beginner", L, 3, 10, "Chest on the pad removes the low back. Squeeze the shoulder blades at the top.", NONE),
  ex("one-arm-db-row", "One-Arm DB Row", "horizontalPull", "dumbbell", "beginner", L, 3, 10, "Brace on a bench, pull the dumbbell to the hip, big stretch at the bottom.", NONE),
  ex("cable-row", "Cable Row", "horizontalPull", "cable", "beginner", L, 3, 12, "Drive the elbows back, slight forward lean at the start for a lat stretch.", NONE),
  ex("single-arm-cable-row", "Single-Arm Cable Row", "horizontalPull", "cable", "intermediate", L, 3, 12, "One handle, full reach forward for the lat stretch, drive the elbow to the hip. Per-side reps.", NONE),
  ex("t-bar-row", "T-Bar Row", "horizontalPull", "barbell", "intermediate", L, 3, 10, "Chest up, hinge to ~45°, pull the handle to the sternum. Heavy mid-back work.", NONE),
  ex("inverted-row", "Inverted Row", "horizontalPull", "bodyweight", "beginner", BW, 3, 10, "Under a bar or sturdy table, body rigid, pull the chest to the bar. Angle to scale.", bw(0.55)),

  // ── Vertical pull ──
  ex("pull-up", "Pull-Up", "verticalPull", "bodyweight", "advanced", BW, 3, 8, "Full hang to chin over the bar. Add load once clean, or use a band to assist.", bw(1)),
  ex("chin-up", "Chin-Up", "verticalPull", "bodyweight", "intermediate", BW, 3, 8, "Palms facing you, full hang to chin over the bar. More biceps than the pull-up.", bw(1)),
  ex("weighted-pull-up", "Weighted Pull-Up", "verticalPull", "bodyweight", "advanced", L, 4, 6, "Belt or a dumbbell between the feet. Full hang to chin over the bar; add load only after clean reps.", bw(1)),
  ex("lat-pulldown", "Lat Pulldown", "verticalPull", "cable", "beginner", L, 3, 12, "Drive the elbows down and back, chest tall, control the return.", NONE),
  ex("single-arm-lat-pulldown", "Single-Arm Lat Pulldown", "verticalPull", "cable", "intermediate", L, 3, 12, "One handle, drive the elbow down to the ribs, full stretch at the top. Per-side reps.", NONE),
  ex("assisted-pull-up", "Assisted Pull-Up", "verticalPull", "machine", "beginner", "assisted_reps", 3, 10, "Machine or band assistance. Full range, build toward an unassisted rep.", bw(1)),

  // ── Chest isolation ──
  ex("cable-fly", "Cable Fly", "chestIsolation", "cable", "beginner", L, 3, 12, "Slight elbow bend, hug the arms together, 1s squeeze. Think chest, not arms.", NONE),
  ex("pec-deck", "Pec Deck", "chestIsolation", "machine", "beginner", L, 3, 12, "Fixed path isolation. Controlled squeeze, slow return to a stretch.", NONE),
  ex("db-fly", "DB Fly", "chestIsolation", "dumbbell", "intermediate", L, 3, 12, "Soft elbows, wide arc, deep stretch. Light load, long tension.", NONE),

  // ── Back isolation ──
  ex("face-pull", "Face Pull", "backIsolation", "cable", "beginner", L, 3, 20, "Rope to eye level, externally rotate at the end. Rear delts + healthy shoulders.", NONE),
  ex("straight-arm-pulldown", "Straight-Arm Pulldown", "backIsolation", "cable", "beginner", L, 3, 15, "Arms long, drive the bar to the thighs. Lat isolation with constant tension.", NONE),
  ex("shrugs", "Shrugs", "backIsolation", "dumbbell", "beginner", L, 3, 15, "Straight up, pause at the top, no rolling. Traps.", NONE),
  ex("scapular-row", "Scapular Row", "backIsolation", "bodyweight", "beginner", BW, 3, 10, "Arms out in front, pinch the shoulder blades together and pause. A band adds resistance.", NONE),

  // ── Delts ──
  ex("lateral-raise", "Lateral Raise", "lateralDelts", "dumbbell", "beginner", L, 4, 15, "Lead with the elbow, slight forward lean. Control down — no swinging.", NONE),
  ex("cable-lateral-raise", "Cable Lateral Raise", "lateralDelts", "cable", "beginner", L, 3, 15, "Constant tension through the full range. Great for a burnout drop set.", NONE),
  ex("machine-lateral-raise", "Machine Lateral Raise", "lateralDelts", "machine", "beginner", L, 3, 15, "Pads on the outside of the arms, lead with the elbows, constant tension. No swinging.", NONE),
  ex("cable-y-raise", "Cable Y-Raise", "lateralDelts", "cable", "intermediate", L, 3, 15, "Cables crossed, raise up and out in a Y. Light, strict, shoulder blades down.", special(NONE)),
  ex("front-raise", "Front Raise", "lateralDelts", "dumbbell", "beginner", L, 3, 12, "Raise to eye level with a slight elbow bend, control the way down. Presses already train the front delts hard.", special(NONE)),
  ex("rear-delt-fly", "Rear Delt Fly", "rearDelts", "dumbbell", "beginner", L, 3, 15, "Hinge over, arc the dumbbells out and back. Squeeze the rear delts, not the traps.", NONE),
  ex("reverse-pec-deck", "Reverse Pec Deck", "rearDelts", "machine", "beginner", L, 3, 15, "Fixed-path rear delt isolation. Slow squeeze, controlled return.", NONE),

  // ── Biceps ──
  ex("ez-bar-curl", "EZ Bar Curl", "biceps", "barbell", "beginner", L, 3, 10, "Elbows pinned, full range, no swing. The bread-and-butter mass builder.", NONE),
  ex("barbell-curl", "Barbell Curl", "biceps", "barbell", "beginner", L, 3, 10, "Straight bar, shoulder-width grip, elbows pinned. Full range, no hip drive.", BAR),
  ex("dumbbell-curl", "Dumbbell Curl", "biceps", "dumbbell", "beginner", L, 3, 12, "Palms up, elbows still, full range. Alternate arms or curl both together.", NONE),
  ex("incline-db-curl", "Incline DB Curl", "biceps", "dumbbell", "intermediate", L, 3, 12, "Arms behind the torso for a long-head stretch. Slow negatives.", NONE),
  ex("hammer-curl", "Hammer Curl", "biceps", "dumbbell", "beginner", L, 3, 12, "Neutral grip for brachialis and forearms — width, not just peak.", NONE),
  ex("cable-curl", "Cable Curl", "biceps", "cable", "beginner", L, 3, 15, "Constant tension, full range. A clean pump finisher.", NONE),
  ex("preacher-curl", "Preacher Curl", "biceps", "machine", "intermediate", L, 3, 12, "Arms flat on the pad, lower to a full stretch, curl without lifting the elbows.", NONE),

  // ── Triceps ──
  ex("triceps-pushdown", "Triceps Pushdown", "triceps", "cable", "beginner", L, 3, 15, "Elbows pinned to the sides, full lockout, control the return.", NONE),
  ex("skull-crusher", "Skull Crusher", "triceps", "barbell", "intermediate", L, 3, 12, "Lower to the forehead, elbows toward the ceiling — don't let them flare.", NONE),
  ex("overhead-triceps-extension", "Overhead Triceps Extension", "triceps", "dumbbell", "beginner", L, 3, 12, "Long-head stretch behind the head. Elbows in, lower slowly.", NONE),
  ex("bench-dip", "Bench Dip", "triceps", "bodyweight", "beginner", BW, 3, 12, "Hands on a bench, lower under control, press to lockout. Elevate feet to progress.", bw(0.5)),

  // ── Quads / hamstrings ──
  ex("leg-extension", "Leg Extension", "quadIso", "machine", "beginner", L, 3, 15, "Full contraction with a 1s hold at the top, slow negative. Quad isolation.", NONE),
  ex("sissy-squat", "Sissy Squat", "quadIso", "bodyweight", "advanced", BW, 3, 12, "Rise onto the toes, lean back and bend the knees — deep quad isolation. Hold support to scale.", bw(0.6)),
  ex("wall-sit", "Wall Sit", "quadIso", "bodyweight", "beginner", "timed_hold", 3, 30, "Back flat on the wall, thighs parallel to the floor. Breathe and hold.", NONE),
  ex("lying-leg-curl", "Lying Leg Curl", "hamstringIso", "machine", "beginner", L, 3, 12, "Curl all the way, slow negative. Point the toes to bias the hamstrings.", NONE),
  ex("seated-leg-curl", "Seated Leg Curl", "hamstringIso", "machine", "beginner", L, 3, 12, "Deeper hamstring stretch than lying. Controlled tempo, full range.", NONE),
  ex("single-leg-glute-bridge", "Single-Leg Glute Bridge", "hamstringIso", "bodyweight", "intermediate", BW, 3, 12, "One leg planted, drive the hip up, squeeze. Hamstring and glute focus. Per-leg reps.", bw(0.5)),
  ex("glute-ham-raise", "Glute-Ham Raise", "hamstringIso", "machine", "advanced", BW, 3, 8, "Knees behind the pad, lower under control, curl back up with the hamstrings. A band assists.", bw(0.6)),

  // ── Calves ──
  ex("standing-calf-raise", "Standing Calf Raise", "calves", "machine", "beginner", L, 4, 15, "Full stretch at the bottom, full contraction at the top. Gastrocnemius.", HEAVY),
  ex("seated-calf-raise", "Seated Calf Raise", "calves", "machine", "beginner", L, 3, 15, "Knees bent to bias the soleus. Pause 1s at the bottom stretch.", HEAVY),
  ex("db-calf-raise", "DB Calf Raise", "calves", "dumbbell", "beginner", L, 3, 20, "One or two dumbbells, on a step for range. Full stretch and squeeze.", NONE),
  ex("bodyweight-calf-raise", "Bodyweight Calf Raise", "calves", "bodyweight", "beginner", BW, 3, 20, "On a step for full range, one-legged to add load. Slow, full stretch and squeeze.", bw(1)),
  ex("tibialis-raise", "Tibialis Raise", "calves", "bodyweight", "beginner", BW, 2, 15, "Back against a wall, heels out, pull the toes up hard. Shin and knee durability work.", special(NONE)),

  // ── Core ──
  ex("plank", "Plank", "core", "bodyweight", "beginner", "timed_hold", 3, 45, "Hips in line with the shoulders, brace hard. Time under tension (seconds).", NONE),
  ex("dead-bug", "Dead Bug", "core", "bodyweight", "beginner", BW, 3, 10, "Low back pressed to the floor, lower opposite arm/leg slowly. Per-side reps.", NONE),
  ex("pallof-press", "Pallof Press", "core", "cable", "beginner", L, 3, 12, "Anti-rotation — resist the cable pulling you round. Press out and hold.", NONE),
  ex("cable-crunch", "Cable Crunch", "core", "cable", "beginner", L, 3, 15, "Round the spine down toward the knees, crunch with the abs, not the hips.", NONE),
  ex("hanging-leg-raise", "Hanging Leg Raise", "core", "bodyweight", "intermediate", BW, 3, 12, "Full hang, raise legs to parallel or above, no swinging. Control the descent.", NONE),
  ex("crunch", "Crunch", "core", "bodyweight", "beginner", BW, 3, 15, "Low back on the floor, curl the ribs toward the hips, exhale at the top. No pulling on the neck.", NONE),
  ex("shoulder-tap", "Shoulder Tap", "core", "bodyweight", "beginner", BW, 3, 10, "In a push-up position, tap the opposite shoulder without letting the hips sway. Counts each side.", NONE),
  ex("superman-hold", "Superman Hold", "core", "bodyweight", "beginner", "timed_hold", 3, 20, "Face down, lift arms, chest and legs slightly off the floor. Squeeze the glutes and hold.", NONE),
  ex("hollow-body-hold", "Hollow Body Hold", "core", "bodyweight", "beginner", "timed_hold", 3, 20, "Lower back pressed to the floor, arms and legs long and lifted. Bend the knees to scale.", NONE),
  ex("farmer-carry", "Farmer Carry", "core", "dumbbell", "beginner", "carry", 3, 40, "Heavy dumbbells at the sides, tall posture, short quick steps. Brace — don't lean.", NONE),
]);
