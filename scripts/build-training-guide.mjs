import { readFile, writeFile } from "node:fs/promises";
import { RESISTANCE_PRESETS } from "../src/plans/resistance.js";
import { MIXED_PLANS } from "../src/plans/mixed.js";

import { EXERCISES, EQUIPMENT_LABELS, MOVEMENT_LABELS, CARDIO_SESSIONS, exercisePrescription } from "../src/programExerciseLibrary.js";
import { resolveTrackingMode, TRACKING_MODES } from "../src/workoutLogging.js";

const plans = { ...RESISTANCE_PRESETS, ...MIXED_PLANS };
const path = new URL("../public/training-guide.html", import.meta.url);
const html = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function session(dayName, day) {
  const rows = day.lifting.map(ex => {
    const hold = ex.trackingMode === "timed_hold";
    const range = ex.repMin === ex.reps ? ex.reps : `${ex.repMin}–${ex.reps}`;
    const effort = ex.rir == null ? "" : ` · ${ex.rir} RIR`;
    return `<tr><th scope="row">${html(ex.name)}</th><td>${ex.sets} × ${range}${hold ? " s" : ""}</td><td>${ex.restSeconds} s${effort}</td></tr>`;
  }).join("\n");
  const table = rows && `<table><caption class="sr">Work sets for ${html(dayName)}</caption><thead><tr><th>Exercise</th><th>Sets × target</th><th>Rest &amp; effort</th></tr></thead><tbody>${rows}</tbody></table>`;
  const { cardio } = day;
  const endurance = cardio ? `<p><b>${cardio.minutes} min · ${html(cardio.effort)}</b><br>${html(cardio.notes)}</p>` : "";
  const technique = day.lifting.length ? `<details><summary>Exercise cues</summary><ul>${day.lifting.map(ex => `<li><b>${html(ex.name)}.</b> ${html(ex.notes)}</li>`).join("")}</ul></details>` : "";
  return `<section class="session"><h4>${html(dayName)} · ${html(day.type)}</h4>${table}${endurance}${technique}</section>`;
}

function renderPlan(id) {
  const { name, program, guide } = plans[id];
  const days = Object.entries(program);
  const active = days.filter(([, day]) => day.lifting.length || day.cardio);
  const sets = active.flatMap(([, day]) => day.lifting).reduce((n, ex) => n + ex.sets, 0);
  const minutes = active.reduce((n, [, day]) => n + (day.cardio?.minutes || 0), 0);
  const totals = [`${active.length} training days`, sets && `${sets} work sets`, minutes && `${minutes} cardio minutes`].filter(Boolean).join(" · ");
  const off = days.filter(([, day]) => !day.lifting.length && !day.cardio).map(([day]) => day);
  const links = guide.sources.map(source => `<a href="${html(source.url)}">${html(source.label)}</a>`).join(" · ");
  return `<article id="${id}"><p class="eyebrow">${totals}</p><h3>${html(name)}</h3>
<p>${html(guide.audience)}</p><p><b>Equipment.</b> ${html(guide.equipment)}</p>
${active.map(([dayName, day]) => session(dayName, day)).join("\n")}
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
