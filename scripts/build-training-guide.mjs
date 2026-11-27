import { readFile, writeFile } from "node:fs/promises";
import { RESISTANCE_PRESETS } from "../src/plans/resistance.js";
import { MIXED_PLANS } from "../src/plans/mixed.js";
import { ROAD_TRAIL_HYBRID, ROAD_TRAIL_TARGETS, ROAD_TRAIL_WEEKS, roadTrailWeekProgram } from "../src/plans/roadTrailHybrid.js";
import { WEEK_DAYS } from "../src/weekMoves.js";
import { getProgramSessions, usesProgramSessions } from "../src/programSessions.js";

import { EXERCISES, EQUIPMENT_LABELS, MOVEMENT_LABELS, CARDIO_SESSIONS, exercisePrescription } from "../src/programExerciseLibrary.js";
import { resolveTrackingMode, TRACKING_MODES } from "../src/workoutLogging.js";

const plans = { ...RESISTANCE_PRESETS, ...MIXED_PLANS, [ROAD_TRAIL_HYBRID.id]: ROAD_TRAIL_HYBRID };
const path = new URL("../public/training-guide.html", import.meta.url);
const html = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function session(dayName, day, title) {
  const rows = day.lifting.map(ex => {
    const hold = ex.trackingMode === "timed_hold";
    const range = ex.repMin === ex.reps ? ex.reps : `${ex.repMin}–${ex.reps}`;
    const effort = ex.rir == null ? "" : ` · ${ex.rir} RIR`;
    return `<tr><th scope="row">${html(ex.name)}</th><td>${ex.sets} × ${range}${hold ? " s" : ""}</td><td>${ex.restSeconds} s${effort}</td></tr>`;
  }).join("\n");
  const table = rows && `<table><caption class="sr">Work sets for ${html(dayName)}</caption><thead><tr><th>Exercise</th><th>Sets × target</th><th>Rest &amp; effort</th></tr></thead><tbody>${rows}</tbody></table>`;
  const { cardio } = day;
  const endurance = cardio ? `<p><b>${html(cardio.minutes ? cardio.minutes + " min" : cardio.miles + " mi")} · ${html(cardio.effort)}</b><br>${html(cardio.notes)}</p>` : "";
  const technique = day.lifting.length ? `<details><summary>Exercise cues</summary><ul>${day.lifting.map(ex => `<li><b>${html(ex.name)}.</b> ${html(ex.notes)}</li>`).join("")}</ul></details>` : "";
  return `<section class="session"><h4>${html(dayName)} · ${html(title)}</h4>${day.notes ? `<p>${html(day.notes)}</p>` : ""}${table}${endurance}${technique}</section>`;
}

function sessionsInWeek(program) {
  return WEEK_DAYS.flatMap(dayName =>
    getProgramSessions(program[dayName]).map(workout => ({
      dayName,
      workout,
      title: usesProgramSessions(program[dayName]) ? `${workout.label} · ${workout.title}` : workout.title,
    }))
  );
}

function weeklyDose(entries) {
  const sets = entries.flatMap(({ workout }) => workout.lifting).reduce((n, ex) => n + ex.sets, 0);
  const minutes = entries.reduce((n, { workout }) => n + (workout.cardio?.minutes || 0), 0);
  return { sets, minutes };
}

function raceBlock() {
  const targets = new Intl.ListFormat("en", { type: "disjunction" }).format(Object.values(ROAD_TRAIL_TARGETS).map(target => target.name));
  const rows = ROAD_TRAIL_WEEKS.map(({ phase }, index) => {
    const entries = sessionsInWeek(roadTrailWeekProgram(index + 1));
    const { sets, minutes } = weeklyDose(entries);
    const race = entries.some(({ workout }) => workout.cardio?.miles > 0 && !workout.cardio.minutes);
    const quality = entries.find(({ dayName, workout }) => dayName === "Tuesday" && workout.cardio)?.workout.cardio;
    const long = entries.find(({ dayName, workout }) => dayName === "Saturday" && workout.cardio)?.workout.cardio;
    const reps = quality?.steps?.find(step => step.kind === "repeat");
    const qualityCue = reps ? `${quality.type} · ${reps.reps} × ${reps.work.minutes} min` : quality?.type;
    return `<tr><th scope="row">${index + 1} · ${html(phase)}</th><td>${sets}</td><td>${minutes} min${race ? " + race" : ""}</td><td>${html(qualityCue || "Rest")}</td><td>${race ? "Race" : long ? `${long.minutes} min` : "Rest"}</td></tr>`;
  });
  return `<h4>Eight weeks to race day</h4>
<p>Choose <b>${html(targets)}</b> under Hybrid race target, then choose your start date. New blocks default to today. You begin with that weekday’s workouts. Earlier sessions in the first week are skipped, and week two begins the following Monday. The hybrid calendar uses your chosen distance for race day on the phone and Apple Watch. In weeks five and six the road plan finishes Saturday’s long run with 20 easy minutes on pavement. Both trail plans keep Saturday on runnable terrain similar to the course.</p>
<p>If you already have a dated race plan, choose which running calendar to use when loading this block. Keeping the existing race plan uses its runs during its scheduled weeks. The hybrid lifting taper still follows your chosen start date.</p>
<table><caption class="sr">Weekly working sets, running minutes, Tuesday quality and Saturday long run</caption><thead><tr><th scope="col">Week</th><th scope="col">Lift sets</th><th scope="col">Run time</th><th scope="col">Tuesday work</th><th scope="col">Saturday</th></tr></thead><tbody>${rows.join("\n")}</tbody></table>
<p>Run time includes warm-ups, recovery between efforts and cool-downs. Saturday of week eight is race day on the hybrid calendar. Budget your race time in addition to the 85 pre-race minutes. After race week, use the recovery schedule when easy running feels comfortable again. Week one’s sessions are listed below. <a href="#road-trail-research">Read the evidence for lifting, doubles, trails and tapering.</a></p>`;
}

function renderPlan(id) {
  const { name, program, guide } = plans[id];
  const entries = sessionsInWeek(program);
  const activeDays = new Set(entries.map(({ dayName }) => dayName));
  const { sets, minutes } = weeklyDose(entries);
  const totals = [`${activeDays.size} training days`, entries.length > activeDays.size && `${entries.length} sessions`, sets && `${sets} work sets`, minutes && `${minutes} cardio minutes`].filter(Boolean).join(" · ");
  const off = WEEK_DAYS.filter(day => !activeDays.has(day));
  const links = guide.sources.map(source => `<a href="${html(source.url)}">${html(source.label)}</a>`).join(" · ");
  return `<article id="${id}"><p class="eyebrow">${totals}</p><h3>${html(name)}</h3>
<p>${html(guide.audience)}</p><p><b>Equipment.</b> ${html(guide.equipment)}</p>
${id === ROAD_TRAIL_HYBRID.id ? raceBlock() + "\n" : ""}${entries.map(({ dayName, workout, title }) => session(dayName, workout, title)).join("\n")}
<p><b>Rest days.</b> ${off.join(", ")}.</p>
<p><b>How to progress.</b> ${html(guide.progression)}</p><p><b>When to adjust.</b> ${html(guide.recovery)}</p>
<p class="refs">Studies behind this week · ${links}</p><a class="back" href="#choose">Back to plan finder ↑</a></article>`;
}

function renderCatalog() {
  const groups = Object.entries(EQUIPMENT_LABELS).flatMap(([equipment, label]) => {
    const movements = EXERCISES.filter(ex => ex.equipment === equipment);
    if (!movements.length) return [];
    const list = movements.map(ex => {
      const mode = resolveTrackingMode(exercisePrescription(ex.name));
      const unit = mode === TRACKING_MODES.TIMED_HOLD ? "s" : mode === TRACKING_MODES.CARRY ? "yd" : "reps";
      return `<li><b>${html(ex.name)}</b> · ${html(MOVEMENT_LABELS[ex.pattern])} · ${ex.defaultSets} × ${ex.defaultReps} ${unit}. ${html(ex.notes)}</li>`;
    }).join("\n");
    return `<details><summary>${html(label)} · ${movements.length} movements</summary><ul>${list}</ul></details>`;
  });
  const cardio = Object.values(CARDIO_SESSIONS).map(c => {
    const dose = c.defaultMinutes ? `${c.defaultMinutes} min` : `${c.defaultMiles} mi`;
    return `<li><b>${html(c.type)}</b> · ${dose} · ${html(c.effort)}. ${html(c.notes)}</li>`;
  }).join("\n");
  groups.push(`<details><summary>Cardio · ${Object.keys(CARDIO_SESSIONS).length} sessions</summary><ul>${cardio}</ul></details>`);
  return groups.join("\n");
}

function replaceGenerated(page, name, contents) {
  const start = `<!-- Generated ${name} start -->`;
  const end = `<!-- Generated ${name} end -->`;
  const begin = page.indexOf(start);
  const finish = page.indexOf(end);
  if (begin < 0 || finish < begin) throw new Error(`Missing generated ${name} boundaries`);
  return page.slice(0, begin + start.length) + "\n" + contents + "\n" + page.slice(finish);
}

const page = await readFile(path, "utf8");
const sections = [...page.matchAll(/<a class="pick" href="#(\w+)">/g)].map(match => match[1]);
if (new Set(sections).size !== Object.keys(plans).length || sections.length !== Object.keys(plans).length || sections.some(id => !plans[id])) {
  throw new Error("The plan finder must list each research preset once.");
}
const weeks = replaceGenerated(page, "weeks", sections.map(renderPlan).join("\n"));
const updated = replaceGenerated(weeks, "catalog", renderCatalog());
if (process.argv.includes("--check")) {
  if (page !== updated) throw new Error("Rebuild training-guide.html with npm run guide:build");
} else if (page !== updated) {
  await writeFile(path, updated);
}
