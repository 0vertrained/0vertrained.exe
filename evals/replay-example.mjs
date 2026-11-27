// Six fictional weeks beginning on a Monday. Dates, sessions, imports and
// decisions are fixed so a change to a model can be reproduced locally.
const dateAt = day => new Date(Date.UTC(2026, 8, 7 + day)).toISOString().slice(0, 10);

export function exampleHistory() {
  const entries = {}, stravaByDate = {}, whoopData = {}, ouraData = {};
  const bench = {name: "Barbell Bench Press", sets: 3, reps: "6–8", rir: 2, trackingMode: "loaded_reps", weightIncrement: 5};

  for (let day = 0; day < 42; day++) {
    const date = dateAt(day), week = Math.floor(day / 7);
    const body = {weight: (181 - day * 0.025 + [0.2, -0.1, 0.1, 0][day % 4]).toFixed(1)};
    // Only one sleep entry in week two, then enough readings to compare
    // week three with the longer nights in week four.
    if (week !== 1 || day === 9) body.sleep = week === 3 ? 7.5 : 6.8;
    const confirmed = week >= 2 && day % 7 !== 5;
    const calories = confirmed ? 2450 + [75, -50, 0][day % 3] : 600 + (day % 3) * 150;
    const nutrition = {calories, protein: confirmed ? 155 : 35};
    if (confirmed) nutrition.foodLogConfirmation = {calories, confirmedOn: date};
    const entry = entries[date] = {body, nutrition};

    if (day % 7 === 0) {
      // One heavier bench set and two back-offs. Load and reps vary as
      // the athlete repeats the block, including a session below target.
      const top = [155, 155, 160, 160, 160, 155][week];
      const backoff = [125, 125, 130, 130, 135, 130][week];
      const reps = [[7, 7, 7], [8, 8, 8], [6, 6, 6], [7, 8, 8], [6, 5, 6], [7, 7, 7]][week];
      const sets = [top, backoff, backoff].map((weight, i) => ({
        done: true, weight, reps: reps[i], rir: week === 4 ? 1 : 2, type: "straight",
        completedAt: date + ["T07:12:00Z", "T07:16:00Z", "T07:20:00Z"][i],
        progressionTarget: {plan: {...bench}},
      }));
      entry.workout = {rpe: 7, exercises: {[bench.name]: {sets}}};
    }
  }

  // The athlete lifted in the morning and ran in the evening. Two devices
  // recorded that evening run. A daily activity aggregate covers both.
  const double = dateAt(14), start = double + "T18:00:00Z";
  entries[double].workout.watchWorkouts = [{id: "sample-lift", startedAt: double + "T07:00:00Z", seconds: 2700}];
  stravaByDate[double] = [{stravaId: "sample-run", kind: "run", sport: "Run", startTime: start, minutes: 45, miles: 5}];
  whoopData[double] = {workout: [{id: "sample-whoop-run", sport_name: "running", start,
    end: double + "T18:45:00Z", score: {zone_durations: {zone_two_milli: 2700000}}}]};
  ouraData[double] = {activity: {day: double, active_calories: 550}};
  entries[dateAt(16)].workout = {rpe: 6, cardio: {type: "Indoor ride", time: "40:00"}};
  entries[dateAt(18)].workout = {rpe: 6, cardio: {type: "Run", time: "60:00", miles: 5, pace: "9:00"}};

  // Morning evidence as it looked at decision time: a connected device
  // without a score, a fresh low score, then that same score a day later.
  for (const [day, score, scoredDay] of [[15, null, null], [22, 38, 22], [23, 38, 22], [29, 82, 29]]) {
    const date = dateAt(day);
    entries[date].intelligence = {todayDecisionResponse: {
      version: 1, response: "followed", decisionCall: score === 38 && scoredDay === day ? "recover" : "maintain",
      recordedAt: date + "T06:45:00Z",
      recoveryContext: {
        version: 1, asOf: date, todayCall: "maintain", wearablePresent: true,
        scoredDay: scoredDay == null ? null : dateAt(scoredDay), score, recommendationLabel: null,
        signalDay: scoredDay == null ? null : dateAt(scoredDay), verdictAvailable: true,
        checkin: {severity: 0, flags: []}, alerts: [], sleepDebtHours: null, confidenceLevel: "low",
      },
    }};
  }

  // First recovery follow-up has too little sleep coverage. The second
  // has seven before/after nights and confirmed follow-through. The third
  // records approval only. The final decision's follow-up has yet to occur.
  for (const day of [6, 20, 27, 41]) {
    const date = dateAt(day);
    const intent = {response: "approved", recordedOn: date, recommendationKind: "recovery"};
    if (day === 6 || day === 20) Object.assign(intent, {followThrough: "followed", followThroughOn: dateAt(day + 7)});
    entries[date].intelligence = {weeklyCoachReviewResponse: intent};
  }
  return {entries, wearables: {stravaByDate, whoopData, ouraData}};
}
