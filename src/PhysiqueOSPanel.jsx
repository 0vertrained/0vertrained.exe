import { useEffect, useMemo, useState } from "react";
import { CHECKIN_ROWS, readCheckin, selectedOption } from "./checkinMorning";
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
import { TrainingAdjustmentInline } from "./sections/IntelligenceSections";
import { buildTomorrowOutlook } from "./uiStability";
import { useTheme } from "./theme";

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function statusInk(C, done) {
  return done ? C.green : C.textFaint;
}

function BottomSheet({ open, title, eyebrow, onClose, children }) {
  const { C, S } = useTheme();
  const mono = C.monoFamily || C.fontFamily;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(0,0,0,0.48)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "16px 12px 0",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(82vh, 760px)",
          overflowY: "auto",
          background: C.bg,
          border: `1px solid ${C.lineBright}`,
          borderBottom: "none",
          boxShadow: "0 -18px 50px rgba(0,0,0,0.24)",
        }}
      >
        <header style={{ position: "sticky", top: 0, zIndex: 2, background: C.bg, padding: "16px 18px 13px", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
          <div>
            {eyebrow && <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.15em", textTransform: "uppercase" }}>{eyebrow}</div>}
            <div style={{ fontFamily: S.fontSerif, color: C.text, fontSize: 23, fontWeight: 550, marginTop: eyebrow ? 3 : 0 }}>{title}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} style={{ border: `1px solid ${C.lineBright}`, background: "none", color: C.textDim, width: 34, height: 34, fontFamily: mono, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>×</button>
        </header>
        <div style={{ padding: "16px 18px 24px" }}>{children}</div>
      </section>
    </div>
  );
}

function ProgressCell({ label, value, hint, progress, tone = "neutral" }) {
  const { C } = useTheme();
  const mono = C.monoFamily || C.fontFamily;
  const ink = tone === "good" ? C.green : tone === "warn" ? C.red : C.text;
  return (
    <div style={{ minWidth: 0, padding: "11px 10px 10px", borderRight: `1px solid ${C.line}` }}>
      <div style={{ fontFamily: mono, fontSize: 9, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 13.5, color: ink, marginTop: 5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ height: 2, background: C.line, marginTop: 8, overflow: "hidden" }} aria-hidden="true">
        <div style={{ width: `${Math.round(clamp(progress) * 100)}%`, height: "100%", background: ink, transition: "width 220ms ease" }} />
      </div>
      {hint && <div style={{ fontFamily: mono, fontSize: 8.5, color: C.textFaint, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hint}</div>}
    </div>
  );
}

function ChoicePill({ active, children, onClick }) {
  const { C } = useTheme();
  const mono = C.monoFamily || C.fontFamily;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        border: `1px solid ${active ? C.text : C.lineBright}`,
        background: active ? C.text : "transparent",
        color: active ? C.bg : C.textDim,
        padding: "6px 9px",
        fontFamily: mono,
        fontSize: 10,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

export function PhysiqueOSPanel({
  todayKey,
  todayData,
  updateToday,
  showToast,
  goals,
  settings,
  recommendation,
  decision,
  adaptiveSuggestion,
  adjustment = null,
  currentResponse = null,
  onResponse = null,
  feedbackBrief = "",
  cta = null,
  programDay,
  totalExercises,
  doneExercises,
  hasCardio,
  cardioLogged,
  isRest,
  wearableSteps = null,
  onOpenFuel,
}) {
  const { C, S } = useTheme();
  const mono = C.monoFamily || C.fontFamily;
  const osData = todayData?.intelligence?.physiqueOS || {};
  const recommendedMode = recommendDayMode({ decision, recommendation, body: todayData?.body });
  const mode = resolveDayMode({ storedMode: osData.mode, decision, recommendation, body: todayData?.body });
  const targets = useMemo(() => buildOperatingTargets({ mode, goals, settings }), [mode, goals, settings]);
  const prescription = useMemo(
    () => buildTrainingPrescription({ mode, decision, adaptiveSuggestion, programDay }),
    [mode, decision, adaptiveSuggestion, programDay]
  );
  const factor = useMemo(
    () => buildFactorOperatingPlan(todayKey, todayData?.nutrition),
    [todayKey, todayData?.nutrition]
  );
  const closeout = useMemo(
    () => buildDailyCloseout({
      todayData,
      targets,
      totalExercises,
      doneExercises,
      hasCardio,
      cardioLogged,
      isRest,
      wearableSteps,
    }),
    [todayData, targets, totalExercises, doneExercises, hasCardio, cardioLogged, isRest, wearableSteps]
  );
  const checkin = readCheckin(todayData?.body || {});
  const storedCloseout = osData.closeout || null;
  const manualSteps = todayData?.activity?.steps ?? "";
  const effectiveSteps = finite(manualSteps) ?? finite(wearableSteps) ?? 0;
  const calories = Math.max(0, finite(todayData?.nutrition?.calories) ?? 0);
  const protein = Math.max(0, finite(todayData?.nutrition?.protein) ?? 0);
  const [sheet, setSheet] = useState(null);
  const nextMeal = factor?.meals?.find((meal) => !meal.logged) || null;
  const outlook = buildTomorrowOutlook(decision);

  const trainingTarget = isRest ? 1 : Math.max(1, totalExercises + (hasCardio ? 1 : 0));
  const trainingDone = isRest ? 1 : Math.min(trainingTarget, doneExercises + (hasCardio && cardioLogged ? 1 : 0));
  const progressItems = [
    {
      key: "training",
      label: "Training",
      value: isRest ? "Protected" : `${trainingDone}/${trainingTarget}`,
      hint: isRest ? "recovery day" : trainingDone >= trainingTarget ? "complete" : "planned work",
      progress: trainingDone / trainingTarget,
      tone: trainingDone >= trainingTarget ? "good" : "neutral",
    },
    {
      key: "protein",
      label: "Protein",
      value: `${Math.round(protein)}/${targets.protein}g`,
      hint: protein >= targets.protein ? "target met" : `${Math.max(0, targets.protein - Math.round(protein))}g left`,
      progress: targets.protein ? protein / targets.protein : 0,
      tone: protein >= targets.protein ? "good" : "neutral",
    },
    {
      key: "steps",
      label: "Steps",
      value: `${Math.round(effectiveSteps / 100) / 10}k/${Math.round(targets.steps / 100) / 10}k`,
      hint: effectiveSteps >= targets.steps ? "target met" : `${Math.max(0, targets.steps - Math.round(effectiveSteps)).toLocaleString()} left`,
      progress: targets.steps ? effectiveSteps / targets.steps : 0,
      tone: effectiveSteps >= targets.steps ? "good" : "neutral",
    },
    {
      key: "calories",
      label: "Calories",
      value: `${Math.round(calories)}/${targets.calories}`,
      hint: calories > targets.calorieCeiling ? "over range" : calories >= targets.calorieFloor ? "in range" : `${Math.max(0, targets.calorieFloor - Math.round(calories))} to floor`,
      progress: targets.calories ? calories / targets.calories : 0,
      tone: calories > targets.calorieCeiling ? "warn" : calories >= targets.calorieFloor ? "good" : "neutral",
    },
  ];

  const chooseMode = (nextMode) => {
    updateToday("intelligence.physiqueOS.mode", nextMode);
    updateToday("intelligence.physiqueOS.modeSelectedAt", new Date().toISOString());
    if (storedCloseout) updateToday("intelligence.physiqueOS.closeout", null);
    showToast?.(`${DAY_MODES[nextMode].label} day selected`);
    setSheet(null);
  };

  const toggleFactorMeal = (meal) => {
    if (!Number.isFinite(meal.calories) || !Number.isFinite(meal.protein)) {
      showToast?.("Verify the tray label before logging this meal");
      return;
    }
    const nutrition = todayData?.nutrition || {};
    const logged = nutrition?.factorPlan?.[meal.slot] === meal.id;
    const sign = logged ? -1 : 1;
    updateToday("nutrition", {
      ...nutrition,
      calories: String(Math.max(0, Math.round((Number(nutrition.calories) || 0) + sign * meal.calories))),
      protein: String(Math.max(0, Math.round((Number(nutrition.protein) || 0) + sign * meal.protein))),
      factorPlan: {
        ...(nutrition.factorPlan || {}),
        [meal.slot]: logged ? null : meal.id,
      },
    });
    if (storedCloseout) updateToday("intelligence.physiqueOS.closeout", null);
    showToast?.(logged ? `${meal.name} removed` : `${meal.name} logged`);
  };

  const closeDay = () => {
    updateToday("intelligence.physiqueOS.closeout", buildCloseoutEntry(closeout));
    showToast?.(closeout.status === "complete" ? "Day closed — strong execution" : "Day closed — tomorrow stays on plan");
  };

  const runPrimaryAction = () => {
    if (storedCloseout) {
      setSheet("closeout");
      return;
    }
    if (checkin.answered < 3) {
      setSheet("checkin");
      return;
    }
    if (cta?.target === "checkin" || cta?.status === "done" || cta?.status === "rest") {
      setSheet("closeout");
      return;
    }
    if (cta?.onGo) {
      cta.onGo();
      return;
    }
    setSheet("closeout");
  };

  const primaryLabel = storedCloseout
    ? "Review closed day"
    : checkin.answered < 3
      ? "Complete morning check-in"
      : cta?.target === "checkin" || cta?.status === "done" || cta?.status === "rest"
        ? "Review and close day"
        : cta?.label || "Review day progress";

  const openSummary = closeout.openItems.slice(0, 2).map((item) => item.label.replace(/\s+\d+.*$/, "")).join(" · ");
  const readiness = finite(recommendation?.readinessIndex);
  const callLabel = decision?.call === "push" ? "Push" : decision?.call === "modify" ? "Modify" : decision?.call === "recover" ? "Recover" : "On plan";

  return (
    <>
      <section style={{ ...S.block, padding: 0, overflow: "hidden" }} data-section="physique-os" data-ui="today-command-center">
        <div style={{ padding: "15px 16px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.15em", textTransform: "uppercase" }}>Today command</span>
              <span style={{ fontFamily: mono, fontSize: 9.5, color: C.textDim }}>{readiness !== null ? `READY ${Math.round(readiness)}` : callLabel.toUpperCase()}</span>
            </div>
            <button type="button" onClick={() => setSheet("mode")} style={{ border: `1px solid ${C.lineBright}`, background: "none", color: C.text, padding: "5px 8px", fontFamily: mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" }}>
              {targets.modeLabel} ▾
            </button>
          </div>

          <div style={{ fontFamily: S.fontSerif, color: C.text, fontSize: 25, fontWeight: 550, lineHeight: 1.13, letterSpacing: "-0.02em", marginTop: 10 }}>{prescription.title}</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, marginTop: 6 }}>{prescription.detail}</div>

          <button type="button" onClick={runPrimaryAction} style={{ width: "100%", marginTop: 14, padding: "14px 12px", border: `1px solid ${C.text}`, background: C.text, color: C.bg, fontFamily: S.fontAnnot, fontSize: 11, fontWeight: 650, letterSpacing: "0.11em", textTransform: "uppercase", cursor: "pointer" }}>
            {primaryLabel} →
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 9 }}>
            <div style={{ fontSize: 10.5, color: C.textFaint, lineHeight: 1.4, minWidth: 0 }}>
              {targets.modeSummary}{mode !== recommendedMode ? ` Recovery currently recommends ${DAY_MODES[recommendedMode].label.toLowerCase()}.` : ""}
            </div>
            <button type="button" onClick={() => setSheet("detail")} style={{ border: "none", background: "none", color: C.textDim, fontFamily: mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", padding: 0, cursor: "pointer", whiteSpace: "nowrap" }}>Why this plan →</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
          {progressItems.map(({ key, ...item }, index) => (
            <div key={key} style={{ minWidth: 0, ...(index === progressItems.length - 1 ? { overflow: "hidden" } : null) }}>
              <ProgressCell {...item} />
            </div>
          ))}
        </div>

        <div style={{ padding: "12px 16px" }}>
          {nextMeal ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
              <button type="button" onClick={onOpenFuel} style={{ minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer" }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>Next meal · {nextMeal.label}</div>
                <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nextMeal.name}</div>
                <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textDim, marginTop: 3 }}>{Number.isFinite(nextMeal.calories) ? `${nextMeal.calories} kcal · ${nextMeal.protein}g protein` : "Verify tray label in Fuel"}</div>
              </button>
              <ChoicePill active={false} onClick={() => toggleFactorMeal(nextMeal)}>Log</ChoicePill>
            </div>
          ) : (
            <button type="button" onClick={onOpenFuel} style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 12, border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
              <span>
                <span style={{ display: "block", fontFamily: mono, fontSize: 9, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>{factor ? "Meals complete" : "Fuel"}</span>
                <span style={{ display: "block", fontSize: 12, color: factor ? C.green : C.textDim, marginTop: 3 }}>{factor ? "Factor lunch and dinner are logged." : "Open the full meal and macro plan."}</span>
              </span>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.textDim, alignSelf: "center" }}>Fuel →</span>
            </button>
          )}

          <button type="button" onClick={() => setSheet("closeout")} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12, padding: "11px 0 0", border: "none", borderTop: `1px solid ${C.line}`, background: "none", cursor: "pointer", textAlign: "left" }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: mono, fontSize: 9, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>Day progress</span>
              <span style={{ display: "block", fontSize: 11, color: C.textDim, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{storedCloseout ? `Closed · ${storedCloseout.status}` : openSummary || "All core targets complete"}</span>
            </span>
            <span style={{ fontFamily: mono, fontSize: 17, color: storedCloseout ? C.green : C.text, flexShrink: 0 }}>{storedCloseout?.score ?? closeout.score}% ›</span>
          </button>
        </div>
      </section>

      <BottomSheet open={sheet === "mode"} title="Choose the day mode" eyebrow="Physique OS" onClose={() => setSheet(null)}>
        <div style={{ display: "grid", gap: 8 }}>
          {Object.entries(DAY_MODES).map(([key, item]) => {
            const active = mode === key;
            return (
              <button key={key} type="button" onClick={() => chooseMode(key)} style={{ width: "100%", display: "grid", gridTemplateColumns: "22px 1fr auto", alignItems: "start", gap: 10, padding: "13px 12px", border: `1px solid ${active ? C.text : C.line}`, background: active ? C.block : "transparent", color: C.text, cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontFamily: mono, fontSize: 15 }}>{active ? "●" : "○"}</span>
                <span>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 650 }}>{item.label}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: C.textDim, lineHeight: 1.45, marginTop: 3 }}>{item.short}</span>
                </span>
                {recommendedMode === key && <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", textTransform: "uppercase" }}>Recommended</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, marginTop: 14, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
          {[["Calories", targets.calories], ["Protein", `${targets.protein}g`], ["Steps", targets.steps.toLocaleString()], ["Sleep", `${targets.sleepHours}h`]].map(([label, value]) => (
            <div key={label} style={{ padding: "10px 7px", borderRight: `1px solid ${C.line}`, minWidth: 0 }}>
              <div style={{ fontFamily: mono, fontSize: 8.5, color: C.textFaint, textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontFamily: mono, fontSize: 12.5, color: C.text, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
            </div>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "checkin"} title="Morning check-in" eyebrow="20-second readiness" onClose={() => setSheet(null)}>
        <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, marginBottom: 12 }}>This updates the same recovery fields used everywhere else in 0VERTRAINED.</div>
        {CHECKIN_ROWS.map((row) => {
          const selected = selectedOption(row, todayData?.body?.[row.field]);
          return (
            <div key={row.field} style={{ padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>{row.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {row.options.map((option) => (
                  <ChoicePill
                    key={option.value}
                    active={selected?.value === option.value}
                    onClick={() => {
                      updateToday(`body.${row.field}`, String(option.value));
                      if (storedCloseout) updateToday("intelligence.physiqueOS.closeout", null);
                    }}
                  >
                    {option.text}
                  </ChoicePill>
                ))}
              </div>
            </div>
          );
        })}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "12px 0", borderTop: `1px solid ${C.line}`, fontSize: 11.5, lineHeight: 1.45, color: todayData?.body?.illnessOrInjury ? C.red : C.textDim }}>
          <input
            type="checkbox"
            checked={Boolean(todayData?.body?.illnessOrInjury)}
            onChange={(event) => {
              updateToday("body.illnessOrInjury", event.target.checked);
              if (storedCloseout) updateToday("intelligence.physiqueOS.closeout", null);
            }}
          />
          <span>Illness, injury, chest symptoms, or an unusual limitation today</span>
        </label>
        <button type="button" onClick={() => setSheet(null)} style={{ width: "100%", marginTop: 4, padding: "12px", border: `1px solid ${C.text}`, background: C.text, color: C.bg, fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer" }}>Done · {checkin.answered}/{checkin.total}</button>
      </BottomSheet>

      <BottomSheet open={sheet === "detail"} title="Why this plan" eyebrow="Coach detail" onClose={() => setSheet(null)}>
        <div style={{ fontSize: 15, fontWeight: 650, color: C.text }}>{decision?.title || prescription.title}</div>
        {decision?.subtitle && <div style={{ fontFamily: S.fontSerif, fontSize: 14, fontStyle: "italic", color: C.textDim, lineHeight: 1.45, marginTop: 5 }}>{decision.subtitle}</div>}
        {decision?.doList?.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>Do</div>
            {decision.doList.map((item, index) => <div key={index} style={{ fontSize: 12, color: C.text, lineHeight: 1.5, paddingTop: 5 }}>▸ {item}</div>)}
          </div>
        )}
        {decision?.avoidList?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>Avoid</div>
            {decision.avoidList.map((item, index) => <div key={index} style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, paddingTop: 5 }}>× {item}</div>)}
          </div>
        )}
        {decision?.watchList?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>Watch</div>
            {decision.watchList.map((item, index) => <div key={index} style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, paddingTop: 5 }}>◦ {item}</div>)}
          </div>
        )}
        {decision?.reasons?.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>Signals used</div>
            {decision.reasons.slice(0, 5).map((reason, index) => <div key={index} style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, paddingTop: 5 }}>▸ {reason}</div>)}
          </div>
        )}
        {(decision?.sourceBadges?.length > 0 || decision?.confidence || decision?.risk) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {(decision.sourceBadges || []).map((badge) => <span key={badge} style={{ border: `1px solid ${C.lineBright}`, padding: "3px 6px", fontFamily: mono, fontSize: 9, color: C.textDim, textTransform: "uppercase" }}>{badge}</span>)}
            {decision.confidence && <span style={{ fontFamily: mono, fontSize: 9, color: C.textFaint, padding: "4px 0" }}>CONF {decision.confidence}</span>}
            {decision.risk && <span style={{ fontFamily: mono, fontSize: 9, color: decision.risk === "High" ? C.red : C.textFaint, padding: "4px 0" }}>RISK {decision.risk}</span>}
          </div>
        )}
        {adjustment && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
            <TrainingAdjustmentInline
              suggestion={adjustment.suggestion}
              accepted={adjustment.accepted}
              keptOriginal={adjustment.keptOriginal}
              onAccept={adjustment.onAccept}
              onKeepOriginal={adjustment.onKeepOriginal}
            />
          </div>
        )}
        {outlook && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>{outlook.eyebrow}</div>
            <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, marginTop: 5 }}>{outlook.text}</div>
          </div>
        )}
        {onResponse && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
            <div style={{ fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>After session</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 8 }}>
              {["followed", "modified", "ignored", "skipped"].map((response) => (
                <ChoicePill key={response} active={currentResponse === response} onClick={() => onResponse(response)}>{response[0].toUpperCase() + response.slice(1)}</ChoicePill>
              ))}
            </div>
            {feedbackBrief && <div style={{ fontSize: 10.5, color: C.textFaint, lineHeight: 1.45, marginTop: 8 }}>{feedbackBrief}</div>}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === "closeout"} title="Close the loop" eyebrow="Evening review" onClose={() => setSheet(null)}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "end" }}>
          <label style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: mono, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Steps today {finite(wearableSteps) !== null && manualSteps === "" ? "· wearable" : ""}</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={manualSteps}
              placeholder={String(Math.round(effectiveSteps))}
              onChange={(event) => {
                updateToday("activity.steps", event.target.value);
                if (storedCloseout) updateToday("intelligence.physiqueOS.closeout", null);
              }}
              style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.lineBright}`, color: C.text, fontFamily: mono, fontSize: 16, padding: "10px", outline: "none" }}
            />
          </label>
          <span style={{ fontFamily: mono, color: storedCloseout ? C.green : C.text, fontSize: 26 }}>{storedCloseout?.score ?? closeout.score}%</span>
        </div>
        <div style={{ marginTop: 14 }}>
          {closeout.items.map((item) => (
            <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: `1px solid ${C.line}`, fontSize: 11.5, color: item.done ? C.textDim : C.text }}>
              <span>{item.label}</span>
              <span style={{ fontFamily: mono, fontSize: 9.5, color: statusInk(C, item.done) }}>{item.done ? "DONE" : "OPEN"}</span>
            </div>
          ))}
        </div>
        {storedCloseout ? (
          <button type="button" onClick={() => { updateToday("intelligence.physiqueOS.closeout", null); setSheet(null); }} style={{ width: "100%", marginTop: 14, padding: "12px", border: `1px solid ${C.lineBright}`, background: "transparent", color: C.text, fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>Reopen day</button>
        ) : (
          <button type="button" onClick={() => { closeDay(); setSheet(null); }} style={{ width: "100%", marginTop: 14, padding: "13px", border: `1px solid ${C.text}`, background: C.text, color: C.bg, fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer" }}>Close day · {closeout.score}%</button>
        )}
        {!storedCloseout && closeout.openItems.length > 0 && <div style={{ fontSize: 10.5, color: C.textFaint, lineHeight: 1.5, marginTop: 8 }}>A partial day can still be closed. The system records reality without prescribing compensation tomorrow.</div>}
      </BottomSheet>
    </>
  );
}

export default PhysiqueOSPanel;
