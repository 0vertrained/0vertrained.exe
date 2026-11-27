// Paired, chronological evaluation. Only the scoring step sees the realized
// sets. Load and nutrition are end-of-day estimates, not forecasts.
export const REPLAY_BASELINE = "b39cdcbf41dc03a1647dd39e345088b15c5169aa";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function isDay(key) {
  return DAY.test(key) && Number.isFinite(Date.parse(key)) && new Date(key).toISOString().slice(0, 10) === key;
}
function number(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
const round = n => Math.round(n * 100) / 100;

function targets(engine, history, exercise, date) {
  const p = engine.strength.buildExercisePrescription({data:history, exercise, todayKey:date});
  if (!p || p.kind === "establish") return [];
  return Array.from({length:p.targetSets}, (_, i) => ({
    weight: number(p.targetWeights ? p.targetWeights[i] : p.targetWeight),
    reps: number(p.targetReps?.[i]),
  }));
}

// A timestamped backfill becomes available on the date it was entered. Old
// exports lack set timestamps; their only evidence of timing is the log day.
function visibleSets(record, cutoff) {
  return record.sets.map(set => {
    if (!set?.completedAt) return set;
    return Date.parse(set.completedAt) <= cutoff ? set : null;
  });
}

function observedSets(sets) {
  return sets.map(set => {
    if (!set?.done || (set.type && set.type !== "straight")) return null;
    const weight = number(set.weight), reps = number(set.reps);
    if (!(weight > 0 && reps > 0)) return null;
    return {weight, reps, rir:number(set.rir), quality:set.quality ?? null, pain:Boolean(set.pain || number(set.painScore) > 0)};
  });
}

function recordedPlan(sets) {
  return sets.find(set => set?.done && set.progressionTarget?.plan)?.progressionTarget.plan;
}

function previousStrengthHistory(history, names, date) {
  const known = {}, previous = new Map();
  // Make the prediction before any work on the replayed local calendar day.
  const cutoff = Date.parse(date + "T00:00:00") - 1;
  for (const [day, entry] of Object.entries(history)) {
    const exercises = {};
    if (!visibleAt(entry.workout, cutoff, importTimes)) continue;
    for (const [slot, record] of Object.entries(entry.workout?.exercises || {})) {
      const name = String(record?.performedName || slot).trim();
      const key = name.toLowerCase();
      if (!names.has(key) || !Array.isArray(record?.sets) || !visibleAt(record, cutoff, importTimes)) continue;
      const sets = visibleSets(record, cutoff);
      if (!sets.some(set => set?.done)) continue;
      // The production engines expect an object per set, even at a skipped slot.
      exercises[slot] = {performedName:name, sets:sets.map(set => set ?? {done:false})};
      const actual = observedSets(sets);
      const first = actual.find(Boolean);
      if (!first) continue;
      const plan = recordedPlan(sets) || {name, sets:actual.findLastIndex(Boolean) + 1, reps:first.reps};
      previous.set(key, {plan, actual});
    }
    if (Object.keys(exercises).length) known[day] = {workout:{exercises}};
  }
  return {known, previous};
}

function liftRows({entry, history, old, current, date, through}) {
  const rows = [];
  const exercises = Object.entries(entry.workout?.exercises || {}).filter(([, r]) => Array.isArray(r?.sets));
  if (!exercises.length) return rows;
  const names = new Set(exercises.map(([slot, r]) => String(r.performedName || slot).trim().toLowerCase()));
  const {known, previous} = previousStrengthHistory(history, names, date);
  const scoreCutoff = through ? Date.parse(through + "T23:59:59.999") : Infinity;
  for (const [slot, record] of exercises) {
    const name = String(record.performedName || slot).trim();
    const last = previous.get(name.toLowerCase());
    // The captured plan is exercise metadata. A later backfill may supply an
    // observed result, but cannot retrospectively supply the day's plan.
    const plan = recordedPlan(visibleSets(record, Date.parse(date + "T23:59:59.999")));
    const exercise = plan ? {...plan, name} : last?.plan;
    const actual = observedSets(visibleSets(record, scoreCutoff));
    if (!actual.some(Boolean) || current.logging.resolveTrackingMode(exercise || {name}) !== "loaded_reps") continue;
    rows.push({date, exercise:name, planSource:plan ? "recorded" : last ? "prior session" : null,
      effortTarget:exercise?.rir ?? null,
      old:exercise ? targets(old, known, exercise, date) : [],
      current:exercise ? targets(current, known, exercise, date) : [],
      repeat:last?.actual || [], actual});
  }
  return rows;
}

function strengthMetrics(rows, current) {
  const methods = ["old", "current", "repeat"];
  const totals = Object.fromEntries(methods.map(key => [key,{error:0, attempted:0, repsMet:0, effortMeasured:0, effortMet:0}]));
  let pairedSets = 0, loggedSets = 0;
  for (const row of rows) {
    row.actual.forEach((set, i) => {
      if (!set) return;
      loggedSets++;
      if (!methods.every(method => row[method][i]?.weight > 0 && row[method][i]?.reps > 0)) return;
      pairedSets++;
      for (const method of methods) {
        const total = totals[method], target = row[method][i];
        total.error += Math.abs(target.weight - set.weight);
        // A different load was chosen; capacity at the proposed load is unknown.
        if (set.weight !== target.weight) continue;
        total.attempted++;
        if (set.reps >= target.reps) total.repsMet++;
        if (set.rir == null || !/\d/.test(String(row.effortTarget ?? ""))) continue;
        const outcome = current.strength.evaluateSetOutcome({
          mode:"loaded_reps", weight:target.weight, value:target.reps, rir:row.effortTarget,
        }, {...set, done:true});
        if (outcome === "unknown") continue;
        total.effortMeasured++;
        if (outcome === "met") total.effortMet++;
      }
    });
  }
  return {pairedSets, loggedSets, methods:Object.fromEntries(methods.map(method => {
    const {error, ...counts} = totals[method];
    return [method,{...counts, loadMaeLb:pairedSets ? round(error / pairedSets) : null}];
  }))};
}

const importTimes = ["importedAt", "imported_at", "recordedAt", "createdAt", "created_at", "updated_at"];
const activityTimes = [...importTimes, "start", "startTime", "startedAt", "end", "endedAt", "completedAt"];

function visibleAt(record, cutoff, fields) {
  return fields.every(field => {
    const stamp = record?.[field];
    if (!stamp) return true;
    const time = Date.parse(DAY.test(stamp) ? stamp + "T00:00:00" : stamp);
    return Number.isFinite(time) && time <= cutoff;
  });
}

// An imported block can be a single manual total for several recordings. If
// any component arrived later, the combined total was not yet observable.
function cardioAsOf(block, cutoff) {
  if (!block || !visibleAt(block, cutoff, activityTimes)) return null;
  if (Array.isArray(block.activityRefs) && !block.activityRefs.every(r => visibleAt(r, cutoff, activityTimes))) return null;
  return block;
}

function entryAsOfDay(entry, asOf) {
  if (!entry?.workout) return entry;
  const cutoff = Date.parse(asOf + "T23:59:59.999");
  const raw = entry.workout;
  if (!visibleAt(raw, cutoff, importTimes)) return {...entry, workout:{}};
  const workout = {...raw};
  if (!visibleAt(raw, cutoff, ["completedAt"])) {
    delete workout.completedAt;
    workout.completed = false;
  }
  if (raw.exercises) {
    workout.exercises = {};
    for (const [slot, record] of Object.entries(raw.exercises)) {
      if (!visibleAt(record, cutoff, importTimes)) continue;
      if (!Array.isArray(record?.sets)) {
        workout.exercises[slot] = record;
        continue;
      }
      const sets = visibleSets(record, cutoff);
      // The old weekly algorithm counts exercise keys. A later backfill must
      // not leave an empty key that would still count an entire workout.
      if (sets.some((set, i) => set !== record.sets[i]) && !sets.some(set => set?.done)) continue;
      workout.exercises[slot] = {...record, sets:sets.map(set => set || {done:false})};
    }
  }
  if (raw.cardio) workout.cardio = cardioAsOf(raw.cardio, cutoff);
  if (raw.cardioSessions) workout.cardioSessions = Object.fromEntries(Object.entries(raw.cardioSessions)
    .map(([key, block]) => [key, cardioAsOf(block, cutoff)]).filter(([, block]) => block));
  if (Array.isArray(raw.watchWorkouts)) workout.watchWorkouts = raw.watchWorkouts.filter(w => visibleAt(w, cutoff, activityTimes));
  if (raw.sessionState) {
    workout.sessionState = {};
    for (const [slot, session] of Object.entries(raw.sessionState)) {
      if (!visibleAt(session, cutoff, [...importTimes, "startedAt"])) continue;
      workout.sessionState[slot] = visibleAt(session, cutoff, ["completedAt"])
        ? session : {...session, status:"active", completedAt:null};
    }
  }
  return {...entry, workout};
}

// Oura's native shape can be a single record, an array, or a V2 data envelope.
// Keep that shape for both engines. Undated provider records use the stored day.
function recordsAsOf(records, cutoff) {
  if (Array.isArray(records)) return records.filter(r => visibleAt(r, cutoff, activityTimes));
  if (!records || !visibleAt(records, cutoff, activityTimes)) return null;
  for (const field of ["data", "activity"]) {
    if (Array.isArray(records[field])) return {...records, [field]:recordsAsOf(records[field], cutoff)};
  }
  return records;
}

function loadAt(engine, date, day, sources) {
  const cutoff = Date.parse(date + "T23:59:59.999");
  const strava = recordsAsOf(sources.stravaByDate?.[date], cutoff);
  const whoop = sources.whoopData?.[date], oura = sources.ouraData?.[date];
  const [row] = engine.workload.buildWearableLoadRows({
    entries: { [date]: entryAsOfDay(day, date) }, asOf: date, maxDays: 1,
    stravaByDate: strava ? {[date]:strava} : {},
    whoopData: whoop ? {[date]:{...whoop, workout:recordsAsOf(whoop.workout, cutoff)}} : {},
    ouraData: oura ? {[date]:{...oura, activity:recordsAsOf(oura.activity, cutoff)}} : {},
  });
  return { load: row.load, minutes: row.durationMin, source: row.source ?? null };
}

function energyAt(engine, history, date) {
  const result = engine.fuel.computeAdaptiveTDEE(history, { asOf: date });
  return {
    kcal: result.ready ? result.tdee : null,
    confidence: result.ready ? result.confidence : null,
    loggedDays: result.loggedDays ?? null,
    coveragePct: result.density ?? null,
  };
}

// Both revisions receive the same captured Today call. The original revision
// predates capture, so adapt its original verdict and shared-call entry points.
function recoveryAt(engine, context) {
  if (engine.shared.replayRecoveryContext) {
    return engine.shared.replayRecoveryContext(context)?.call ?? null;
  }
  const verdict = context.wearablePresent && context.legacyVerdictAvailable !== false && context.verdictAvailable !== false
    ? engine.recovery.buildRecoveryVerdict({
      recovery: { score: context.score },
      recommendation: context.recommendationLabel ? { label: context.recommendationLabel } : null,
      checkin: context.checkin, alerts: context.alerts, sleepDebt: { debtHours: context.sleepDebtHours },
      trainingLoad: { rolling: { zone: context.loadZone } }, confidence: { level: context.confidenceLevel },
    })
    : null;
  return engine.shared.resolveSharedCall({
    todayCall: context.todayCall, recoveryVerdict: verdict, score: context.score,
  })?.call ?? null;
}

function recoveryComparison(entry, date, old, current) {
  const response = entry.intelligence?.todayDecisionResponse;
  const morning = response?.recoveryContext;
  if (morning?.version !== 1 || morning.asOf !== date) return { recovery: null, recoveryStatus: "missing_capture" };
  if (morning.unavailableReason) return { recovery: null, recoveryStatus: morning.unavailableReason };
  const before = recoveryAt(old, morning), after = recoveryAt(current, morning);
  if (!before || !after) return { recovery: null, recoveryStatus: "incomplete_capture" };
  return { recovery: { old: before, current: after }, recoveryStatus: "compared" };
}

function weeklyHistory(history, asOf, legacy) {
  const view = {};
  for (const [date, original] of Object.entries(history)) {
    const entry = entryAsOfDay(original, asOf);
    const intent = entry.intelligence?.weeklyCoachReviewResponse;
    if (!intent) {
      view[date] = entry;
      continue;
    }
    const visible = { ...intent };
    if (visible.followThroughOn > asOf) {
      delete visible.followThrough;
      delete visible.followThroughOn;
    }
    // V2 baselines have different fields. Let the old algorithm compute the
    // baseline it understands from the same seven days of observations.
    if (legacy && visible.version === 2) delete visible.baseline;
    view[date] = { ...entry, intelligence: { ...entry.intelligence, weeklyCoachReviewResponse:
      (visible.recordedOn || date) <= asOf ? visible : null } };
  }
  return view;
}

function weekOutcomes(engine, history, asOf, legacy) {
  const samples = engine.coaching.collectWeeklyRecommendationSamples(weeklyHistory(history, asOf, legacy), { asOf });
  return new Map(samples.map(sample => {
    const outcome = sample.outcome ?? (sample.favorable == null ? "unknown" : sample.favorable ? "favorable" : "unfavorable");
    return [sample.date, {
      outcome, followed: sample.followed === true, kind: sample.modifiedKind || sample.recommendationKind,
      response: sample.response, execution: sample.execution ?? null, outcomeEnd: sample.outcomeEnd ?? null,
    }];
  }));
}

const isRecord = value => value != null && typeof value === "object" && !Array.isArray(value);
const sourceKeys = ["stravaByDate", "whoopData", "ouraData"];

export function historicalReplay(input, old, current, { through } = {}) {
  const entries = input?.entries ?? input;
  if (!isRecord(entries) || !Object.entries(entries).every(([date, entry]) => isDay(date) && isRecord(entry))) {
    throw new Error("Expected daily entry objects keyed by YYYY-MM-DD, or an object with an entries field.");
  }
  if (through !== undefined && !isDay(through)) throw new Error("--through must be a valid YYYY-MM-DD.");
  const sources = input?.wearables ?? {};
  if (!isRecord(sources) || !Object.entries(sources).every(([name, days]) =>
    sourceKeys.includes(name) && isRecord(days) && Object.keys(days).every(isDay))) {
    throw new Error("Expected date-keyed stravaByDate, whoopData or ouraData maps in wearables.");
  }
  const allDates = [...Object.keys(entries), ...Object.values(sources).flatMap(days => Object.keys(days))];
  const dates = [...new Set(allDates)].filter(date => !through || date <= through).sort();
  const cutoff = through || dates.at(-1);
  const history = {}, daily = [], strength = [];
  for (const date of dates) {
    const entry = entries[date] || {};
    strength.push(...liftRows({ entry, history, old, current, date, through: cutoff }));
    const recovery = recoveryComparison(entry, date, old, current);
    if (entries[date]) history[date] = entry;
    daily.push({
      date, ...recovery,
      trainingLoad: { old: loadAt(old, date, entry, sources), current: loadAt(current, date, entry, sources) },
      energy: { old: energyAt(old, history, date), current: energyAt(current, history, date) },
    });
  }
  const weekly = [];
  if (cutoff) {
    const before = weekOutcomes(old, history, cutoff, true);
    const after = weekOutcomes(current, history, cutoff, false);
    for (const date of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      weekly.push({ date, old: before.get(date) ?? null, current: after.get(date) ?? null });
    }
  }
  return { through: cutoff ?? null, days: dates.length, strength: strengthMetrics(strength, current), daily, weekly, workouts: strength };
}

export function printSummary(report) {
  const { daily, weekly, strength } = report;
  const methods = strength.methods;
  const recovery = daily.filter(day => day.recovery);
  const changedCalls = recovery.filter(day => day.recovery.old !== day.recovery.current).length;
  const changedLoad = daily.filter(({ trainingLoad: { old, current } }) => old.load !== current.load || old.minutes !== current.minutes).length;
  const estimates = key => daily.filter(day => day.energy[key].kcal != null).length;
  const favorable = key => weekly.filter(day => day[key]?.followed && day[key].outcome === "favorable").length;
  const compare = fn => ["old", "current", "repeat"].map(key => (key === "repeat" ? "repeat last" : key) + " " + fn(methods[key])).join(", ");
  return [
    "0vertrained historical replay (" + report.input + ")",
    "Baseline " + report.baseline + " vs working tree",
    report.days + " logged or imported days through " + (report.through || "—"),
    "Recovery — " + changedCalls + " changed shared calls across " + recovery.length + " captured comparisons. " + (daily.length - recovery.length) + " days lacked comparable inputs. The recorded Today call is held fixed.",
    "Training load — " + changedLoad + " days changed load or duration.",
    "Fuel — daily expenditure estimates available on " + estimates("old") + " days (old) and " + estimates("current") + " days (current).",
    "Weekly coaching — " + weekly.length + " decisions. Counted as followed and favorable by the old rule " + favorable("old") + ", by the current rule " + favorable("current") + ".",
    "Strength — " + strength.pairedSets + " comparable sets. Mean absolute difference from performed load (lb) was " + compare(m => m.loadMaeLb ?? "—") + ".",
    "Rep targets reached at the suggested load (met/attempted) — " + compare(m => m.repsMet + "/" + m.attempted) + ".",
    "Rep and effort targets reached when effort was scored (met/scored) — " + compare(m => m.effortMet + "/" + m.effortMeasured) + ".",
    "Use --json for individual comparisons. These figures measure agreement with observed training.",
  ].join("\n");
}
