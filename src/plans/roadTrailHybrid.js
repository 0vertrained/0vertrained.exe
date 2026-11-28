import { alignmentOn, validDateKey } from "./hybridAlignmentDates.js";
import { shiftDate } from "../coachWindows.js";
import { samePrescription } from "../programSessions.js";
import { WEEK_DAYS, weekdayOf, weekStartOf } from "../weekMoves.js";

const id = "roadTrailHybrid";
const easy = "Conversational · RPE 3–4/10";
export const ROAD_TRAIL_TARGETS = {
  road10k: { name: "Road 10K", distance: "10k", miles: 6.21, surface: "road" },
  trail10k: { name: "Trail 10K", distance: "10k", miles: 6.21, surface: "trail" },
  trail15k: { name: "Trail 15K", distance: "15k", miles: 9.32, surface: "trail" },
};

// Run targets include warm-up, recoveries between repeats and cool-down.
// All durations are minutes. Race day has a distance goal instead.
export const ROAD_TRAIL_WEEKS = [
  { phase: "Foundation",    mon: 30, quality: { terrain: "road", reps: 3, work: 6 }, wed: 35, fri: 25, long: 65, sets: 1 },
  { phase: "Build",         mon: 35, quality: { terrain: "hill", reps: 6, work: 2 }, wed: 35, fri: 25, long: 75, sets: 1 },
  { phase: "Build",         mon: 35, quality: { terrain: "road", reps: 4, work: 6 }, wed: 40, fri: 30, long: 80, sets: 1 },
  { phase: "Cutback",       mon: 25, quality: { terrain: "easy", minutes: 30 },       wed: 25, fri: 20, long: 55, sets: 0.55, reserve: 3 },
  { phase: "Race-specific", mon: 35, quality: { terrain: "hill", reps: 6, work: 3 }, wed: 40, fri: 30, long: 80, sets: 1 },
  { phase: "Race-specific", mon: 35, quality: { terrain: "road", reps: 4, work: 7 }, wed: 45, fri: 35, long: 90, sets: 1 },
  { phase: "Taper",         mon: 25, quality: { terrain: "road", reps: 3, work: 4 }, wed: 30, fri: 20, long: 55, sets: 0.6, reserve: 3 },
  { phase: "Race week",     mon: 20, quality: { terrain: "road", reps: 3, work: 2 }, wed: 20, fri: 15, race: true, sets: 0.35, reserve: 4 },
];

function lift(name, sets, repMin, reps, restSeconds, rir, notes) {
  return { name, sets, repMin, reps, restSeconds, rir, progressionExposures: 2, notes };
}
const upperStrength = [
  lift("Barbell Bench Press", 4, 4, 6, 180, 2, "Use a spotter or safeties. Warm up in steps and keep the same touch point on every working rep."),
  lift("Chest-Supported Row", 4, 6, 9, 150, 2, "Keep your chest against the pad and bring each handle to the lower ribs."),
  lift("Incline DB Press", 3, 8, 10, 150, 2, "Use a modest incline. Lower to a repeatable depth, then press without bouncing."),
  lift("Lat Pulldown", 3, 8, 12, 120, 2, "Keep the torso steady. Drive elbows down and let the lats lengthen at the top."),
  lift("Cable Lateral Raise", 3, 12, 18, 75, 1, "Lead with the elbow. Stop when the torso has to swing to lift the handle."),
  lift("Hammer Curl", 2, 8, 12, 90, 1, "Use a neutral grip. Lower under control and keep the upper arms still."),
  lift("Overhead Cable Triceps Extension", 2, 10, 15, 90, 1, "Brace against the cable and let the elbows bend into a comfortable stretch."),
];
const squatStrength = [
  lift("Back Squat", 4, 3, 5, 210, 2, "Set the safety bars, ramp up, then use the same depth on every rep. If the morning run was unusually hard, keep the previous load."),
  lift("Leg Press", 3, 8, 12, 150, 2, "Choose a foot position that keeps your heels planted and pelvis on the pad."),
  lift("Lying Leg Curl", 3, 8, 12, 120, 2, "Keep the hips down and lower through your full comfortable range."),
  lift("Standing Calf Raise", 3, 8, 12, 90, 2, "Pause at the bottom and rise fully without bouncing."),
];
const posteriorStrength = [
  lift("Romanian Deadlift", 4, 5, 7, 180, 2, "Brace before each rep. Hinge until your hamstrings limit the range, then stand tall."),
  lift("Hack Squat", 3, 8, 10, 150, 2, "Set the stops, stay supported and repeat the same depth under control."),
  lift("Bulgarian Split Squat", 2, 8, 10, 120, 2, "Reps per leg. Rest the rear foot on a low bench and hold dumbbells at your sides. Keep the front foot planted."),
  lift("Seated Leg Curl", 3, 10, 15, 90, 2, "Keep your thighs under the pad, then return slowly to the extended position."),
  lift("Seated Calf Raise", 3, 12, 18, 90, 2, "Pause at full stretch and at the top. Keep the knee bent throughout."),
];
const upperHypertrophy = [
  lift("Plate-Loaded Incline Press", 3, 6, 8, 180, 2, "Set the seat so the handles begin at upper-chest height. Keep the depth consistent as load increases."),
  lift("Cable Row", 3, 8, 12, 120, 2, "Keep your trunk quiet. Reach forward, then bring the handle to the lower ribs."),
  lift("Pec Deck", 2, 10, 15, 90, 1, "Keep a soft elbow and stop where the shoulders remain comfortable."),
  lift("Single-Arm Lat Pulldown", 3, 8, 12, 120, 2, "Reps per side. Pull the elbow toward the ribs, then reach overhead under control."),
  lift("Seated DB Press", 2, 8, 12, 120, 2, "Brace against the backrest and press without extending the lower back."),
  lift("Rear Delt Fly", 2, 12, 20, 75, 1, "Use light dumbbells and support the chest on an incline bench. Open the arms without lifting the shoulders."),
  lift("Machine Preacher Curl", 3, 8, 12, 90, 1, "Keep your upper arms supported. Use a load you can lower smoothly."),
  lift("Triceps Pushdown", 3, 10, 15, 75, 1, "Keep the elbows by your sides. Finish each rep with control at full extension."),
];

const rest = (type = "Full rest") => ({ type, code: "REST", lifting: [], cardio: null });
function steady(type, minutes, notes, modality = "run") {
  return { type, modality, minutes, miles: 0, effort: easy, notes, steps: [{ kind: "steady", minutes, intensity: "easy" }] };
}
function qualityRun(quality) {
  if (quality.terrain === "easy") return steady("Easy road run", quality.minutes, "Use a flat route and keep the entire run conversational during the cutback.");
  const { reps, work } = quality;
  const uphill = quality.terrain === "hill";
  const minutes = 12 + reps * work + (reps - 1) * 2 + 8;
  const route = uphill
    ? "Find a smooth, moderate incline. Climb at a repeatable effort and walk or jog back gently."
    : "Choose a level road or track. Find a comfortably hard rhythm you can hold across every repetition.";
  return { type: uphill ? "Uphill intervals" : "Road threshold intervals", miles: 0, modality: "run", minutes,
    effort: "Controlled hard · RPE 7–8/10",
    notes: `Warm up for 12 minutes. Run ${reps} × ${work} minutes with 2 minutes easy between efforts. ${route} Cool down for 8 minutes.`,
    steps: [
      { kind: "warmup", minutes: 12, intensity: "easy" },
      { kind: "repeat", reps, work: { minutes: work, intensity: uphill ? "interval" : "threshold" }, recovery: { minutes: 2, intensity: "jog" } },
      { kind: "cooldown", minutes: 8, intensity: "easy" },
    ],
  };
}
function weekendRun(week, target) {
  const trail = target.surface === "trail";
  if (week.race) return { type: target.name + " race or benchmark", modality: "run", miles: target.miles,
    planRole: "race", raceDistance: target.distance, raceSurface: target.surface,
    steps: [{ kind: "race", distance: target.distance }],
    effort: "Race effort · controlled start",
    notes: trail
      ? "Warm up separately. Race your chosen runnable trail course by effort, hike steep pitches early and keep control on descents. Without an event, use a familiar course of the same distance as a controlled benchmark."
      : "Warm up separately. Open the first kilometres at a pace you can sustain, then build effort over the final third if able. Without an event, use a measured road 10K as a controlled benchmark." };
  if (week.phase === "Race-specific" && !trail) return steady("Long road and trail run", week.long,
    "Start on a smooth rolling trail, then move to pavement for the final 20 minutes. Rehearse the road course’s turns and terrain while keeping the entire run conversational.");
  return steady("Long trail run", week.long, "Choose runnable trail with terrain resembling your target. Run at conversational effort, hike steep climbs and leave margin on descents. Keep the grade familiar when the duration rises.");
}
function runForDay(day, week, target = ROAD_TRAIL_TARGETS.road10k) {
  switch (day) {
    case "Monday": return steady("Easy road run", week.mon, "Use a flat route. Run at a full-sentence conversational effort after the upper-body session.");
    case "Tuesday": return qualityRun(week.quality);
    case "Wednesday": return steady("Easy trail skills", week.wed, "Choose familiar footing. Practice short, relaxed descents within this easy run. Start with gentle grades, walk steep sections and shorten the route if your quads still feel heavy.");
    case "Friday": return steady("Easy shakeout run", week.fri, "Keep this flat, short run easy enough to feel fresh for Saturday. Walk the first few minutes if stiff.");
    case "Saturday": return weekendRun(week, target);
    default: return null;
  }
}
function doubleDay(type, first, second) {
  return { type, code: "AM/PM", lifting: [], cardio: null, sessions: [
    { id: "am", label: "AM", timeOfDay: "morning", ...first },
    { id: "pm", label: "PM", timeOfDay: "evening", ...second },
  ] };
}
const first = ROAD_TRAIL_WEEKS[0];
const template = {
  Monday: doubleDay("Upper strength",
    { title: "Heavy upper body", lifting: upperStrength, cardio: null },
    { title: "Easy road run", lifting: [], cardio: runForDay("Monday", first) }),
  Tuesday: doubleDay("Lower strength",
    { title: "Road threshold intervals", lifting: [], cardio: runForDay("Tuesday", first) },
    { title: "Heavy squat", lifting: squatStrength, cardio: null }),
  Wednesday: { type: "Easy trail skills", code: "TRAIL", lifting: [], cardio: runForDay("Wednesday", first) },
  Thursday: { type: "Lower body · Posterior chain", code: "LOWER", lifting: posteriorStrength, cardio: null },
  Friday: doubleDay("Upper hypertrophy",
    { title: "Upper bodybuilding", lifting: upperHypertrophy, cardio: null },
    { title: "Easy shakeout run", lifting: [], cardio: runForDay("Friday", first) }),
  Saturday: { type: "Long trail run", code: "LONG", lifting: [], cardio: runForDay("Saturday", first) },
  Sunday: rest(),
};

export const ROAD_TRAIL_HYBRID = {
  id, name: "Road & Trail Hybrid",
  desc: "An eight-week block for experienced lifters and runners targeting a road 10K or runnable 10–15 km trail race. Four heavy bodybuilding sessions, five runs and three double days build toward race week with a cutback and taper.",
  tags: ["Advanced", "Heavy hypertrophy", "Road + trail", "8 weeks"],
  guide: {
    audience: "Start after at least four recent weeks tolerating roughly three hours across four to five runs, a 60-minute long run and three to four lifting days. A full first week combines 197 minutes of running with four gym sessions. Build those capacities separately first if either is new.",
    equipment: "A rack with safeties, barbell, adjustable bench, dumbbells, cables and leg machines. Use a measured road loop or track and access to a runnable trail or gradual hill.",
    progression: "Work within each rep range at the listed reps in reserve (RIR). After hitting the top on every set at the target effort on two visits, add the smallest load increment and return to the lower reps. Keep compounds about two reps from failure in the build. Allow about six hours between double sessions when practical.",
    recovery: "Week four reduces running and working sets. Weeks seven and eight taper the workload before Saturday’s race. If soreness changes your stride or key lifts decline twice, remove the Friday shakeout and trim one accessory set per exercise before progressing. Resume easy sessions after the event when recovered and choose the next block when ready.",
    sources: [
      { label: "Robineau et al. · Recovery between strength and endurance sessions", url: "https://pubmed.ncbi.nlm.nih.gov/25546450/" },
      { label: "Støren et al. · Heavy strength training and running economy", url: "https://pubmed.ncbi.nlm.nih.gov/18460997/" },
      { label: "Refalo et al. · Repetitions in reserve and muscle growth", url: "https://pubmed.ncbi.nlm.nih.gov/38393985/" },
      { label: "Esteve-Lanao et al. · Running intensity distribution", url: "https://pubmed.ncbi.nlm.nih.gov/17685689/" },
      { label: "Khassetarash et al. · Repeated downhill running", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9189713/" },
      { label: "Shepley et al. · Tapering in trained runners", url: "https://pubmed.ncbi.nlm.nih.gov/1559951/" },
    ],
  },
  program: { ...template, __hybridBlock: { id } },
};

export function startRoadTrailHybrid(program, dateKey, { raceTarget = program?.__hybridBlock?.raceTarget } = {}) {
  const marker = program?.__hybridBlock;
  if (marker?.id !== id || !validDateKey(dateKey)) return program;
  const target = Object.hasOwn(ROAD_TRAIL_TARGETS, raceTarget) ? raceTarget : "road10k";
  return { ...program, __hybridBlock: { ...marker, startDate: dateKey, startMonday: weekStartOf(dateKey), raceTarget: target } };
}

const dayMs = 86_400_000;

function blockCalendar(program) {
  const marker = program?.__hybridBlock;
  if (marker?.id !== id) return null;
  const legacy = !Object.hasOwn(marker, "startDate");
  const startDate = legacy ? marker.startMonday : marker.startDate;
  if (!validDateKey(startDate)) return null;
  const startMonday = weekStartOf(startDate);
  if (legacy && startMonday !== startDate) return null;
  return {
    startDate, startMonday,
    baselineRaceDate: shiftDate(startMonday, 7 * ROAD_TRAIL_WEEKS.length - 2),
    raceTarget: Object.hasOwn(ROAD_TRAIL_TARGETS, marker.raceTarget) ? marker.raceTarget : "road10k",
    marker,
  };
}

function weeksBetween(monday, otherMonday) {
  return (Date.parse(otherMonday) - Date.parse(monday)) / (7 * dayMs);
}

// Keep the normal four-week loading cycle when the event is further away.
// The last two build weeks lead into the taper. Do not add a cutback
// immediately before the taper just because the race moved.
function alignedStrengthWeek(weekNumber, totalWeeks) {
  const remaining = totalWeeks - weekNumber;
  if (remaining === 0) return 8;
  if (remaining === 1) return 7;
  if (weekNumber === 1) return 1;
  if (weekNumber % 4 === 0 && remaining > 2) return 4;
  if (remaining === 2) return 6;
  if (remaining === 3) return 5;
  return weekNumber % 2 === 0 ? 2 : 3;
}

function weekOn(calendar, dateKey, monday, revision = alignmentOn(calendar.marker, dateKey)) {
  const { startDate, startMonday, baselineRaceDate, raceTarget } = calendar;
  const raceDate = revision?.raceDate ?? baselineRaceDate;
  const totalWeeks = revision ? 1 + weeksBetween(startMonday, weekStartOf(raceDate)) : ROAD_TRAIL_WEEKS.length;
  const calendarWeek = 1 + weeksBetween(startMonday, monday);
  const completed = revision ? dateKey > raceDate : calendarWeek > totalWeeks;
  const weekNumber = dateKey < startDate ? 0 : completed ? totalWeeks + 1 : calendarWeek;
  const strengthWeek = revision && weekNumber > 0 && !completed ? alignedStrengthWeek(weekNumber, totalWeeks) : weekNumber;
  return {
    startDate, startMonday, baselineRaceDate, raceDate, raceTarget,
    raceName: (typeof revision?.raceName === "string" && revision.raceName.trim()) || ROAD_TRAIL_TARGETS[raceTarget].name,
    aligned: Boolean(revision),
    weekNumber, totalWeeks, completed, strengthWeek,
    phase: !weekNumber ? "Upcoming" : completed ? "Recovery" : ROAD_TRAIL_WEEKS[strengthWeek - 1].phase,
  };
}

export function describeRoadTrailWeek(program, dateKey) {
  const calendar = blockCalendar(program);
  return calendar && validDateKey(dateKey) ? weekOn(calendar, dateKey, weekStartOf(dateKey)) : null;
}

// Map the saved template to the dated prescription. Recognize the original
// cardio by its actual fields, including steps after JSONB reorders keys.
// An edited or removed run remains the athlete's own prescription.
function trainingDay(day, saved, week, target, {
  omitLifting = week.race && (day === "Thursday" || day === "Friday"),
  runWeek = week, omitBenchmark = false,
} = {}) {
  const base = template[day];
  const originalRun = base.cardio || base.sessions?.find(s => s.cardio)?.cardio;
  const prescribe = slot => {
    let cardio = slot.cardio;
    if (originalRun && samePrescription(cardio, originalRun)) {
      cardio = runWeek ? runForDay(day, runWeek, target) : recoveryDay(day).cardio;
      if (omitBenchmark && cardio?.planRole === "race") cardio = null;
    } else if (!runWeek && slot === saved && !cardio) {
      cardio = recoveryDay(day).cardio;
    }
    let lifting = slot.lifting || [];
    if (omitLifting) lifting = [];
    else if (week.sets !== 1) lifting = lifting.map(ex => ({
      ...ex, sets: Math.max(1, Math.round(ex.sets * week.sets)), rir: Math.max(ex.rir ?? 2, week.reserve),
    }));
    const title = slot.title && slot.title === slot.cardio?.type && cardio ? cardio.type : slot.title;
    return { ...slot, ...(title ? { title } : {}), lifting, cardio };
  };
  if (saved.sessions?.length) {
    const sessions = saved.sessions.map(prescribe).filter(s => s.lifting.length || s.cardio);
    if (!sessions.length) return rest();
    const type = saved.type === base.type && sessions.length === 1 ? sessions[0].title : saved.type;
    return { ...saved, type, sessions };
  }
  const next = prescribe(saved);
  if (!next.lifting.length && !next.cardio) return saved.lifting?.length || saved.cardio ? rest() : next;
  if (!next.lifting.length && next.cardio && saved.type === base.type) return { ...next, type: next.cardio.type, code: next.cardio.planRole === "race" ? "RACE" : next.code };
  return next;
}
function recoveryDay(day) {
  if (day === "Tuesday" || day === "Thursday" || day === "Saturday") {
    const walk = day === "Saturday";
    const type = walk ? "Optional recovery walk" : "Optional easy return";
    const cardio = steady(type, walk ? 30 : day === "Tuesday" ? 20 : 25,
      "Resume when ordinary walking and stairs are comfortable. Stay on level ground and skip this session if soreness changes your movement.", walk ? "walk" : "run");
    return { type, code: "EASY", lifting: [], cardio };
  }
  return rest();
}
function prescribeWeek(program, weekNumber, raceTarget, firstDay = 0) {
  const target = ROAD_TRAIL_TARGETS[raceTarget] ?? ROAD_TRAIL_TARGETS.road10k;
  const next = { ...program };
  const week = ROAD_TRAIL_WEEKS[weekNumber - 1];
  for (const [index, day] of WEEK_DAYS.entries()) {
    if (weekNumber < 1 || index < firstDay) next[day] = rest("Before the block");
    else if (!week) next[day] = recoveryDay(day);
    else if (program[day]) next[day] = trainingDay(day, program[day], week, target);
  }
  return next;
}
export function roadTrailWeekProgram(weekNumber, raceTarget = "road10k") {
  return prescribeWeek(template, weekNumber, raceTarget);
}
export function resolveRoadTrailWeek(program, dateKey, revisionDate = null) {
  const calendar = blockCalendar(program);
  if (!calendar || !validDateKey(dateKey)) return program;
  const monday = weekStartOf(dateKey);
  const calendarWeek = 1 + weeksBetween(calendar.startMonday, monday);
  const revision = revisionDate ? alignmentOn(calendar.marker, revisionDate) : undefined;
  if (!calendar.marker.alignments?.length || revision === null) {
    const firstDay = monday === calendar.startMonday ? WEEK_DAYS.indexOf(weekdayOf(calendar.startDate)) : 0;
    return prescribeWeek(program, calendarWeek, calendar.raceTarget, firstDay);
  }

  const result = { ...program };
  const target = ROAD_TRAIL_TARGETS[calendar.raceTarget];
  for (const [index, day] of WEEK_DAYS.entries()) {
    const key = shiftDate(monday, index);
    const info = weekOn(calendar, key, monday, revision);
    if (!info.weekNumber) result[day] = rest("Before the block");
    else if (info.completed) result[day] = info.aligned && key === shiftDate(info.raceDate, 1) ? rest() : recoveryDay(day);
    else if (program[day]) {
      const strengthWeek = ROAD_TRAIL_WEEKS[info.strengthWeek - 1];
      // The generated race calendar overlays its own runs. Outside that window
      // the block keeps its original running dose and never adds a second race.
      const options = info.aligned ? {
        omitLifting: key >= shiftDate(info.raceDate, -2),
        runWeek: ROAD_TRAIL_WEEKS[calendarWeek - 1] || null,
        omitBenchmark: true,
      } : undefined;
      result[day] = trainingDay(day, program[day], strengthWeek, target, options);
    }
  }
  return result;
}
