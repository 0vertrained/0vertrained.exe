// Prescriptions intentionally use explicit tracking modes. A bodyweight set
// can be saved with zero added load, and a side plank is logged in seconds.
const BODYWEIGHT = "bodyweight_reps";
const HOLD = "timed_hold";

function lift(name, sets, repMin, reps, restSeconds, notes) {
  return { name, sets, repMin, reps, rir: 2, restSeconds, progressionExposures: 2, notes };
}

function bodyweight(name, sets, repMin, reps, restSeconds, notes) {
  return { ...lift(name, sets, repMin, reps, restSeconds, notes), trackingMode: BODYWEIGHT, progressionMode: "leverage" };
}

function sidePlank() {
  return {
    name: "Side Plank", sets: 2, repMin: 20, reps: 40, restSeconds: 60, trackingMode: HOLD,
    progressionMode: "leverage", progressionExposures: 2,
    notes: "Seconds per side. Start with knees bent, then use straight legs. Keep hips in line and finish while you could still hold good position for a few seconds.",
  };
}

function rest() {
  return { type: "Rest", code: "REST", lifting: [], cardio: null };
}

function strengthDay(type, code, lifting) {
  return { type, code, lifting, cardio: null };
}

function cardioDay(type, code, modality, minutes, effort, notes, steps) {
  return {
    type, code, lifting: [],
    cardio: { type, modality, minutes, miles: 0, effort, notes, steps },
  };
}

function steady(type, modality, minutes, notes) {
  return cardioDay(type, "STEADY", modality, minutes, "Conversational · RPE 3–4/10", notes,
    [{ kind: "steady", minutes, intensity: "easy" }]);
}

function intervals(type, modality, reps, work, recovery, warmup, cooldown, notes) {
  const minutes = warmup + reps * work + (reps - 1) * recovery + cooldown;
  return cardioDay(type, "INTERVALS", modality, minutes, "Hard and repeatable · RPE 7–8/10", notes, [
    { kind: "warmup", minutes: warmup, intensity: "easy" },
    { kind: "repeat", reps, work: { minutes: work, intensity: "interval" }, recovery: { minutes: recovery, intensity: "easy" } },
    { kind: "cooldown", minutes: cooldown, intensity: "easy" },
  ]);
}

const pushUp = () => bodyweight("Push-Up", 3, 8, 15, 120,
  "Lower your chest to the same depth each rep. Use a stable hand incline to start, then the floor, then a low foot elevation.");
const legCurl = () => bodyweight("Sliding Leg Curl", 2, 6, 12, 90,
  "Lie on your back with heels on sliders or towels. Keep hips lifted as you draw the heels in. Start with a short slide and gradually straighten the knees further.");

export const MIXED_PLANS = {
  bodyweightStrength: {
    id: "bodyweightStrength",
    name: "Bodyweight Progressions",
    desc: "Three full-body calisthenics sessions use leverage, range of motion and progressively less assistance to build strength without external weights.",
    tags: ["Calisthenics", "3 days", "Full body"],
    guide: {
      audience: "For athletes who want to build strength with their own bodyweight. The starting variation should leave about two clean repetitions in reserve.",
      equipment: "Floor space, a secure high bar, a fixed low bar or anchored rings, a stable step and heel sliders or towels on a smooth floor.",
      progression: "Keep the same variation and support height until all sets reach the upper target on two consecutive visits with good form. Then move one step along the variation in the exercise notes and return to the lower target. Log the variation so comparisons stay meaningful.",
      recovery: "Rest a day between sessions. If you are new to these movements, use two sets per exercise for the first two weeks. If you miss the low target, increase assistance or choose an easier leverage.",
      sources: [
        { label: "Kikuchi & Nakazato · Push-up and bench-press training", url: "https://doi.org/10.1016/j.jesf.2017.06.003" },
        { label: "Kotarsky et al. · Progressive push-up variations", url: "https://pubmed.ncbi.nlm.nih.gov/29466268/" },
        { label: "Wei et al. · Progressive bodyweight squats", url: "https://doi.org/10.1038/s41598-023-40319-x" },
      ],
    },
    program: {
      Monday: strengthDay("Full body A · Push and pull", "BW A", [
        pushUp(),
        bodyweight("Pull-Up", 3, 4, 8, 150, "Use toes on a stable step for assistance. Pull from straight arms to chin over bar. Gradually lighten foot pressure, then use full bodyweight."),
        bodyweight("Bodyweight Split Squat", 3, 8, 15, 120, "Reps per leg. Start with light hand support, then train unsupported. Keep both feet planted and increase the front leg’s range as control improves."),
        legCurl(),
        sidePlank(),
      ]),
      Tuesday: rest(),
      Wednesday: strengthDay("Full body B · Row and squat", "BW B", [
        bodyweight("Inverted Row", 3, 8, 15, 120, "At a securely fixed bar, pull your chest up while keeping your trunk straight. Begin nearly upright, then move your feet forward to make the row more horizontal."),
        bodyweight("Pike Push-Up", 2, 6, 10, 120, "Keep hips high. Start with hands on a stable low bench, progress to hands on the floor, then elevate the feet."),
        bodyweight("Bodyweight Squat", 3, 8, 15, 120, "Start with a controlled two-leg squat to a box. Progress to free squats, then supported single-leg squats to a box. Work each side on the single-leg variation."),
        bodyweight("Single-Leg Glute Bridge", 3, 8, 15, 90, "Reps per side. Keep the pelvis level. Start with a two-leg bridge, then use a staggered stance and finally lift the unused foot."),
        bodyweight("Single-Leg Calf Raise", 2, 10, 20, 60, "Reps per side. Hold a support, pause at heel rise, then lower fully. Progress from two feet to one and then to a secure step for more range."),
      ]),
      Thursday: rest(),
      Friday: strengthDay("Full body C · Chin and lunge", "BW C", [
        bodyweight("Chin-Up", 3, 4, 8, 150, "Use a comfortable underhand grip. Use toes on a stable step as needed. Reduce assistance until you can complete the range from straight arms."),
        pushUp(),
        bodyweight("Reverse Lunge", 3, 8, 15, 120, "Reps per leg. Step back to a repeatable depth. Progress from hand support to unsupported reps, then use a low platform under the front foot."),
        legCurl(),
        sidePlank(),
      ]),
      Saturday: rest(),
      Sunday: rest(),
    },
  },
  cardioBase: {
    id: "cardioBase",
    name: "Cardio Base",
    desc: "Four aerobic sessions and zero lifting days. Three conversational sessions build volume, with one controlled interval session for aerobic power.",
    tags: ["Cardio only", "4 days", "Time based"],
    guide: {
      audience: "For an athlete comfortable with regular aerobic exercise who wants to build toward 150 minutes of movement per week. The week includes 16 minutes of hard efforts.",
      equipment: "Treadmill, stationary bike and elliptical. Swap a steady session for brisk outdoor walking, cycling or rowing at the same duration and conversational effort.",
      progression: "If the full week exceeds your recent training, start with three 20–30 minute conversational sessions. Extend one session by five minutes after a comfortable week. Once you can repeat the easy schedule, introduce two hard intervals and build toward four.",
      recovery: "Start each steady session gently. Match effort to breathing so that easy days allow full sentences. If the next hard interval would require a sprint to hold pace, finish with an easy cool-down and repeat that dose next week.",
      sources: [
        { label: "Church et al. · Aerobic dose and fitness", url: "https://doi.org/10.1001/jama.297.19.2081" },
        { label: "Helgerud et al. · Four-minute treadmill intervals", url: "https://doi.org/10.1111/sms.14470" },
        { label: "Muñoz et al. · Intensity distribution in recreational runners", url: "https://pubmed.ncbi.nlm.nih.gov/23752040/" },
      ],
    },
    program: {
      Monday: steady("Brisk incline walk", "walk", 30, "Walk for 30 minutes. Increase the incline only enough to breathe more deeply while speaking in full sentences."),
      Tuesday: rest(),
      Wednesday: intervals("Treadmill intervals", "run", 4, 4, 3, 10, 5, "Warm up 10 minutes. Run four 4-minute efforts with 3 minutes of easy movement between efforts. Keep the last as repeatable as the first, then cool down for 5 minutes."),
      Thursday: rest(),
      Friday: steady("Easy stationary ride", "bike", 30, "Ride for 30 minutes. Find a cadence you can sustain comfortably, then adjust resistance to stay conversational."),
      Saturday: rest(),
      Sunday: steady("Long steady elliptical", "elliptical", 50, "Set a 50-minute target. Move smoothly with relaxed shoulders. Start at your usual long-session duration and build toward the target over several weeks."),
    },
  },
  balancedHybrid: {
    id: "balancedHybrid",
    name: "Hybrid Foundations",
    desc: "Two full-body lifting sessions, an easy ride and a run interval day build strength and aerobic fitness on four training days.",
    tags: ["Hybrid", "2 lifts + 2 cardio", "4 days"],
    guide: {
      audience: "For athletes comfortable with the main lifts and easy aerobic training who want to improve both on four weekly visits.",
      equipment: "Barbell, rack and bench, trap bar, dumbbells, cable station, stationary bike and a treadmill or outdoor running route.",
      progression: "Add reps inside the lifting range while keeping about two in reserve. When every set reaches the ceiling on two consecutive visits with good form, add the smallest practical weight and restart near the lower end. For bodyweight or holds, increase the reach or lever instead. For cardio, add five minutes to the easy ride first. Advance one training demand at a time.",
      recovery: "Keep Tuesday conversational after Monday’s squats. Thursday’s hinge and Saturday’s harder run have a day between them. If lifting reps or interval pace fall on two comparable sessions, replace Saturday with easy cardio for a week and reassess.",
      sources: [
        { label: "Conceição et al. · Strength and aerobic gains with concurrent training", url: "https://doi.org/10.1152/japplphysiol.00642.2025" },
        { label: "Robineau et al. · Recovery between strength and aerobic sessions", url: "https://pubmed.ncbi.nlm.nih.gov/25546450/" },
        { label: "Helgerud et al. · Aerobic interval training", url: "https://doi.org/10.1111/sms.14470" },
      ],
    },
    program: {
      Monday: strengthDay("Full body A · Squat and press", "HYB A", [
        lift("Back Squat", 3, 5, 8, 180, "Brace before descending. Use a repeatable depth and finish each set with two good reps in reserve."),
        lift("Barbell Bench Press", 3, 5, 8, 180, "Keep feet planted and touch the same point on the chest each rep. Add load after reaching the top of the range."),
        lift("Cable Row", 3, 8, 12, 120, "Keep the trunk steady as you pull the handle toward the lower ribs. Let the shoulders reach forward on the return."),
        lift("Romanian Deadlift", 2, 8, 10, 150, "Keep the bar close. End the descent where you can still hold a consistent trunk position."),
        bodyweight("Dead Bug", 2, 8, 12, 60, "Reps per side. Exhale as the opposite arm and leg reach away. Shorten the reach if your lower back arches."),
      ]),
      Tuesday: steady("Easy stationary ride", "bike", 30, "Ride easily for 30 minutes. Choose a resistance that allows full sentences even if your legs feel tired from squats."),
      Wednesday: rest(),
      Thursday: strengthDay("Full body B · Hinge and pull", "HYB B", [
        lift("Trap Bar Deadlift", 3, 4, 6, 180, "Brace before each rep and stand up smoothly. Reset fully on the floor between reps."),
        lift("Incline DB Press", 3, 8, 12, 120, "Use a low incline, keep feet planted, and lower the bells under control through a repeatable range."),
        lift("Lat Pulldown", 3, 8, 12, 120, "Let the arms straighten at the top and drive elbows toward the ribs without leaning far back."),
        lift("Walking Lunge", 2, 8, 12, 120, "Reps per leg with dumbbells at your sides. Control the knee and keep stride length consistent."),
        sidePlank(),
      ]),
      Friday: rest(),
      Saturday: intervals("Run intervals", "run", 3, 4, 3, 10, 5, "Warm up 10 minutes, then run three 4-minute efforts with a 3-minute easy jog or walk between efforts. Use an even, repeatable pace. Cool down for 5 minutes."),
      Sunday: rest(),
    },
  },
};
