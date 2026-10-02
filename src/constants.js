export const DEFAULT_PROGRAM = {
  // ── Upper/Lower + Dedicated Cardio — Evidence-based Bodybuilding + Cardio ─
  // 2× per muscle per week (Schoenfeld et al.), 10–20 working sets per muscle.
  // Rep scheme: 6 as hypertrophy anchor on compounds, 10–15 on isolation.
  // Recovery: 72hrs between same muscle groups. Cardio separated from legs.
  // Double progression throughout: hit top rep on all sets → add weight.
  // Session time: ~75–85 min lifting + 15 min sauna = 2 hours.
  // ──────────────────────────────────────────────────────────────────────────

  Monday: {
    type: "Upper A — Push + Triceps", code: "UPPER A",
    lifting: [
      { name: "Barbell Bench Press",          sets: 4, reps: 6,  notes: "Anchor compound. Flat back, scapulae retracted, controlled descent to chest. Double progression: hit 4×6 clean → add 5 lbs next Monday." },
      { name: "Incline DB Press",             sets: 3, reps: 10, notes: "45° incline. Lower to a deep stretch — don't let DBs touch at the top to keep tension on. Slower descent than flat bench." },
      { name: "Seated DB Shoulder Press",     sets: 3, reps: 10, notes: "Stop just outside the head at the bottom, full lockout at top. Control the descent. Don't lean back." },
      { name: "Cable Lateral Raises",         sets: 4, reps: 15, notes: "Lead with the elbow, not the wrist. Slight forward lean improves the angle. Last set: drop weight and extend to failure." },
      { name: "Pec Deck / Cable Fly",         sets: 3, reps: 12, notes: "Chest isolation — think squeezing the chest, not moving the arms. 1-second hold at peak contraction." },
      { name: "EZ Bar Skull Crushers",        sets: 3, reps: 12, notes: "Lower slowly to the forehead. Keep elbows pointed at the ceiling — don't let them flare outward." },
      { name: "Rope Tricep Pushdown",         sets: 3, reps: 15, notes: "Spread the rope at the bottom, full extension. Elbows pinned to your sides throughout." },
      { name: "Overhead DB Tricep Extension", sets: 2, reps: 12, notes: "Long head of the tricep. Keep elbows in, lower slowly behind the head for the stretch." },
    ],
    cardio: null,
  },

  Tuesday: {
    type: "Lower A — Squat Pattern", code: "LOWER A",
    lifting: [
      { name: "Back Squat",               sets: 4, reps: 6,  notes: "Anchor compound. Hard brace before descending, hit parallel or below. Double progression: hit 4×6 → add 5 lbs next Tuesday." },
      { name: "Pendulum Squat / V-Squat", sets: 3, reps: 12, notes: "Narrower stance, push knees out over toes. Deep range — no lower back involvement so go lower than a free squat. Pure quad isolation." },
      { name: "Walking Lunges",           sets: 3, reps: 12, notes: "12 reps per leg, heavy DBs. Full stride — back knee close to but not touching the ground. Keep torso upright. Quads and glutes share the load." },
      { name: "Leg Press",                sets: 3, reps: 15, notes: "Shoulder-width foot position, mid-plate, full range. Volume accumulation after the heavier compound work." },
      { name: "Leg Curl",                 sets: 3, reps: 12, notes: "Light today — hamstrings are the primary focus on Lower B. Enough stimulus, not fatigue." },
      { name: "Seated Calf Raises",       sets: 4, reps: 15, notes: "Full stretch at the bottom — pause 1 second. Soleus focus. Go heavy." },
      { name: "Standing Calf Raises",     sets: 3, reps: 15, notes: "Gastrocnemius focus. Full range, heavy." },
    ],
    cardio: null,
  },

  Wednesday: {
    type: "Full Rest", code: "REST",
    lifting: [],
    cardio: null,
  },

  Thursday: {
    type: "Cardio A — Intervals + Core", code: "CARDIO A",
    lifting: [
      { name: "Hanging Leg Raises", sets: 3, reps: 12, notes: "Full hang. Raise legs to parallel or above. Control the descent — don't swing." },
      { name: "Plank",              sets: 3, reps: 45, notes: "45 seconds. Hips in line with shoulders, no sagging. Brace like you're about to be punched." },
      { name: "Dead Bug",           sets: 3, reps: 10, notes: "10 per side. Lower back pressed into the floor at all times. Slow and controlled — anti-extension, not just leg movement." },
    ],
    cardio: { type: "Intervals", miles: 5, effort: "High", notes: "1 mile easy warm-up jog. Main set: 4×4 min at ~85–90% max HR — hard but sustainable, not a sprint. 3 min easy jog recovery between each interval. 1 mile easy cool-down. Alternate weekly: Week B → 6×800m at 5K effort, 2 min jog rest. Core circuit above after the run." },
  },

  Friday: {
    type: "Upper B — Pull + Biceps", code: "UPPER B",
    lifting: [
      { name: "Barbell Row",            sets: 4, reps: 6,  notes: "Overhand grip, bar to lower chest. Lead with the elbows, keep back flat. Double progression: hit 4×6 → add 5 lbs next Friday." },
      { name: "Weighted Pull-Ups",      sets: 4, reps: 8,  notes: "Full hang at the bottom, chin over bar at the top. Add weight via belt once you hit 4×8 clean. Lat pulldown is an acceptable sub." },
      { name: "Chest-Supported Row",    sets: 3, reps: 10, notes: "Removes lower back entirely. Squeeze the shoulder blades at the top. Mid-back and rhomboid focus." },
      { name: "Cable Row (Close Grip)", sets: 3, reps: 12, notes: "Drive the elbows back, not the hands. Lean slightly forward at the start for a lat stretch." },
      { name: "Face Pulls",             sets: 3, reps: 20, notes: "Rope to eye level, external rotate at the end — thumbs behind the ears. Rear delt and rotator cuff health. Never skip this." },
      { name: "Incline DB Curl",        sets: 3, reps: 12, notes: "Long head stretch at the bottom. Don't swing — slow negative. This is where bicep peak comes from." },
      { name: "Hammer Curls",           sets: 3, reps: 12, notes: "Neutral grip. Targets brachialis and brachioradialis — gives width and thickness, not just peak. Alternate arms." },
      { name: "Cable Curl",             sets: 2, reps: 15, notes: "Pump finisher. Full range, constant tension. No ego weight." },
    ],
    cardio: null,
  },

  Saturday: {
    type: "Lower B — Hinge Pattern", code: "LOWER B",
    lifting: [
      { name: "Conventional Deadlift", sets: 4, reps: 5,  notes: "Anchor compound. Bar over mid-foot, lat tension before you pull, drive the floor away, full lockout. Take warm-up sets seriously. Double progression: hit 4×5 → add 5 lbs next Saturday." },
      { name: "Romanian Deadlift",     sets: 4, reps: 8,  notes: "Push the hips back, maintain slight knee bend. Feel the hamstring stretch, not the lower back. Control the descent — this is where hamstring growth happens." },
      { name: "Barbell Hip Thrust",    sets: 4, reps: 12, notes: "Upper back on bench, bar over hip crease with a pad. Drive through the heels. Full extension at the top — 1-second glute squeeze. Biggest direct glute stimulus in the program." },
      { name: "Lying Leg Curl",        sets: 3, reps: 12, notes: "Full range — curl all the way to peak contraction, slow negative. Hamstring isolation after the hinge compounds." },
      { name: "Leg Press",             sets: 3, reps: 15, notes: "Quad finisher to balance the hinge-heavy session. Moderate weight, full range." },
      { name: "Standing Calf Raises",  sets: 4, reps: 15, notes: "Heavy. Full stretch at the bottom, full contraction at the top." },
      { name: "Seated Calf Raises",    sets: 2, reps: 20, notes: "Burnout finisher. High rep, moderate weight. Soleus." },
    ],
    cardio: null,
  },

  Sunday: {
    type: "Cardio B — Long Zone 2", code: "CARDIO B",
    lifting: [],
    cardio: { type: "Long Run", miles: 5.5, effort: "Zone 2", notes: "Conversational pace throughout — you should be able to speak in full sentences. Target Zone 2 HR (~130–150bpm; adjust for your actual max HR). Start at 5.5 miles and add 0.5mi per week toward 8 miles. Finish with 5–10 min of mobility or stretching." },
  },
};
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];



export const defaultDay = () => ({
  workout: { completed: false, exercises: {}, cardio: { miles: "", time: "", pace: "", notes: "" }, notes: "" },
  nutrition: { calories: "", protein: "", carbs: "", fats: "", water: "", meals: [], plannedMeals: {} },
  activity: { steps: "" },
  body: {
    weight: "",
    waist: "",
    sleep: "",
    sleepQuality: "",
    restingHeartRate: "",
    hrv: "",
    energy: "",
    soreness: "",
    stress: "",
    motivation: "",
    illnessOrInjury: false,
  },
  supplements: {},
  intelligence: {
    acceptedTrainingSuggestion: null,
    keptOriginalTrainingPlan: null,
    todayDecisionResponse: null,
    physiqueOS: { mode: null, modeSelectedAt: null, closeout: null },
  },
});

export function getTodayKey() {
  // Use local date components to avoid UTC rollover issues.
  // new Date().toISOString() uses UTC which can be yesterday or tomorrow
  // depending on the user's timezone offset.
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function getDayName(d = new Date()) {
  // getDay() uses local time, which is correct.
  return DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
}
export function fmtDateCode(dateStr) {
  // Parse date string as local noon to avoid any UTC boundary shift.
  const d = new Date(dateStr + "T12:00:00");
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}.${String(d.getFullYear()).slice(2)}`;
}

export const C = {
  bg: "#07090a", panel: "#090c0d", block: "#0a100d", cell: "#0c1310",
  line: "#14201b", lineBright: "#1a2a20",
  green: "#5fd68a", greenDim: "#2a5d3e", greenDark: "#0d1f14", greenMid: "#4a9d6e",
  text: "#e8efe8", textDim: "#4a6d5a", textFaint: "#3a5d4a",
  blue: "#4a9de8", blueDim: "#1a3a4a", amber: "#e8c547", red: "#e85a5a",
};

export const mono = "'IBM Plex Mono', 'DM Mono', monospace";

export const FOOD_DB = [
  { name: "Chicken Breast (4oz)", calories: 124, protein: 26, carbs: 0, fats: 2.7 },
  { name: "Chicken Breast (6oz)", calories: 186, protein: 39, carbs: 0, fats: 4 },
  { name: "Chicken Breast (8oz)", calories: 248, protein: 52, carbs: 0, fats: 5.4 },
  { name: "Top Round Steak (4oz)", calories: 160, protein: 28, carbs: 0, fats: 5 },
  { name: "Top Round Steak (6oz)", calories: 240, protein: 42, carbs: 0, fats: 7.5 },
  { name: "Ground Beef 93% (4oz)", calories: 160, protein: 22, carbs: 0, fats: 8 },
  { name: "Ground Beef 80% (4oz)", calories: 235, protein: 20, carbs: 0, fats: 17 },
  { name: "Salmon (4oz)", calories: 208, protein: 28, carbs: 0, fats: 10 },
  { name: "Tilapia (4oz)", calories: 110, protein: 23, carbs: 0, fats: 2 },
  { name: "Tuna (4oz, canned in water)", calories: 100, protein: 23, carbs: 0, fats: 0.5 },
  { name: "Shrimp (4oz)", calories: 112, protein: 24, carbs: 0, fats: 1.2 },
  { name: "Turkey Breast (4oz)", calories: 120, protein: 26, carbs: 0, fats: 1 },
  { name: "Pork Tenderloin (4oz)", calories: 136, protein: 24, carbs: 0, fats: 4 },
  { name: "Bison (4oz)", calories: 145, protein: 25, carbs: 0, fats: 4.5 },
  { name: "Eggs (1 large)", calories: 72, protein: 6.3, carbs: 0.4, fats: 4.8 },
  { name: "Eggs (2 large)", calories: 143, protein: 12.6, carbs: 0.7, fats: 9.5 },
  { name: "Eggs (3 large)", calories: 215, protein: 18.9, carbs: 1.1, fats: 14.3 },
  { name: "Egg Whites (1 cup)", calories: 126, protein: 26, carbs: 1.8, fats: 0.4 },
  { name: "Greek Yogurt (1 cup)", calories: 130, protein: 23, carbs: 9, fats: 0.7 },
  { name: "Greek Yogurt (6oz)", calories: 100, protein: 17, carbs: 6, fats: 0.5 },
  { name: "Cottage Cheese (1 cup)", calories: 206, protein: 28, carbs: 8, fats: 4.5 },
  { name: "Cottage Cheese (1/2 cup)", calories: 103, protein: 14, carbs: 4, fats: 2.3 },
  { name: "Milk 2% (1 cup)", calories: 122, protein: 8, carbs: 12, fats: 4.8 },
  { name: "Whole Milk (1 cup)", calories: 149, protein: 8, carbs: 12, fats: 8 },
  { name: "Mozzarella (1oz)", calories: 85, protein: 6.3, carbs: 0.6, fats: 6.3 },
  { name: "Cheddar Cheese (1oz)", calories: 113, protein: 7, carbs: 0.4, fats: 9.3 },
  { name: "Whey Protein (1 scoop)", calories: 130, protein: 25, carbs: 5, fats: 2 },
  { name: "Whey Protein (2 scoops)", calories: 260, protein: 50, carbs: 10, fats: 4 },
  { name: "Casein Protein (1 scoop)", calories: 120, protein: 24, carbs: 4, fats: 1 },
  { name: "Mass Gainer (1 serving)", calories: 650, protein: 50, carbs: 85, fats: 8 },
  { name: "White Rice (1 cup cooked)", calories: 206, protein: 4.3, carbs: 45, fats: 0.4 },
  { name: "White Rice (1.5 cups cooked)", calories: 309, protein: 6.5, carbs: 67, fats: 0.6 },
  { name: "Basmati Rice (1 cup cooked)", calories: 210, protein: 4, carbs: 46, fats: 0.5 },
  { name: "Brown Rice (1 cup cooked)", calories: 216, protein: 5, carbs: 45, fats: 1.8 },
  { name: "Jasmine Rice (1 cup cooked)", calories: 205, protein: 4.2, carbs: 45, fats: 0.4 },
  { name: "Oatmeal (1 cup cooked)", calories: 154, protein: 5.3, carbs: 27, fats: 2.6 },
  { name: "Oatmeal (1/2 cup dry)", calories: 150, protein: 5, carbs: 27, fats: 3 },
  { name: "Pasta (1 cup cooked)", calories: 220, protein: 8, carbs: 43, fats: 1.3 },
  { name: "Whole Wheat Bread (1 slice)", calories: 80, protein: 4, carbs: 15, fats: 1 },
  { name: "White Bread (1 slice)", calories: 79, protein: 2.7, carbs: 15, fats: 1 },
  { name: "Bagel (1 plain)", calories: 270, protein: 10, carbs: 53, fats: 1.5 },
  { name: "Tortilla (1 large flour)", calories: 220, protein: 6, carbs: 36, fats: 6 },
  { name: "Quinoa (1 cup cooked)", calories: 222, protein: 8, carbs: 39, fats: 3.5 },
  { name: "Banana (medium)", calories: 105, protein: 1.3, carbs: 27, fats: 0.4 },
  { name: "Banana (large)", calories: 121, protein: 1.5, carbs: 31, fats: 0.5 },
  { name: "Apple (medium)", calories: 95, protein: 0.5, carbs: 25, fats: 0.3 },
  { name: "Blueberries (1 cup)", calories: 84, protein: 1.1, carbs: 21, fats: 0.5 },
  { name: "Strawberries (1 cup)", calories: 49, protein: 1, carbs: 12, fats: 0.5 },
  { name: "Orange (medium)", calories: 62, protein: 1.2, carbs: 15, fats: 0.2 },
  { name: "Mango (1 cup)", calories: 107, protein: 0.8, carbs: 28, fats: 0.4 },
  { name: "Pineapple (1 cup)", calories: 82, protein: 0.9, carbs: 22, fats: 0.2 },
  { name: "Grapes (1 cup)", calories: 104, protein: 1.1, carbs: 27, fats: 0.2 },
  { name: "Sweet Potato (medium)", calories: 103, protein: 2.3, carbs: 24, fats: 0.1 },
  { name: "Sweet Potato (large)", calories: 162, protein: 3.6, carbs: 37, fats: 0.1 },
  { name: "Broccoli (1 cup)", calories: 55, protein: 3.7, carbs: 11, fats: 0.6 },
  { name: "Spinach (1 cup raw)", calories: 7, protein: 0.9, carbs: 1.1, fats: 0.1 },
  { name: "Asparagus (1 cup)", calories: 27, protein: 3, carbs: 5, fats: 0.2 },
  { name: "Mixed Vegetables (1 cup)", calories: 59, protein: 2.6, carbs: 11.8, fats: 0.1 },
  { name: "Avocado (half)", calories: 160, protein: 2, carbs: 9, fats: 15 },
  { name: "Avocado (whole)", calories: 320, protein: 4, carbs: 18, fats: 30 },
  { name: "Almonds (1oz)", calories: 164, protein: 6, carbs: 6, fats: 14 },
  { name: "Peanut Butter (2 tbsp)", calories: 188, protein: 8, carbs: 6, fats: 16 },
  { name: "Almond Butter (2 tbsp)", calories: 196, protein: 7, carbs: 6, fats: 18 },
  { name: "Walnuts (1oz)", calories: 185, protein: 4.3, carbs: 3.9, fats: 18.5 },
  { name: "Cashews (1oz)", calories: 157, protein: 5.2, carbs: 8.6, fats: 12.4 },
  { name: "Olive Oil (1 tbsp)", calories: 119, protein: 0, carbs: 0, fats: 13.5 },
  { name: "Coconut Oil (1 tbsp)", calories: 121, protein: 0, carbs: 0, fats: 13.5 },
  { name: "Chicken & Rice Bowl (8oz chx, 1.5c rice)", calories: 681, protein: 91, carbs: 67, fats: 9.4 },
  { name: "Steak & Rice (6oz top round, 1c rice)", calories: 446, protein: 46, carbs: 45, fats: 5.4 },
  { name: "Protein Oats (1 scoop whey + 1c oats)", calories: 284, protein: 30, carbs: 32, fats: 4.6 },
  { name: "Rice Cakes (2)", calories: 70, protein: 1.4, carbs: 15.4, fats: 0.6 },
  { name: "String Cheese (1 stick)", calories: 80, protein: 7, carbs: 1, fats: 5 },
  { name: "Beef Jerky (1oz)", calories: 82, protein: 11.8, carbs: 2.2, fats: 3.1 },
  { name: "Protein Bar (avg)", calories: 200, protein: 20, carbs: 22, fats: 7 },
  { name: "Orange Juice (8oz)", calories: 112, protein: 1.7, carbs: 26, fats: 0.5 },
  { name: "Chocolate Milk (8oz)", calories: 208, protein: 8, carbs: 26, fats: 8 },
  { name: "Gatorade (20oz)", calories: 130, protein: 0, carbs: 34, fats: 0 },
  { name: "Honey (1 tbsp)", calories: 64, protein: 0.1, carbs: 17.3, fats: 0 },
];

export function scoreFoods(q) {
  q = q.toLowerCase();
  return FOOD_DB.map((f) => {
    const name = f.name.toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 2;
    else if (q.split(" ").some((w) => w.length > 2 && name.includes(w))) score = 1;
    return { ...f, score };
  }).filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
}

// ── Workout Presets ────────────────────────────────────────────────────────────
export const PROGRAM_PRESETS = {
  hybrid: {
    id: "hybrid",
    name: "Hybrid Athlete — PPL + Hyrox",
    desc: "Polarized 80/20 running. Heavy low-rep compounds + explosive work. Push/Pull/Legs + dedicated Hyrox engine day. Deload every 5th week.",
    tags: ["Strength", "Hyrox", "PPL", "Polarized"],
    program: null, // signals: use DEFAULT_PROGRAM
  },
  highIntensityHybrid: {
    id: "highIntensityHybrid",
    name: "Aggressive 2-a-Day Strength + Recomp",
    desc: "AM/PM lifting split with cardio in both sessions. Advanced workload; readiness-gated for strength, muscle, cardio, and fat loss.",
    tags: ["2x/day", "Strength", "Hypertrophy", "Cardio", "Advanced"],
    program: {
      Monday: {
        type: "Upper Strength + Lower Hypertrophy", code: "AM/PM",
        lifting: [], cardio: null,
        sessions: [
          { id:"am", label:"AM", title:"Upper Strength", timeOfDay:"morning", emphasis:"Heavy compounds · 1-2 RIR", lifting:[
            {name:"Barbell Bench Press",sets:2,reps:3,notes:"Heavy but clean. Leave 1-2 reps in reserve — no grinders."},
            {name:"Weighted Pull-Up",sets:2,reps:5,notes:"Full hang, controlled top. Use lat pulldown if needed."},
            {name:"Overhead Press",sets:2,reps:5,notes:"Brace hard. Stop before technical breakdown."},
            {name:"Barbell Row",sets:2,reps:6,notes:"Explosive pull, controlled lower."},
            {name:"Face Pull",sets:2,reps:15,notes:"Shoulder health; do not skip."},
          ], cardio:{type:"Zone 2 Run",miles:3,effort:"Easy",notes:"Conversational. If legs feel flat, bike/row Zone 2 instead."} },
          { id:"pm", label:"PM", title:"Lower Hypertrophy", timeOfDay:"evening", emphasis:"Volume · controlled tempo", lifting:[
            {name:"Front Squat",sets:2,reps:8,notes:"Controlled depth. Leave 2 RIR."},
            {name:"Romanian Deadlift",sets:2,reps:8,notes:"Hamstring stretch, neutral spine."},
            {name:"Leg Press",sets:2,reps:12,notes:"Full range. Do not lock out aggressively."},
            {name:"Walking Lunges",sets:2,reps:12,notes:"Per leg. Smooth reps."},
            {name:"Seated Calf Raise",sets:2,reps:15,notes:"Pause stretch and contraction."},
          ], cardio:{type:"Incline Walk",miles:2,effort:"Very Easy",notes:"Recovery-biased. Drop this first if readiness is low."} },
        ],
      },
      Tuesday: {
        type: "Lower Strength + Upper Hypertrophy", code: "AM/PM",
        lifting: [], cardio: null,
        sessions: [
          { id:"am", label:"AM", title:"Lower Strength", timeOfDay:"morning", emphasis:"Squat/deadlift strength", lifting:[
            {name:"Back Squat",sets:2,reps:3,notes:"Heavy triples, 1-2 RIR."},
            {name:"Conventional Deadlift",sets:2,reps:3,notes:"Fast reps only. Stop before grind."},
            {name:"Bulgarian Split Squat",sets:2,reps:8,notes:"Per leg."},
            {name:"Lying Leg Curl",sets:2,reps:10,notes:"Controlled eccentric."},
            {name:"Standing Calf Raise",sets:2,reps:12,notes:"Heavy, full range."},
          ], cardio:{type:"Zone 2 Bike/Run",miles:3,effort:"Easy",notes:"Low-impact if squat/deadlift fatigue is high."} },
          { id:"pm", label:"PM", title:"Upper Hypertrophy", timeOfDay:"evening", emphasis:"Chest/back/shoulders volume", lifting:[
            {name:"Incline DB Press",sets:2,reps:10,notes:"Deep stretch."},
            {name:"Chest-Supported Row",sets:2,reps:10,notes:"Squeeze shoulder blades."},
            {name:"Cable Fly",sets:2,reps:12,notes:"1-sec peak squeeze."},
            {name:"Lat Pulldown",sets:2,reps:12,notes:"Elbows down and in."},
            {name:"Cable Lateral Raise",sets:2,reps:15,notes:"Strict reps."},
          ], cardio:{type:"Easy Run",miles:2,effort:"Easy",notes:"Keep it aerobic. No racing."} },
        ],
      },
      Wednesday: {
        type: "Pull Strength + Push/Arms", code: "AM/PM",
        lifting: [], cardio: null,
        sessions: [
          { id:"am", label:"AM", title:"Pull Strength", timeOfDay:"morning", emphasis:"Heavy back + posterior chain", lifting:[
            {name:"Weighted Chin-Up",sets:2,reps:4,notes:"Add load only if all reps are crisp."},
            {name:"Pendlay Row",sets:2,reps:5,notes:"Reset each rep."},
            {name:"Rack Pull",sets:2,reps:5,notes:"Heavy hinge accessory, no maxing."},
            {name:"Rear Delt Fly",sets:2,reps:15,notes:"Strict."},
            {name:"Hammer Curl",sets:2,reps:10,notes:"No swing."},
          ], cardio:{type:"Zone 2 Run",miles:3,effort:"Easy",notes:"Base work. Keep it boring."} },
          { id:"pm", label:"PM", title:"Push + Arms Hypertrophy", timeOfDay:"evening", emphasis:"Pump work", lifting:[
            {name:"DB Bench Press",sets:2,reps:10,notes:"Controlled range."},
            {name:"Seated DB Shoulder Press",sets:2,reps:10,notes:"Stop if shoulders feel unstable."},
            {name:"Dips",sets:2,reps:10,notes:"Weighted only if clean."},
            {name:"EZ Bar Curl",sets:2,reps:12,notes:"Slow negative."},
            {name:"Rope Pushdown",sets:2,reps:15,notes:"Full extension."},
          ], cardio:{type:"Tempo Intervals",miles:2.5,effort:"Moderate",notes:"Short controlled tempo, not a race. Skip if readiness is suppressed."} },
        ],
      },
      Thursday: {
        type: "Lower Volume + Upper Volume", code: "AM/PM",
        lifting: [], cardio: null,
        sessions: [
          { id:"am", label:"AM", title:"Lower Volume", timeOfDay:"morning", emphasis:"Quad/glute volume", lifting:[
            {name:"Hack Squat",sets:2,reps:10,notes:"Deep, controlled."},
            {name:"Hip Thrust",sets:2,reps:10,notes:"Pause at top."},
            {name:"Leg Extension",sets:2,reps:15,notes:"Squeeze hard."},
            {name:"Seated Leg Curl",sets:2,reps:12,notes:"Full range."},
            {name:"Tibialis Raise",sets:2,reps:15,notes:"Lower-leg durability."},
          ], cardio:{type:"Easy Run",miles:2.5,effort:"Easy",notes:"Aerobic only."} },
          { id:"pm", label:"PM", title:"Upper Volume", timeOfDay:"evening", emphasis:"Back/chest density", lifting:[
            {name:"Close-Grip Bench Press",sets:2,reps:8,notes:"Triceps bias."},
            {name:"Cable Row",sets:2,reps:12,notes:"Constant tension."},
            {name:"Machine Chest Press",sets:2,reps:12,notes:"Pump work."},
            {name:"Single-Arm Pulldown",sets:2,reps:12,notes:"Lat focus."},
            {name:"Lateral Raise Mechanical Dropset",sets:2,reps:15,notes:"Strict then partials."},
          ], cardio:{type:"Incline Walk",miles:2,effort:"Very Easy",notes:"Recovery flush."} },
        ],
      },
      Friday: {
        type: "Full-Body Power + Posterior Chain", code: "AM/PM",
        lifting: [], cardio: null,
        sessions: [
          { id:"am", label:"AM", title:"Full-Body Power", timeOfDay:"morning", emphasis:"Power without misses", lifting:[
            {name:"Power Clean",sets:2,reps:3,notes:"Technique speed. No ugly catches."},
            {name:"Push Press",sets:2,reps:4,notes:"Explosive, controlled lockout."},
            {name:"Trap Bar Deadlift",sets:2,reps:5,notes:"Heavy but fast."},
            {name:"Box Jump",sets:2,reps:5,notes:"Full reset between reps."},
            {name:"Farmer Carry",sets:2,reps:40,notes:"40 yards. Brace."},
          ], cardio:{type:"Zone 2 Run",miles:3,effort:"Easy",notes:"Keep intensity down after power work."} },
          { id:"pm", label:"PM", title:"Posterior Chain + Back", timeOfDay:"evening", emphasis:"Hypertrophy accessories", lifting:[
            {name:"Romanian Deadlift",sets:2,reps:10,notes:"Moderate load."},
            {name:"Glute-Ham Raise",sets:2,reps:8,notes:"Use assistance if needed."},
            {name:"T-Bar Row",sets:2,reps:10,notes:"Hard squeeze."},
            {name:"Back Extension",sets:2,reps:12,notes:"Glute focus."},
            {name:"Cable Curl",sets:2,reps:15,notes:"Pump finisher."},
          ], cardio:{type:"Easy Run",miles:2,effort:"Easy",notes:"Optional if strain is high."} },
        ],
      },
      Saturday: {
        type: "Hypertrophy Pump + Optional Core", code: "AM/PM",
        lifting: [], cardio: null,
        sessions: [
          { id:"am", label:"AM", title:"Hypertrophy Pump", timeOfDay:"morning", emphasis:"Lower joint stress", lifting:[
            {name:"Machine Shoulder Press",sets:2,reps:12,notes:"Smooth reps."},
            {name:"Pulldown",sets:2,reps:12,notes:"Lat focus."},
            {name:"Leg Press",sets:2,reps:15,notes:"Moderate load."},
            {name:"Cable Fly",sets:2,reps:15,notes:"Pump."},
            {name:"Superset Curl + Pushdown",sets:2,reps:15,notes:"Each movement."},
          ], cardio:{type:"Long Zone 2",miles:4,effort:"Zone 2",notes:"Weekly aerobic anchor. Cut to 2 miles if fatigue is accumulating."} },
          { id:"pm", label:"PM", title:"Optional Arms + Core", timeOfDay:"evening", emphasis:"Optional recovery-biased work", lifting:[
            {name:"Hanging Leg Raise",sets:2,reps:12,notes:"Controlled."},
            {name:"Cable Crunch",sets:2,reps:15,notes:"Exhale hard."},
            {name:"Incline DB Curl",sets:2,reps:12,notes:"Optional."},
            {name:"Overhead Tricep Extension",sets:2,reps:12,notes:"Optional."},
          ], cardio:{type:"Recovery Walk",miles:1,effort:"Very Easy",notes:"Only if it helps you feel better. Skip when readiness is low."} },
        ],
      },
      Sunday: { type:"Full Rest", code:"REST", lifting:[], cardio:null, sessions:[] },
    },
  },
  ramiHybridCut: {
    id: "ramiHybridCut",
    name: "Rami · Aggressive Hybrid Cut",
    desc: "Five focused lifting sessions, three runs, two low-impact aerobic sessions, and one optional pump session. AM/PM structure prioritizes fat loss, V-taper hypertrophy, strength retention, and 5K development.",
    tags: ["AM/PM", "Cut", "Hypertrophy", "Running", "Advanced"],
    program: {
      Monday: { type:"Threshold + Upper Strength", code:"RUN / UPPER", lifting:[], cardio:null, sessions:[
        { id:"am", label:"AM", title:"Threshold Run", timeOfDay:"morning", emphasis:"Controlled hard · never a race", lifting:[], cardio:{type:"Threshold Intervals",miles:4,effort:"Hard",notes:"10 min easy, 4 × 5 min controlled hard with 2 min easy, 10 min cool-down. Progress to 3 × 8 min in block 2."}},
        { id:"pm", label:"PM", title:"Upper Strength", timeOfDay:"evening", emphasis:"Heavy compounds · 1–2 RIR", lifting:[
          {name:"Incline Smith Press",sets:4,reps:6,notes:"5–8 reps. Add load after all four sets reach 8 clean reps."},
          {name:"Neutral-Grip Lat Pulldown",sets:4,reps:7,notes:"6–8 reps. Full stretch, drive elbows down."},
          {name:"Chest-Supported Row",sets:4,reps:8,notes:"6–10 reps. No torso momentum."},
          {name:"Machine Chest Press",sets:3,reps:8,notes:"6–10 reps. Controlled eccentric."},
          {name:"Seated Shoulder Press",sets:3,reps:8,notes:"6–10 reps. Stop before technical failure."},
          {name:"Cable Lateral Raise",sets:4,reps:15,notes:"12–20 strict reps."},
          {name:"Cable Crunch",sets:3,reps:12,notes:"10–15 reps."},
        ], cardio:null },
      ]},
      Tuesday: { type:"Aerobic + Lower Strength", code:"ZONE 2 / LOWER", lifting:[], cardio:null, sessions:[
        { id:"am", label:"AM", title:"Easy Aerobic", timeOfDay:"morning", emphasis:"Recovery-supportive", lifting:[], cardio:{type:"Bike / Elliptical / Incline Walk",miles:2.5,effort:"Easy",notes:"30–40 min conversational. Keep legs fresh for PM strength."}},
        { id:"pm", label:"PM", title:"Lower Strength", timeOfDay:"evening", emphasis:"Heavy, crisp work · 1–2 RIR", lifting:[
          {name:"Hack Squat",sets:4,reps:6,notes:"5–8 reps. Full controlled depth."},{name:"Romanian Deadlift",sets:4,reps:7,notes:"6–8 reps. Long hamstring position."},{name:"Bulgarian Split Squat",sets:3,reps:9,notes:"8–10 per side."},{name:"Seated Leg Curl",sets:4,reps:10,notes:"8–12 reps."},{name:"Leg Extension",sets:2,reps:14,notes:"12–15 reps; final set may approach failure."},{name:"Standing Calf Raise",sets:4,reps:10,notes:"8–12 with pauses."},{name:"Hanging Leg Raise",sets:3,reps:12,notes:"8–15 controlled."}
        ], cardio:null },
      ]},
      Wednesday: { type:"Recovery Walk + Delts / Arms", code:"WALK / SPECIALIZATION", lifting:[], cardio:null, sessions:[
        { id:"am", label:"AM", title:"Incline Recovery Walk", timeOfDay:"morning", emphasis:"Low fatigue · daily movement", lifting:[], cardio:{type:"Incline Walk",miles:2.5,effort:"Very Easy",notes:"35–45 min. Nasal-breathing effort."}},
        { id:"pm", label:"PM", title:"Delts, Arms & Abs", timeOfDay:"evening", emphasis:"V-taper specialization", lifting:[
          {name:"Machine Shoulder Press",sets:3,reps:10,notes:"8–12 reps."},{name:"Cable Lateral Raise",sets:5,reps:16,notes:"12–20; final set may reach technical failure."},{name:"Reverse Pec Deck",sets:4,reps:16,notes:"12–20 strict."},{name:"Rear-Delt Row",sets:3,reps:12,notes:"10–15 reps."},{name:"EZ-Bar Curl",sets:3,reps:10,notes:"8–12 reps."},{name:"Incline Dumbbell Curl",sets:3,reps:12,notes:"10–15 reps."},{name:"Hammer Curl",sets:2,reps:12,notes:"10–15 reps."},{name:"Overhead Cable Triceps Extension",sets:4,reps:10,notes:"8–12 reps."},{name:"Rope Pressdown",sets:3,reps:12,notes:"10–15 reps."},{name:"Cable Crunch",sets:4,reps:12,notes:"10–15 reps."}
        ], cardio:null },
      ]},
      Thursday: { type:"Easy Run + Lower Hypertrophy", code:"RUN / LOWER", lifting:[], cardio:null, sessions:[
        { id:"am", label:"AM", title:"Easy Run", timeOfDay:"morning", emphasis:"Aerobic base", lifting:[], cardio:{type:"Easy Run",miles:4,effort:"Easy",notes:"40–50 min conversational. Add time before pace."}},
        { id:"pm", label:"PM", title:"Lower Hypertrophy", timeOfDay:"evening", emphasis:"Volume without grinding", lifting:[
          {name:"Hip Thrust",sets:4,reps:10,notes:"8–12 reps."},{name:"Leg Press",sets:4,reps:12,notes:"10–15 reps."},{name:"Lying Leg Curl",sets:4,reps:12,notes:"10–15 reps."},{name:"Reverse Lunge",sets:3,reps:11,notes:"10–12 per side."},{name:"Leg Extension",sets:3,reps:16,notes:"12–20 reps."},{name:"Seated Calf Raise",sets:5,reps:15,notes:"12–20 reps."},{name:"Pallof Press",sets:3,reps:12,notes:"12 per side."}
        ], cardio:null },
      ]},
      Friday: { type:"Zone 2 + Upper Hypertrophy", code:"ZONE 2 / UPPER", lifting:[], cardio:null, sessions:[
        { id:"am", label:"AM", title:"Zone 2 Conditioning", timeOfDay:"morning", emphasis:"Aerobic volume · low impact", lifting:[], cardio:{type:"Bike / Elliptical",miles:3,effort:"Zone 2",notes:"40–50 min. Smooth, sustainable output."}},
        { id:"pm", label:"PM", title:"Upper Hypertrophy", timeOfDay:"evening", emphasis:"Upper chest, lats, delts", lifting:[
          {name:"Incline Machine Press",sets:4,reps:10,notes:"8–12 reps."},{name:"Single-Arm Lat Pulldown",sets:4,reps:10,notes:"8–12 per side."},{name:"Flat Dumbbell Press",sets:3,reps:10,notes:"8–12 reps."},{name:"Single-Arm Cable Row",sets:4,reps:12,notes:"10–15 per side."},{name:"Pec Deck",sets:3,reps:15,notes:"12–20 reps."},{name:"Straight-Arm Pulldown",sets:3,reps:15,notes:"12–20 reps."},{name:"Cable Lateral Raise",sets:4,reps:18,notes:"15–25 reps."},{name:"Reverse Pec Deck",sets:3,reps:18,notes:"15–25 reps."},{name:"Cable Curl",sets:3,reps:12,notes:"10–15 reps."},{name:"Rope Pressdown",sets:3,reps:12,notes:"10–15 reps."}
        ], cardio:null },
      ]},
      Saturday: { type:"Long Run + Optional Pump", code:"LONG / OPTIONAL", lifting:[], cardio:null, sessions:[
        { id:"am", label:"AM", title:"Long Easy Run", timeOfDay:"morning", emphasis:"Weekly aerobic anchor", lifting:[], cardio:{type:"Long Easy Run",miles:6,effort:"Easy",notes:"Start at 60 min; add 5 min after successful weeks, cap at 90 min. Conversational throughout."}},
        { id:"pm", label:"PM", title:"Optional Pump", timeOfDay:"evening", emphasis:"Optional · skip before it harms recovery", notes:"Optional session. Complete only when sleep, joints, and running performance are good.", lifting:[
          {name:"Cable Lateral Raise",sets:4,reps:20,notes:"15–25 reps."},{name:"Preacher Curl",sets:3,reps:12,notes:"10–15 reps."},{name:"Overhead Rope Extension",sets:3,reps:12,notes:"10–15 reps."},{name:"Calf Raise",sets:4,reps:16,notes:"12–20 reps."},{name:"Cable Crunch",sets:3,reps:15,notes:"12–20 reps."}
        ], cardio:null },
      ]},
      Sunday: { type:"Full Recovery", code:"RECOVER", lifting:[], cardio:null, sessions:[] },
    },
  },
  doubleEdition: {
    id: "doubleEdition",
    name: "The Double Edition",
    desc: "Six single-focus heavy mornings + evening pump editions for ~2\u00d7/week frequency. Every working set 0\u20132 RIR; final isolations to true failure. Polarized running and daily walks woven into both sessions. Governed by the Morning Edition states \u2014 Accumulating trims the PM, Deload advised halves the day.",
    tags: ["2x/day", "Hypertrophy", "Aesthetic", "Polarized", "Advanced"],
    program: {
      Monday: {
        type: "Chest Heavy + Arms Pump", code: "AM/PM", lifting: [], cardio: null,
        sessions: [
          { id: "am", label: "AM", title: "Morning Edition \u2014 Chest", timeOfDay: "morning", emphasis: "Heavy chest \u00b7 0\u20132 RIR", lifting: [
            { name: "Incline DB Press", sets: 4, reps: 8, notes: "Top set 4\u20136 first \u2014 log it \u2014 then back-offs 6\u201310. The week's chest anchor." },
            { name: "Machine Chest Press", sets: 3, reps: 10, notes: "8\u201312, 2s negatives." },
            { name: "Weighted Dip", sets: 3, reps: 10, notes: "8\u201312, lean forward. Add load when 12 is clean." },
            { name: "Cable Fly Low-to-High", sets: 3, reps: 13, notes: "12\u201315, upper-chest bias." },
            { name: "Pec Deck", sets: 3, reps: 13, notes: "12\u201315. Final set DROP \u2014 failure, strip ~25%, twice." },
            { name: "Hanging Leg Raise", sets: 3, reps: 13, notes: "12\u201315." },
          ], cardio: { type: "Incline Walk", miles: 1.2, effort: "Very Easy", notes: "20 min @ 10\u201312% / 3.0 mph \u2014 the AM finisher, every lifting morning." } },
          { id: "pm", label: "PM", title: "Evening Edition \u2014 Arms Pump", timeOfDay: "evening", emphasis: "Pump + easy run", lifting: [
            { name: "EZ-Bar Curl", sets: 3, reps: 12, notes: "10\u201315. Superset with the pushdown \u2014 no rest between.", pairNext: true },
            { name: "Rope Pushdown", sets: 3, reps: 12, notes: "10\u201315." },
            { name: "Incline DB Curl", sets: 3, reps: 13, notes: "12\u201315, full stretch at the bottom." },
            { name: "Overhead Cable Extension", sets: 3, reps: 13, notes: "12\u201315, long-head stretch." },
            { name: "Standing Calf Raise", sets: 4, reps: 12, notes: "10\u201315, 2s pause at stretch." },
          ], cardio: { type: "Zone 2 Run", miles: 3.1, effort: "Easy", notes: "~30 min, fully conversational." } },
        ],
      },
      Tuesday: {
        type: "Back Heavy + Delt Pump", code: "AM/PM", lifting: [], cardio: null,
        sessions: [
          { id: "am", label: "AM", title: "Morning Edition \u2014 Back", timeOfDay: "morning", emphasis: "Width bias \u00b7 heavy", lifting: [
            { name: "Weighted Pull-Up", sets: 4, reps: 6, notes: "Top set 4\u20136 \u2014 log it \u2014 then back-offs 6\u201310. The width anchor." },
            { name: "Barbell Row", sets: 3, reps: 8, notes: "6\u201310, heavy and strict." },
            { name: "Lat Pulldown Neutral Wide", sets: 3, reps: 11, notes: "10\u201312. Drive elbows down, pin the stretch." },
            { name: "Chest-Supported Row", sets: 3, reps: 11, notes: "10\u201312, mid-back thickness." },
            { name: "Straight-Arm Pulldown", sets: 3, reps: 13, notes: "12\u201315, last set to failure." },
            { name: "Rear Delt Cable Fly", sets: 3, reps: 15, notes: "Strict." },
          ], cardio: { type: "Incline Walk", miles: 1.2, effort: "Very Easy", notes: "20 min incline finisher." } },
          { id: "pm", label: "PM", title: "Evening Edition \u2014 Delts", timeOfDay: "evening", emphasis: "Priority pump", lifting: [
            { name: "Cable Lateral Raise", sets: 4, reps: 13, notes: "12\u201315. The priority movement of the week. Superset with the rear fly.", pairNext: true },
            { name: "Cable Rear Fly", sets: 4, reps: 13, notes: "12\u201315." },
            { name: "Machine Lateral Raise", sets: 3, reps: 17, notes: "15\u201320, constant tension, no swing." },
            { name: "DB Shrug", sets: 3, reps: 13, notes: "12\u201315, 1s hold at top." },
            { name: "Cable Crunch", sets: 3, reps: 13, notes: "12\u201315." },
          ], cardio: { type: "Brisk Walk", miles: 1.8, effort: "Very Easy", notes: "35 min outdoors (incline treadmill if late)." } },
        ],
      },
      Wednesday: {
        type: "Quads Heavy + Chest Pump", code: "AM/PM", lifting: [], cardio: null,
        sessions: [
          { id: "am", label: "AM", title: "Morning Edition \u2014 Quads", timeOfDay: "morning", emphasis: "Heavy legs \u00b7 no running today", lifting: [
            { name: "Hack Squat", sets: 4, reps: 6, notes: "Top set 4\u20136, then 6\u20138. Or high-bar squat \u2014 pick one and ride it for the block." },
            { name: "Leg Press Feet Low", sets: 3, reps: 11, notes: "10\u201312, deep." },
            { name: "Bulgarian Split Squat", sets: 2, reps: 9, notes: "8\u201310 per leg, quad-forward torso." },
            { name: "Leg Extension", sets: 3, reps: 13, notes: "12\u201315. Final set DROP \u2014 the burnout." },
            { name: "Seated Calf Raise", sets: 4, reps: 13, notes: "12\u201315." },
          ], cardio: { type: "Flat Walk", miles: 0.9, effort: "Very Easy", notes: "15 min FLAT \u2014 spare the legs." } },
          { id: "pm", label: "PM", title: "Evening Edition \u2014 Chest Pump", timeOfDay: "evening", emphasis: "Pump, not load", lifting: [
            { name: "Machine Incline Press", sets: 3, reps: 12, notes: "10\u201315, lighter than Monday \u2014 chase the pump." },
            { name: "Cable Fly High-to-Low", sets: 3, reps: 13, notes: "12\u201315. Superset with the push-ups.", pairNext: true },
            { name: "Deficit Push-Up", sets: 3, reps: 15, notes: "To failure each set." },
            { name: "Hanging Knee Raise", sets: 3, reps: 15, notes: "" },
          ], cardio: { type: "Walk", miles: 1.6, effort: "Very Easy", notes: "30 min. Quad day \u2014 no running." } },
        ],
      },
      Thursday: {
        type: "Shoulders Heavy + Back Pump", code: "AM/PM", lifting: [], cardio: null,
        sessions: [
          { id: "am", label: "AM", title: "Morning Edition \u2014 Shoulders", timeOfDay: "morning", emphasis: "Delts, heavy then strict", lifting: [
            { name: "Seated DB Shoulder Press", sets: 4, reps: 7, notes: "Top set 5\u20137 \u2014 log it \u2014 then 8\u201310." },
            { name: "DB Lateral Raise", sets: 4, reps: 12, notes: "10\u201315, strict. Last set R-P on alternate weeks \u2014 failure, fifteen breaths, again." },
            { name: "Cable Y-Raise", sets: 3, reps: 13, notes: "12\u201315." },
            { name: "Reverse Pec Deck", sets: 3, reps: 13, notes: "12\u201315." },
            { name: "Barbell Shrug", sets: 3, reps: 10, notes: "8\u201312." },
            { name: "Weighted Plank", sets: 3, reps: 45, notes: "Seconds, not reps \u2014 45s holds." },
          ], cardio: { type: "Incline Walk", miles: 1.2, effort: "Very Easy", notes: "20 min incline finisher." } },
          { id: "pm", label: "PM", title: "Evening Edition \u2014 Back Width", timeOfDay: "evening", emphasis: "Pump + the quality run", lifting: [
            { name: "Single-Arm Lat Pulldown", sets: 3, reps: 13, notes: "12\u201315 per arm. Superset with the straight-arm.", pairNext: true },
            { name: "Straight-Arm Pulldown", sets: 3, reps: 15, notes: "" },
            { name: "Machine Row", sets: 3, reps: 13, notes: "12\u201315 \u2014 squeeze, don't heave." },
            { name: "DB Curl", sets: 3, reps: 13, notes: "12\u201315, bonus arm volume." },
          ], cardio: { type: "Quality Run", miles: 3.4, effort: "Moderate", notes: "Alternate weekly: 25 min tempo (3\u20134-word sentences) \u21c4 6\u00d72 min hard / 2 min easy. Sits 36h clear of the quad session on both sides." } },
        ],
      },
      Friday: {
        type: "Arms Heavy + Posterior Pump", code: "AM/PM", lifting: [], cardio: null,
        sessions: [
          { id: "am", label: "AM", title: "Morning Edition \u2014 Arms", timeOfDay: "morning", emphasis: "Heavy arms", lifting: [
            { name: "Close-Grip Bench", sets: 3, reps: 7, notes: "Top set 5\u20137 \u2014 log it \u2014 then 2\u00d78\u201310. The arm-day anchor." },
            { name: "EZ-Bar Curl", sets: 3, reps: 10, notes: "8\u201312, heavy and strict." },
            { name: "Skullcrusher", sets: 3, reps: 11, notes: "10\u201312." },
            { name: "Preacher Curl", sets: 3, reps: 11, notes: "10\u201312." },
            { name: "Rope Pushdown", sets: 3, reps: 13, notes: "12\u201315." },
            { name: "Hammer Curl", sets: 3, reps: 13, notes: "12\u201315. Final set DROP." },
          ], cardio: { type: "Incline Walk", miles: 1.2, effort: "Very Easy", notes: "20 min incline finisher." } },
          { id: "pm", label: "PM", title: "Evening Edition \u2014 Hams/Glutes", timeOfDay: "evening", emphasis: "Posterior preview + easy run", lifting: [
            { name: "Seated Leg Curl", sets: 3, reps: 13, notes: "12\u201315, lighter preview of Saturday." },
            { name: "Hip Thrust", sets: 3, reps: 11, notes: "10\u201312, pause at top." },
            { name: "Back Extension", sets: 3, reps: 15, notes: "Glute bias, rounded upper back." },
            { name: "Standing Calf Raise", sets: 3, reps: 17, notes: "15\u201320." },
          ], cardio: { type: "Zone 2 Run", miles: 3.1, effort: "Easy", notes: "~30 min, conversational." } },
        ],
      },
      Saturday: {
        type: "Hams/Glutes Heavy + Quad Pump", code: "AM/PM", lifting: [], cardio: null,
        sessions: [
          { id: "am", label: "AM", title: "Morning Edition \u2014 Hams & Glutes", timeOfDay: "morning", emphasis: "Hinge anchor", lifting: [
            { name: "Romanian Deadlift", sets: 4, reps: 7, notes: "Top set 5\u20137 \u2014 log it \u2014 then back-offs 8\u201310." },
            { name: "Lying Leg Curl", sets: 4, reps: 11, notes: "10\u201312. Last set R-P alternate weeks (alternates with Thursday's laterals)." },
            { name: "Walking Lunge", sets: 2, reps: 11, notes: "10\u201312 per leg, long glute-biased strides." },
            { name: "Hip Abduction Machine", sets: 3, reps: 15, notes: "" },
            { name: "Seated Calf Raise", sets: 3, reps: 15, notes: "" },
            { name: "Cable Crunch", sets: 3, reps: 13, notes: "12\u201315." },
          ], cardio: { type: "Flat Walk", miles: 0.9, effort: "Very Easy", notes: "15 min flat." } },
          { id: "pm", label: "PM", title: "Evening Edition \u2014 Quad Pump", timeOfDay: "evening", emphasis: "Machines only, nowhere near Wednesday's loads", lifting: [
            { name: "Leg Extension", sets: 3, reps: 17, notes: "15\u201320, pump only." },
            { name: "Leg Press Light", sets: 3, reps: 17, notes: "15\u201320, high-rep." },
            { name: "Machine Lateral Raise", sets: 3, reps: 17, notes: "15\u201320 \u2014 the weekly side-delt sprinkle." },
          ], cardio: { type: "Incline Walk", miles: 1.8, effort: "Very Easy", notes: "30 min." } },
        ],
      },
      Sunday: {
        type: "The Engine Day", code: "AM/PM", lifting: [], cardio: null,
        sessions: [
          { id: "am", label: "AM", title: "The Long Run", timeOfDay: "morning", emphasis: "Endurance keystone \u2014 no lifting", lifting: [], cardio: { type: "Long Zone 2 Run", miles: 8, effort: "Easy", notes: "60\u201375 min, fully conversational the whole way. Where the engine lives." } },
          { id: "pm", label: "PM", title: "The Long Walk", timeOfDay: "evening", emphasis: "Recovery, steps, sun", lifting: [], cardio: { type: "Long Walk", miles: 2.5, effort: "Very Easy", notes: "45\u201360 min outdoors." } },
        ],
      },
    },
  },
  raceEdition50k: {
    id: "raceEdition50k",
    name: "The Race Edition — 50K Build",
    desc: "Five-week emergency build to a 50K for a lifter with an engine and almost no run base. Survival architecture: run/walk from the first interval, back-to-back weekend sessions, time caps over distance, fueling trained like a lift. Lifting drops to two upper days + calves — heavy leg work is an injury tax this block can't afford. Tuesday/Saturday/Sunday auto-advance weekly via the race-build resolver (race 8/28); race week renders itself, including RACE DAY on Friday.",
    tags: ["Race Build", "50K", "Ultra", "Run/Walk", "B2B", "5 Weeks"],
    program: {
      __raceBuild: "raceBuild50k",
      Monday: { type:"Full Rest", code:"REST", lifting:[], cardio:null },
      Tuesday: { type:"Easy Run", code:"EASY", lifting:[], cardio:{type:"Easy Run",miles:4.5,effort:"Easy",notes:"40 min conversational. No speed anywhere in this build — a 50K is a durability and fueling problem, not a VO2 problem."} },
      Wednesday: { type:"Pull — Maintenance", code:"PULL", cardio:null, lifting:[
        {name:"Weighted Pull-Up",sets:3,reps:6,notes:"Keep the load, trim the sets. 1–2 RIR — strength stays, fatigue goes."},
        {name:"Barbell Row",sets:3,reps:8,notes:"6–8 crisp reps. No grinders anywhere in this block."},
        {name:"Neutral-Grip Lat Pulldown",sets:2,reps:10,notes:"8–10. Full stretch, drive elbows down."},
        {name:"Chest-Supported Row",sets:2,reps:12,notes:"10–12. Zero torso momentum."},
        {name:"EZ-Bar Curl",sets:2,reps:10,notes:"8–12."},
        {name:"Standing Calf Raise",sets:3,reps:12,notes:"10–15 with pauses. Calves carry the 50K — they live here now."},
      ]},
      Thursday: { type:"Easy Zone 2 Run", code:"ZONE 2", lifting:[], cardio:{type:"Easy Run",miles:3.5,effort:"Easy",notes:"30–45 min fully conversational. Readiness gate: HRV suppressed + RHR elevated 2–3 straight days → this becomes a rest day, no negotiation."} },
      Friday: { type:"Push + Arms — Maintenance", code:"PUSH", cardio:null, lifting:[
        {name:"Incline Smith Press",sets:3,reps:8,notes:"6–8. Keep the load, cut the sets. Upper only — the long session is tomorrow."},
        {name:"Machine Chest Press",sets:2,reps:10,notes:"8–12, controlled eccentric."},
        {name:"Seated Shoulder Press",sets:2,reps:10,notes:"8–12. Stop well before breakdown."},
        {name:"Cable Lateral Raise",sets:3,reps:15,notes:"12–20 strict."},
        {name:"Rope Pushdown",sets:2,reps:12,notes:"10–15."},
      ]},
      Saturday: { type:"The Long Session", code:"LONG", lifting:[], cardio:{type:"Long Run/Walk",miles:6.2,effort:"Easy",notes:"10k on 3 min run / 2 min walk from the very first interval. Cap 90 min. Fueling starts NOW: 30–60g carbs/hr — gut training is half this race."} },
      Sunday: { type:"Back-to-Back Walk", code:"B2B", lifting:[], cardio:{type:"B2B Walk",miles:3,effort:"Very Easy",notes:"60 min brisk walk on yesterday's legs — the second half of the weekend block. Zone 1, podcast pace."} },
    },
  },
  bodybuilding: {
    id: "bodybuilding",
    name: "Bodybuilding",
    desc: "Classic bro split. High volume per muscle group, 5 days.",
    tags: ["Hypertrophy", "Volume", "Aesthetics"],
    program: {
      Monday:    { type:"Chest Day",           code:"CHEST",    lifting:[{name:"Barbell Bench Press",sets:4,reps:8},{name:"Incline DB Press",sets:3,reps:10},{name:"Cable Fly",sets:3,reps:12},{name:"Dips",sets:3,reps:12},{name:"Pushdowns",sets:3,reps:15}], cardio:null },
      Tuesday:   { type:"Back Day",            code:"BACK",     lifting:[{name:"Deadlift",sets:4,reps:6},{name:"Barbell Row",sets:4,reps:8},{name:"Lat Pulldown",sets:3,reps:10},{name:"Cable Row",sets:3,reps:12},{name:"Face Pulls",sets:3,reps:15}], cardio:null },
      Wednesday: { type:"Shoulder Day",        code:"SHOULDERS",lifting:[{name:"Seated DB Press",sets:4,reps:8},{name:"Lateral Raises",sets:4,reps:12},{name:"Front Raises",sets:3,reps:12},{name:"Rear Delt Fly",sets:3,reps:15},{name:"Shrugs",sets:3,reps:12}], cardio:null },
      Thursday:  { type:"Rest",                code:"REST",     lifting:[], cardio:null },
      Friday:    { type:"Legs Day",            code:"LEGS",     lifting:[{name:"Squat",sets:4,reps:8},{name:"Leg Press",sets:3,reps:10},{name:"Romanian Deadlift",sets:3,reps:10},{name:"Leg Curl",sets:3,reps:12},{name:"Calf Raises",sets:4,reps:15}], cardio:null },
      Saturday:  { type:"Arms Day",            code:"ARMS",     lifting:[{name:"Barbell Curl",sets:4,reps:10},{name:"Incline DB Curl",sets:3,reps:12},{name:"Hammer Curls",sets:3,reps:12},{name:"Skull Crushers",sets:4,reps:10},{name:"Tricep Pushdowns",sets:3,reps:12},{name:"Overhead Extension",sets:3,reps:12}], cardio:null },
      Sunday:    { type:"Rest",                code:"REST",     lifting:[], cardio:null },
    },
  },
  powerlifting: {
    id: "powerlifting",
    name: "Powerlifting",
    desc: "Squat, bench, deadlift and accessories. 4 days, heavy.",
    tags: ["Strength", "Heavy", "Competition"],
    program: {
      Monday:    { type:"Squat Focus",         code:"SQUAT",    lifting:[{name:"Back Squat",sets:5,reps:3},{name:"Romanian Deadlift",sets:3,reps:5},{name:"Leg Press",sets:3,reps:8},{name:"Walking Lunges",sets:3,reps:8},{name:"Leg Curl",sets:3,reps:10}], cardio:null },
      Tuesday:   { type:"Bench Focus",         code:"BENCH",    lifting:[{name:"Barbell Bench Press",sets:5,reps:3},{name:"Close Grip Bench",sets:3,reps:5},{name:"DB Press",sets:3,reps:8},{name:"Tricep Pushdowns",sets:3,reps:10},{name:"Lateral Raises",sets:3,reps:12}], cardio:null },
      Wednesday: { type:"Rest",                code:"REST",     lifting:[], cardio:null },
      Thursday:  { type:"Deadlift Focus",      code:"DEAD",     lifting:[{name:"Conventional Deadlift",sets:5,reps:3},{name:"Deficit Deadlift",sets:3,reps:5},{name:"Barbell Row",sets:3,reps:6},{name:"Lat Pulldown",sets:3,reps:8},{name:"Face Pulls",sets:3,reps:15}], cardio:null },
      Friday:    { type:"Overhead & Accessory",code:"OHP",      lifting:[{name:"Overhead Press",sets:4,reps:5},{name:"Seated DB Press",sets:3,reps:8},{name:"Barbell Curl",sets:3,reps:8},{name:"Skull Crushers",sets:3,reps:10},{name:"Core Work",sets:3,reps:15}], cardio:null },
      Saturday:  { type:"Rest",                code:"REST",     lifting:[], cardio:null },
      Sunday:    { type:"Rest",                code:"REST",     lifting:[], cardio:null },
    },
  },
  running: {
    id: "running",
    name: "Running Focus",
    desc: "Race training with strength support. 3 runs + 2 lift days.",
    tags: ["Cardio", "Endurance", "5K/10K"],
    program: {
      Monday:    { type:"Easy Run",            code:"EASY",     lifting:[], cardio:{type:"Easy Run",miles:4,effort:"Zone 2",notes:"Conversational pace. Base building."} },
      Tuesday:   { type:"Full Body Strength",  code:"LIFT",     lifting:[{name:"Squat",sets:3,reps:8},{name:"Romanian Deadlift",sets:3,reps:8},{name:"Bench Press",sets:3,reps:8},{name:"Barbell Row",sets:3,reps:8},{name:"Core Plank",sets:3,reps:60}], cardio:null },
      Wednesday: { type:"Tempo Run",           code:"TEMPO",    lifting:[], cardio:{type:"Tempo Run",miles:4,effort:"85%",notes:"Comfortably hard. 1mi warm-up, 2mi tempo, 1mi cool-down."} },
      Thursday:  { type:"Rest / Cross Train",  code:"REST",     lifting:[], cardio:null },
      Friday:    { type:"Full Body Strength",  code:"LIFT",     lifting:[{name:"Deadlift",sets:3,reps:6},{name:"Pull-Ups",sets:3,reps:8},{name:"DB Lunges",sets:3,reps:10},{name:"Shoulder Press",sets:3,reps:8},{name:"Calf Raises",sets:3,reps:15}], cardio:null },
      Saturday:  { type:"Long Run",            code:"LONG",     lifting:[], cardio:{type:"Long Run",miles:8,effort:"Zone 2",notes:"Easy conversational pace. This is your weekly mileage anchor."} },
      Sunday:    { type:"Rest",                code:"REST",     lifting:[], cardio:null },
    },
  },
  beginner: {
    id: "beginner",
    name: "Beginner Full Body",
    desc: "3 days per week. Squat, hinge, push, pull — the fundamentals.",
    tags: ["Beginner", "Full Body", "3 Days"],
    program: {
      Monday:    { type:"Full Body A",         code:"LIFT A",   lifting:[{name:"Squat",sets:3,reps:8},{name:"Bench Press",sets:3,reps:8},{name:"Barbell Row",sets:3,reps:8},{name:"Overhead Press",sets:3,reps:8},{name:"Plank",sets:3,reps:45}], cardio:{type:"Easy Walk/Run",miles:1.5,effort:"Light",notes:"Light cardio to finish — walk or easy jog."} },
      Tuesday:   { type:"Rest",                code:"REST",     lifting:[], cardio:null },
      Wednesday: { type:"Full Body B",         code:"LIFT B",   lifting:[{name:"Deadlift",sets:3,reps:6},{name:"Incline DB Press",sets:3,reps:10},{name:"Lat Pulldown",sets:3,reps:10},{name:"DB Lunges",sets:3,reps:10},{name:"Calf Raises",sets:3,reps:15}], cardio:{type:"Easy Walk/Run",miles:1.5,effort:"Light",notes:"Light cardio to finish."} },
      Thursday:  { type:"Rest",                code:"REST",     lifting:[], cardio:null },
      Friday:    { type:"Full Body C",         code:"LIFT C",   lifting:[{name:"Goblet Squat",sets:3,reps:10},{name:"Push-Ups",sets:3,reps:12},{name:"DB Row",sets:3,reps:10},{name:"Romanian Deadlift",sets:3,reps:10},{name:"Core Work",sets:3,reps:15}], cardio:{type:"Easy Walk/Run",miles:1.5,effort:"Light",notes:"Light cardio to finish."} },
      Saturday:  { type:"Active Recovery",     code:"ACTIVE",   lifting:[], cardio:{type:"Easy Walk",miles:2,effort:"Very Light",notes:"Optional — light walk or stretching only."} },
      Sunday:    { type:"Rest",                code:"REST",     lifting:[], cardio:null },
    },
  },
  calisthenics: {
    id: "calisthenics",
    name: "Calisthenics — Absolute Beginner",
    desc: "No equipment needed. Build strength from zero using only your bodyweight. 3 days per week, short sessions, full rest between.",
    tags: ["Beginner", "Bodyweight", "No Equipment"],
    program: {
      Monday:    { type:"Push Day",            code:"PUSH",     lifting:[
        {name:"Incline Push-Ups",       sets:3, reps:10, notes:"Hands on a counter or bench — easier than floor."},
        {name:"Wall Sit",               sets:3, reps:30, notes:"Hold 30 seconds. Thighs parallel to floor."},
        {name:"Shoulder Taps",          sets:3, reps:10, notes:"In push-up position, tap opposite shoulder. Counts each side."},
        {name:"Glute Bridges",          sets:3, reps:12, notes:"Lie on back, feet flat, drive hips up. Squeeze at the top."},
        {name:"Dead Bug",               sets:3, reps:8,  notes:"Slow and controlled. Lower opposite arm/leg together."},
      ], cardio:{type:"Brisk Walk",miles:1,effort:"Easy",notes:"10–15 minute walk to finish. Focus on breathing."} },
      Tuesday:   { type:"Rest",                code:"REST",     lifting:[], cardio:null },
      Wednesday: { type:"Pull & Hinge Day",    code:"PULL",     lifting:[
        {name:"Australian Pull-Ups",    sets:3, reps:8,  notes:"Lie under a table edge, pull chest to it. Angle your body to adjust difficulty."},
        {name:"Good Mornings",          sets:3, reps:12, notes:"Hands behind head, hinge at the hip, slight knee bend. Feel the hamstrings."},
        {name:"Reverse Lunges",         sets:3, reps:8,  notes:"Step backward, not forward — much easier on the knees."},
        {name:"Superman Hold",          sets:3, reps:10, notes:"Lie face down, lift arms and chest slightly. Hold 2 seconds each."},
        {name:"Plank",                  sets:3, reps:20, notes:"Hold 20 seconds. Elbows under shoulders, flat back, don't hold your breath."},
      ], cardio:{type:"Brisk Walk",miles:1,effort:"Easy",notes:"10–15 minute walk. Keep it comfortable."} },
      Thursday:  { type:"Rest",                code:"REST",     lifting:[], cardio:null },
      Friday:    { type:"Full Body Day",       code:"FULL",     lifting:[
        {name:"Squat (bodyweight)",     sets:3, reps:12, notes:"Feet shoulder-width, toes slightly out. Sit back into it, keep chest up."},
        {name:"Push-Ups (floor)",       sets:3, reps:6,  notes:"If 6 is too many, go back to incline for now. Never sacrifice form."},
        {name:"Step-Ups",               sets:3, reps:10, notes:"Use a sturdy chair or low step. Drive through the heel of the lead foot."},
        {name:"Scapular Rows",          sets:3, reps:10, notes:"Arms out in front, pinch shoulder blades together. Can use a resistance band."},
        {name:"Hollow Body Hold",       sets:3, reps:15, notes:"Lie on back, lower back pressed to floor, legs slightly lifted. Hold 15 sec."},
      ], cardio:{type:"Brisk Walk",miles:1.5,effort:"Easy",notes:"Slightly longer walk today — you've earned it."} },
      Saturday:  { type:"Active Recovery",     code:"ACTIVE",   lifting:[], cardio:{type:"Easy Walk",miles:1,effort:"Very Light",notes:"Optional. Just move — 10 minutes of walking is enough."} },
      Sunday:    { type:"Rest",                code:"REST",     lifting:[], cardio:null },
    },
  },
};
