// src/TodayCall.jsx
// Today's decision surface: the call, what is left on fuel, the day's
// progress, and the three sheets behind them (day mode, why this plan,
// close out the day). useDayOps holds the state and the writes; the parts
// below only draw it, so Today can place them where the layout wants them.
import { useMemo, useState } from "react";
import { readCheckin } from "./checkinMorning";
import {
  DAY_MODES,
  buildCloseoutEntry,
  buildDailyCloseout,
  buildFactorOperatingPlan,
  buildOperatingTargets,
  buildTrainingPrescription,
  recommendDayMode,
  resolveDayMode,
} from "./physiqueOS";
import { describeTodayCall } from "./recovery/verdictResolver";
import { TrainingAdjustmentInline } from "./sections/TrainingAdjustmentInline";
import { buildTomorrowOutlook } from "./uiStability";
import { Bar, Icon, LinkRow, Meter, Seg, Sheet } from "./ui/ledger";

const NBSP = "\u00a0";
const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const fmt = (value) => Math.round(value).toLocaleString("en-US");
const pct = (done, target) => (target > 0 ? Math.max(0, Math.min(100, (done / target) * 100)) : 0);

export function useDayOps({
  todayKey, todayData, updateToday, showToast, goals, settings, recommendation, decision,
  adaptiveSuggestion, programDay, totalExercises, doneExercises, hasCardio, cardioLogged, isRest,
  wearableSteps = null,
}) {
  const osData = todayData?.intelligence?.physiqueOS || {};
  const recommendedMode = recommendDayMode({ decision, recommendation, body: todayData?.body });
  const mode = resolveDayMode({ storedMode: osData.mode, decision, recommendation, body: todayData?.body });
  const targets = useMemo(() => buildOperatingTargets({ mode, goals, settings }), [mode, goals, settings]);
  const prescription = useMemo(
    () => buildTrainingPrescription({ mode, decision, adaptiveSuggestion, programDay }),
    [mode, decision, adaptiveSuggestion, programDay]
  );
  const factor = useMemo(() => buildFactorOperatingPlan(todayKey, todayData?.nutrition), [todayKey, todayData?.nutrition]);
  const closeout = useMemo(
    () => buildDailyCloseout({ todayData, targets, totalExercises, doneExercises, hasCardio, cardioLogged, isRest, wearableSteps }),
    [todayData, targets, totalExercises, doneExercises, hasCardio, cardioLogged, isRest, wearableSteps]
  );
  const checkin = readCheckin(todayData?.body || {});
  const storedCloseout = osData.closeout || null;
  const manualSteps = todayData?.activity?.steps ?? "";
  const steps = finite(manualSteps) ?? finite(wearableSteps) ?? 0;
  const calories = Math.max(0, finite(todayData?.nutrition?.calories) ?? 0);
  const protein = Math.max(0, finite(todayData?.nutrition?.protein) ?? 0);
  const [sheet, setSheet] = useState(null); // null | "mode" | "detail" | "closeout"
  const nextMeal = factor?.meals?.find((meal) => !meal.logged) || null;

  const trainingTarget = isRest ? 1 : Math.max(1, totalExercises + (hasCardio ? 1 : 0));
  const trainingDone = isRest ? 1 : Math.min(trainingTarget, doneExercises + (hasCardio && cardioLogged ? 1 : 0));
  // The four things the day is measured on, each as a number against its target.
  const progress = [
    { key: "training", label: "Training", value: isRest ? "Rest day" : `${trainingDone}/${trainingTarget}`, unit: isRest ? "" : hasCardio ? "parts" : "exercises", fill: pct(trainingDone, trainingTarget) },
    { key: "protein", label: "Protein", value: `${fmt(protein)}/${fmt(targets.protein)}`, unit: "g", fill: pct(protein, targets.protein) },
    { key: "steps", label: "Steps", value: `${fmt(steps)}/${fmt(targets.steps)}`, unit: "", fill: pct(steps, targets.steps) },
    { key: "calories", label: "Calories", value: `${fmt(calories)}/${fmt(targets.calories)}`, unit: "kcal", fill: pct(calories, targets.calories) },
  ];

  // Changing anything the closed day was scored on reopens it.
  const reopen = () => { if (storedCloseout) updateToday("intelligence.physiqueOS.closeout", null); };

  const chooseMode = (nextMode) => {
    updateToday("intelligence.physiqueOS.mode", nextMode);
    updateToday("intelligence.physiqueOS.modeSelectedAt", new Date().toISOString());
    reopen();
    showToast?.(`Day mode: ${DAY_MODES[nextMode].label}`);
    setSheet(null);
  };

  const toggleFactorMeal = (meal) => {
    if (!Number.isFinite(meal.calories) || !Number.isFinite(meal.protein)) {
      showToast?.("Check the tray label before logging this meal");
      return;
    }
    const nutrition = todayData?.nutrition || {};
    const logged = nutrition?.factorPlan?.[meal.slot] === meal.id;
    const sign = logged ? -1 : 1;
    updateToday("nutrition", {
      ...nutrition,
      calories: String(Math.max(0, Math.round((Number(nutrition.calories) || 0) + sign * meal.calories))),
      protein: String(Math.max(0, Math.round((Number(nutrition.protein) || 0) + sign * meal.protein))),
      factorPlan: { ...(nutrition.factorPlan || {}), [meal.slot]: logged ? null : meal.id },
    });
    reopen();
    showToast?.(logged ? `${meal.name} removed` : `${meal.name} added to today`);
  };

  const setSteps = (value) => { updateToday("activity.steps", value); reopen(); };

  const closeDay = () => {
    updateToday("intelligence.physiqueOS.closeout", buildCloseoutEntry(closeout));
    showToast?.(closeout.status === "complete" ? "Day closed. Everything done." : "Day closed. Tomorrow stays on plan.");
    setSheet(null);
  };
  const reopenDay = () => { updateToday("intelligence.physiqueOS.closeout", null); setSheet(null); };

  return {
    mode, recommendedMode, targets, prescription, factor, nextMeal, closeout, storedCloseout, checkin,
    manualSteps, steps, wearableSteps, calories, protein, progress, sheet, setSheet,
    chooseMode, toggleFactorMeal, setSteps, closeDay, reopenDay,
    score: storedCloseout?.score ?? closeout.score,
  };
}

// The call: a five-bar effort meter, one word, the recovery score, one
// sentence. Until the check-in is answered it sits in pencil; answering inks
// it in. Below the rule, what today holds and its one primary action.
export function CallCard({ ops, decision, recommendation, call: sharedCall = null, sessionTitle, exerciseCount = 0, primary = null, isRest = false, finished = null, onOpenRecovery }) {
  // The app's one call (sharedCall.js), the same as Recovery's, with the
  // recovery score Recovery shows. A past day keeps its own engine's call.
  const call = sharedCall || describeTodayCall(decision?.call);
  const score = finite(sharedCall ? sharedCall.score : recommendation?.readinessIndex);
  const inked = ops.checkin.complete;
  return (
    <section className={`card ${inked ? "is-ink" : "pencil"}`} aria-labelledby="call" data-section="physique-os" data-ui="today-command-center" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 16px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
        <Meter level={call.level} label={`Effort level ${call.level} of 5`} style={{ "--d": "200ms" }} />
        <span className="grow" style={{ display: "flex" }}><span className="stamp" style={{ "--d": "120ms" }}>{call.stamp}</span></span>
        {score !== null ? (
          <button type="button" onClick={onOpenRecovery} aria-label={`Recovery score ${Math.round(score)} of 100. Open recovery detail.`} style={{ display: "flex", alignItems: "center", gap: 2, minHeight: 44 }}>
            <span className="n-md">{Math.round(score)}</span><span className="t-s c2">/100</span><Icon name="next" size="s" className="c2" />
          </button>
        ) : (
          <button type="button" onClick={onOpenRecovery} aria-label="Recovery: no score yet. Open recovery detail." style={{ display: "flex", alignItems: "center", gap: 2, minHeight: 44 }}>
            <span className="t-s c2">No score yet</span><Icon name="next" size="s" className="c2" />
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 id="call" className="t-hl inkable" data-t={call.headline} style={{ "--d": "260ms" }}>{call.headline}</h2>
        <p className="t-s c2">{decision?.primaryAction || ops.prescription.detail}</p>
        {!inked && <p className="t-ss">Before check-in</p>}
      </div>
      <hr className="hr" />
      {isRest ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Icon name="done" className="good" />
          <div className="kv grow"><h3 className="t-h">Rest day, protected</h3><p className="t-s c2">Planned in your program. Training counts as done today.</p></div>
        </div>
      ) : finished ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="kv grow"><h3 className="t-bs clip">{sessionTitle}</h3><span className="t-s c2">{finished.line}</span></span>
          <button type="button" className="btn btn-s btn-sm" onClick={finished.onOpen}>Box Score</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h3 className="t-h grow clip">{sessionTitle}</h3>
          {exerciseCount > 0 && <span className="t-s c2">{exerciseCount}{NBSP}exercises</span>}
        </div>
      )}
      {primary && (
        <button type="button" className={`btn ${isRest || primary.quiet ? "btn-s" : "btn-p"} btn-b`} onClick={primary.onGo}>{primary.label}</button>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button type="button" className="btn btn-s btn-sm" aria-haspopup="dialog" onClick={() => ops.setSheet("mode")} style={{ padding: "0 10px 0 12px" }}>Day mode: {ops.targets.modeLabel}<Icon name="down" size="s" /></button>
        <button type="button" className="btn btn-g btn-sm" aria-haspopup="dialog" onClick={() => ops.setSheet("detail")}>Why this plan</button>
      </div>
    </section>
  );
}

// What is still needed today, and the next planned meal when there is one.
export function FuelSnapshot({ ops, onOpenFuel }) {
  const { targets, protein, calories, nextMeal } = ops;
  const proteinLeft = Math.max(0, Math.round(targets.protein - protein));
  const caloriesLeft = Math.max(0, Math.round(targets.calories - calories));
  return (
    <>
      <button type="button" onClick={onOpenFuel} aria-label={`Fuel. ${fmt(proteinLeft)} grams of protein and ${fmt(caloriesLeft)} calories left today. Open Fuel.`} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, textAlign: "left" }}>
        <span className="kv"><span className="t-c c2">Protein left</span><span><span className="n">{fmt(proteinLeft)}</span> <span className="t-s c2">of {fmt(targets.protein)}{NBSP}g</span></span><span className="bar"><i style={{ width: `${pct(protein, targets.protein)}%` }} /></span></span>
        <span className="kv"><span className="t-c c2">Calories left</span><span><span className="n">{fmt(caloriesLeft)}</span> <span className="t-s c2">of {fmt(targets.calories)}{NBSP}kcal</span></span><span className="bar"><i style={{ width: `${pct(calories, targets.calories)}%` }} /></span></span>
      </button>
      {nextMeal && (
        <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <button type="button" className="kv grow" onClick={onOpenFuel} style={{ textAlign: "left" }}>
            <span className="t-c c2">Next meal · {nextMeal.label}</span>
            <span className="t-bs clip">{nextMeal.name}</span>
            <span className="n-s c2">{Number.isFinite(nextMeal.calories) ? `${fmt(nextMeal.calories)}${NBSP}kcal · ${nextMeal.protein}${NBSP}g protein` : "Check the tray label in Fuel"}</span>
          </button>
          <button type="button" className="btn btn-s btn-sm" onClick={() => ops.toggleFactorMeal(nextMeal)}>Log it</button>
        </div>
      )}
    </>
  );
}

const OPEN_NAMES = { checkin: "check-in", training: "training", protein: "protein", calories: "calories", steps: "steps" };
const ITEM_NAMES = { checkin: "Check-in", training: "Training", protein: "Protein", calories: "Calories", steps: "Steps" };

// Day progress: one number, then the four things behind it.
// primary: the day's session is finished (or it is a rest day), so closing
// out the day is the next thing to do and takes the filled button.
export function DayProgress({ ops, primary = false }) {
  const { closeout, storedCloseout, score, progress } = ops;
  const open = closeout.openItems.map((item) => OPEN_NAMES[item.key] || item.key);
  const listed = (names) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const sentence = (text) => text.replace(/^./, (first) => first.toUpperCase());
  const closed = closeout.items.filter((item) => item.done).map((item) => OPEN_NAMES[item.key] || item.key);
  const line = storedCloseout ? "Day closed."
    : open.length === 0 ? "Everything for today is done."
    : `${closed.length ? `${sentence(listed(closed))} done. ` : ""}${sentence(listed(open))} still open.`;
  return (
    <section aria-labelledby="day-progress" data-section="day-progress" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="sec"><h2 id="day-progress" className="t-ss">Day progress</h2><span className="n-s">{score}%</span></div>
      <Bar value={score} label={`Day progress ${score} percent`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
        {progress.map((item) => (
          <span key={item.key} className="kv">
            <span className="t-c c2">{item.label}</span>
            <span><span className={/\d/.test(item.value) ? "n" : "t-bs"}>{item.value}</span>{item.unit && <> <span className="t-s c2">{item.unit}</span></>}</span>
            <span className="bar"><i style={{ width: `${item.fill}%` }} /></span>
          </span>
        ))}
      </div>
      <p className="t-s c2">{line}</p>
      <button type="button" className={`btn ${primary && !storedCloseout ? "btn-p" : "btn-s"} btn-b`} aria-haspopup="dialog" onClick={() => ops.setSheet("closeout")}>{storedCloseout ? "Review the closed day" : "Close out the day"}</button>
    </section>
  );
}

function BulletList({ title, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h3 className="t-ss">{title}</h3>
      <ul className="lst">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div>
  );
}

// The three sheets behind the call. Only one is open at a time.
export function CallSheets({ ops, decision, adjustment = null, currentResponse = null, onResponse = null, feedbackBrief = "", onOpenRecovery }) {
  const { sheet, setSheet, mode, recommendedMode, targets, closeout, storedCloseout, score } = ops;
  const close = () => setSheet(null);
  const outlook = buildTomorrowOutlook(decision);
  const modeKeys = Object.keys(DAY_MODES);
  const onModeKey = (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const radios = Array.from(event.currentTarget.querySelectorAll('[role="radio"]'));
    const index = radios.indexOf(document.activeElement);
    radios[(index + step + radios.length) % radios.length]?.focus();
  };
  return (
    <>
      <Sheet open={sheet === "mode"} title="Day mode" onClose={close}>
        <div role="radiogroup" aria-label="Day mode" onKeyDown={onModeKey} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {modeKeys.map((key) => {
            const item = DAY_MODES[key];
            const active = mode === key;
            return (
              <button key={key} type="button" className="opt" role="radio" aria-checked={active} tabIndex={active ? 0 : -1} onClick={() => ops.chooseMode(key)}>
                <span className="rad" aria-hidden="true" />
                <span className="kv grow"><span className="t-bs">{item.label}</span><span className="t-s c2">{item.short}</span></span>
                {recommendedMode === key && <span className="tag tag-f">Recommended</span>}
              </button>
            );
          })}
        </div>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {[["Calories", fmt(targets.calories)], ["Protein", `${fmt(targets.protein)}${NBSP}g`], ["Steps", fmt(targets.steps)], ["Sleep", `${targets.sleepHours}${NBSP}h`]].map(([label, value]) => (
            <div key={label} className="kv"><dt className="t-c c2">{label}</dt><dd className="n-s">{value}</dd></div>
          ))}
        </dl>
        <p className="t-s c2">Targets for {DAY_MODES[mode].label.toLowerCase()} mode. {targets.modeSummary}</p>
      </Sheet>

      <Sheet open={sheet === "detail"} title="Why this plan" onClose={close}>
        <div className="kv" style={{ gap: 4 }}>
          <p className="t-bs">{decision?.title || ops.prescription.title}</p>
          {decision?.subtitle && <p className="t-s c2">{decision.subtitle}</p>}
        </div>
        <BulletList title="Do" items={decision?.doList} />
        <BulletList title="Avoid" items={decision?.avoidList} />
        <BulletList title="Watch" items={decision?.watchList} />
        <BulletList title="Signals used" items={decision?.reasons?.slice(0, 5)} />
        {(decision?.sourceBadges?.length > 0 || decision?.confidence || decision?.risk) && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {(decision.sourceBadges || []).map((badge) => <span key={badge} className="tag tag-f">{badge}</span>)}
            {decision.confidence && <span className="t-s c2">Confidence: {decision.confidence}</span>}
            {decision.risk && <span className={`t-s ${decision.risk === "High" ? "stop" : "c2"}`}>Risk: {decision.risk}</span>}
          </div>
        )}
        {adjustment && (
          <TrainingAdjustmentInline
            suggestion={adjustment.suggestion}
            accepted={adjustment.accepted}
            keptOriginal={adjustment.keptOriginal}
            onAccept={adjustment.onAccept}
            onKeepOriginal={adjustment.onKeepOriginal}
          />
        )}
        {outlook && <div className="kv"><h3 className="t-ss">{outlook.eyebrow}</h3><p className="t-s c2">{outlook.text}</p></div>}
        {onResponse && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h3 id="call-response" className="t-ss">{decision?.responsePrompt || "Did you follow today’s call?"}</h3>
            <Seg
              labelledBy="call-response"
              options={["followed", "modified", "ignored", "skipped"].map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))}
              value={currentResponse}
              onChange={onResponse}
            />
            {feedbackBrief && <p className="t-s c2">{feedbackBrief}</p>}
          </div>
        )}
        {onOpenRecovery && <LinkRow label="Recovery detail" sub="The score, its signals and where each came from" onClick={() => { close(); onOpenRecovery(); }} style={{ borderTop: "1px solid var(--line)" }} />}
      </Sheet>

      <Sheet open={sheet === "closeout"} title="Close out the day" onClose={close}>
        <div className="sec"><span className="t-s c2">{storedCloseout ? "Closed" : "So far"}</span><span className="n">{score}%</span></div>
        <Bar value={score} label={`Day progress ${score} percent`} />
        <label className="field">
          <span className="lbl" style={{ display: "flex", justifyContent: "space-between" }}>Steps today{finite(ops.wearableSteps) !== null && ops.manualSteps === "" && <span className="t-c c2">From your wearable</span>}</span>
          <input className="input n" type="number" inputMode="numeric" min="0" autoComplete="off" value={ops.manualSteps} placeholder={String(Math.round(ops.steps))} onChange={(event) => ops.setSteps(event.target.value)} />
        </label>
        <ul className="rows">
          {closeout.items.map((item) => {
            const measured = ops.progress.find((entry) => entry.key === item.key);
            return (
              <li key={item.key} className="row">
                <Icon name={item.done ? "done" : "open"} className={item.done ? "good" : "c2"} />
                <span className="t-bs grow">{ITEM_NAMES[item.key] || item.label}<span className="sr">{item.done ? ", done" : ", open"}</span></span>
                {measured
                  ? <span className={/\d/.test(measured.value) ? "n-s" : "t-s c2"}>{measured.value}{measured.unit ? `${NBSP}${measured.unit}` : ""}</span>
                  : <span className="t-s c2">{item.done ? "Done" : `${ops.checkin.answered} of ${ops.checkin.total}`}</span>}
              </li>
            );
          })}
        </ul>
        {storedCloseout
          ? <button type="button" className="btn btn-s btn-b" onClick={ops.reopenDay}>Reopen the day</button>
          : <button type="button" className="btn btn-p btn-b" onClick={ops.closeDay}>Close out the day</button>}
        {!storedCloseout && closeout.openItems.length > 0 && <p className="t-s c2">A partial day can still be closed. It records what happened and asks nothing extra of tomorrow.</p>}
      </Sheet>
    </>
  );
}
