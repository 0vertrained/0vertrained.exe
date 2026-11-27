// Numeric reps keep the existing logger and watch targets compatible.
// repMin supplies the lower end for double progression.
function lift(name, sets, repMin, reps, rir, restSeconds, notes) {
  return { name, sets, reps, repMin, rir, restSeconds, notes };
}

function session(type, code, lifting) {
  return { type, code, lifting, cardio: null };
}

function rest() {
  return session("Rest", "REST", []);
}

const progressionStudy = { label: "Plotkin et al. · progressing reps or load", url: "https://pubmed.ncbi.nlm.nih.gov/36199287/" };

export const RESISTANCE_PRESETS = {
  upperLowerGrowth: {
    id: "upperLowerGrowth",
    name: "Upper/Lower Hypertrophy",
    desc: "Build muscle in four upper/lower sessions. Start with ten weekly sets each for chest, back and quads, then adjust one muscle at a time.",
    tags: ["Bodybuilding", "4 days", "Full gym"],
    guide: {
      audience: "Lifters comfortable with working sets who can train four days for about 45–65 minutes.",
      equipment: "Dumbbells, a barbell and bench, cables, leg machines and a calf machine.",
      progression: "Choose a load that reaches the bottom of the range with the listed reserve. Add a rep where you can. Once all sets reach the top with that reserve, use the smallest available weight increase and rebuild from the bottom.",
      recovery: "Keep the starting sets while reps or load improve. If one muscle stalls for several weeks and feels recovered before each session, try one extra set a week for that muscle. If performance falls at two successive sessions and soreness lingers, remove one set from that muscle at each session for a week, then reassess.",
      sources: [
        { label: "Schoenfeld et al. · weekly set volume", url: "https://pubmed.ncbi.nlm.nih.gov/30153194/" },
        { label: "Morton et al. · load and muscle growth", url: "https://pubmed.ncbi.nlm.nih.gov/27174923/" },
        { label: "Refalo et al. · repetitions in reserve", url: "https://doi.org/10.1080/02640414.2024.2321021" },
      ],
    },
    program: {
      Monday: session("Upper A · dumbbell press and row", "UPPER A", [
        lift("Dumbbell Bench Press", 3, 6, 10, 2, 180, "Use the same bench angle each week."),
        lift("Chest-Supported Row", 3, 8, 12, 2, 120, "Keep your chest on the pad as the elbows travel back."),
        lift("Lat Pulldown", 2, 8, 12, 2, 120, "Keep the torso still as the bar approaches the upper chest."),
        lift("Cable Fly", 2, 10, 15, 1, 90, "Bring the handles together with a slight bend in the elbows."),
        lift("Lateral Raise", 2, 12, 20, 1, 90, "Lift from the shoulders while keeping the torso quiet."),
        lift("Cable Curl", 2, 10, 15, 1, 90, "Keep the upper arms still as you curl."),
        lift("Triceps Pushdown", 2, 10, 15, 1, 90, "Keep the elbows close to the torso."),
      ]),
      Tuesday: session("Lower A · leg press and hinge", "LOWER A", [
        lift("Leg Press", 3, 8, 12, 2, 180, "Keep your pelvis against the pad through a repeatable depth."),
        lift("Romanian Deadlift", 3, 6, 10, 2, 180, "Hinge at the hips and keep the bar close."),
        lift("Leg Extension", 2, 10, 15, 1, 90, "Set the seat so the knee lines up with the machine pivot."),
        lift("Seated Leg Curl", 2, 10, 15, 1, 90, "Keep your hips against the pad as you curl."),
        lift("Standing Calf Raise", 3, 10, 15, 1, 90, "Pause at the bottom, then rise without bouncing."),
        lift("Cable Crunch", 2, 10, 15, 2, 90, "Bring the ribs toward the pelvis."),
      ]),
      Wednesday: rest(),
      Thursday: session("Upper B · incline press and pulldown", "UPPER B", [
        lift("Incline DB Press", 3, 6, 10, 2, 180, "Use a low incline and keep the angle consistent."),
        lift("Lat Pulldown", 3, 8, 12, 2, 120, "Use the same grip and bar as on Monday."),
        lift("Cable Row", 2, 8, 12, 2, 120, "Sit tall and finish with the elbows beside your trunk."),
        lift("Pec Deck", 2, 10, 15, 1, 90, "Keep the shoulders against the pad."),
        lift("Cable Lateral Raise", 2, 12, 20, 1, 90, "Complete the listed reps on each side."),
        lift("Hammer Curl", 2, 10, 15, 1, 90, "Keep the palms facing each other and lower under control."),
        lift("Overhead Triceps Extension", 2, 10, 15, 1, 90, "Hold one dumbbell with both hands and keep the elbows steady."),
      ]),
      Friday: session("Lower B · hack squat and hip thrust", "LOWER B", [
        lift("Hack Squat", 3, 8, 12, 2, 180, "Set the stops and use a repeatable depth."),
        lift("Barbell Hip Thrust", 3, 8, 12, 2, 120, "Finish with the hips extended and the ribs down."),
        lift("Bulgarian Split Squat", 2, 8, 12, 2, 120, "Complete both legs before resting. Count one set per side."),
        lift("Seated Leg Curl", 3, 10, 15, 1, 90, "Use the same seat settings as on Tuesday."),
        lift("Standing Calf Raise", 3, 10, 15, 1, 90, "Use the same step height and pause as on Tuesday."),
        lift("Pallof Press", 2, 10, 15, 2, 90, "Stand side-on to the cable. Complete the reps on each side."),
      ]),
      Saturday: rest(),
      Sunday: rest(),
    },
  },
  barbellStrength: {
    id: "barbellStrength",
    name: "Barbell Strength",
    desc: "Practice the squat and bench twice a week and the deadlift once. Three full-body sessions give the priority lifts the first slots.",
    tags: ["Strength", "3 days", "Barbell"],
    guide: {
      audience: "Lifters with established squat, bench and deadlift technique who want stronger barbell lifts. Allow roughly 45–60 minutes.",
      equipment: "Barbell, plates, squat rack with safeties, bench, cables, leg press and leg curl.",
      progression: "Warm up to each main lift with progressively heavier sets. Start the working sets at three reps with two clean reps left. When all three sets reach five at that effort, add the smallest practical plate increment and start again at three. Use the listed bands for assistance work.",
      recovery: "Take at least one day between sessions. If you miss the low end twice on the same lift, reduce its load about 5% and rebuild. Keep the other lifts progressing when their sets still move well.",
      sources: [
        { label: "Schoenfeld et al. · heavy and moderate loads", url: "https://pubmed.ncbi.nlm.nih.gov/27928218/" },
        { label: "Longo et al. · rest and repeatable work", url: "https://pubmed.ncbi.nlm.nih.gov/35622106/" },
        progressionStudy,
      ],
    },
    program: {
      Monday: session("Squat first · bench and upper back", "SQUAT", [
        lift("Back Squat", 3, 3, 5, 2, 180, "Set the rack safeties and use a consistent depth."),
        lift("Barbell Bench Press", 3, 3, 5, 2, 180, "Use a consistent touch point and a spotter or safeties."),
        lift("Chest-Supported Row", 3, 6, 10, 2, 120, "Keep the chest on the pad throughout the pull."),
        lift("Seated Leg Curl", 2, 8, 12, 2, 90, "Control the return and keep your hips against the seat."),
      ]),
      Tuesday: rest(),
      Wednesday: session("Deadlift first · vertical press and pull", "DEADLIFT", [
        lift("Conventional Deadlift", 3, 3, 5, 2, 180, "Reset your position and brace between reps."),
        lift("Overhead Press", 3, 4, 6, 2, 180, "Press from the upper chest with the knees still."),
        lift("Lat Pulldown", 3, 6, 10, 2, 120, "Use a repeatable grip and control the return."),
        lift("Leg Press", 2, 8, 10, 2, 120, "Keep your feet planted and your pelvis against the pad."),
      ]),
      Thursday: rest(),
      Friday: session("Bench first · squat and hinge", "BENCH", [
        lift("Barbell Bench Press", 3, 3, 5, 2, 180, "Match Monday’s setup and touch point."),
        lift("Back Squat", 3, 3, 5, 2, 180, "Use Monday’s depth and stop with the listed reserve."),
        lift("Romanian Deadlift", 2, 6, 8, 2, 180, "Push the hips back with soft knees."),
        lift("Cable Row", 2, 8, 12, 2, 120, "Keep the torso steady as the elbows drive back."),
      ]),
      Saturday: rest(),
      Sunday: rest(),
    },
  },
  foundation: {
    id: "foundation",
    name: "Full-Body Foundations",
    desc: "Two short full-body sessions for a first training block or a return to the gym. Repeat the main movements to learn your starting loads.",
    tags: ["Beginner", "2 days", "Full body"],
    guide: {
      audience: "New or returning lifters with two gym days and about 30–40 minutes per session.",
      equipment: "Dumbbells, leg press, chest press, cables and a standing calf machine.",
      progression: "Begin at the bottom of each range with about three good reps left. Record the machine settings and weight. Add reps as the movement becomes familiar. When both sets reach the upper target at that effort, increase by the smallest weight available.",
      recovery: "Leave at least one full day between sessions. After a long layoff, start with one working set per movement on the first two visits and build to the listed two sets when recovered.",
      sources: [
        { label: "Pedersen et al. · twice-weekly full-body training", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9107721/" },
        { label: "Schwanbeck et al. · machine and free-weight training", url: "https://pubmed.ncbi.nlm.nih.gov/32358310/" },
        { label: "Kassiano et al. · increasing load with progress", url: "https://pubmed.ncbi.nlm.nih.gov/41718594/" },
      ],
    },
    program: {
      Monday: session("Foundations A · horizontal pull", "FULL A", [
        lift("Leg Press", 2, 8, 12, 3, 120, "Write down the seat setting and use the same depth on each rep."),
        lift("Machine Chest Press", 2, 8, 12, 3, 120, "Adjust the seat so the handles start near mid-chest."),
        lift("Cable Row", 2, 8, 12, 3, 120, "Bring the elbows back without leaning."),
        lift("DB Romanian Deadlift", 2, 8, 12, 3, 120, "Slide the dumbbells close to the thighs as the hips move back."),
        { ...lift("Dead Bug", 2, 6, 10, 3, 90, "Count reps per side. Keep your low back steady as you reach."), trackingMode: "bodyweight_reps" },
      ]),
      Tuesday: rest(),
      Wednesday: rest(),
      Thursday: session("Foundations B · vertical pull", "FULL B", [
        lift("Leg Press", 2, 8, 12, 3, 120, "Repeat Monday’s setup and record how many clean reps you have left."),
        lift("Machine Chest Press", 2, 8, 12, 3, 120, "Use Monday’s seat position and press through a comfortable range."),
        lift("Lat Pulldown", 2, 8, 12, 3, 120, "Pull toward the upper chest and let the arms extend under control."),
        lift("DB Romanian Deadlift", 2, 8, 12, 3, 120, "Keep the dumbbells close and stop where you can still hold the hinge."),
        lift("Standing Calf Raise", 2, 10, 15, 3, 90, "Pause briefly at the bottom and rise without bouncing."),
      ]),
      Friday: rest(),
      Saturday: rest(),
      Sunday: rest(),
    },
  },
};
