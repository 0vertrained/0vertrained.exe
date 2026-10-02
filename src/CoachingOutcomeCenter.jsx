import { useMemo, useState } from "react";
import { useTheme } from "./theme";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { WeeklyCoachingReview } from "./WeeklyCoachingReview";
import { buildNutritionAutopilot } from "./nutritionAutopilot";
import {
  buildOutcomeLoop,
  buildGoalProjection,
  buildMonthlyPhysiqueReview,
  buildPhaseTransitionRecommendation,
  buildCoachingInbox,
  buildCoachingSettingsPatch,
  dateKey,
} from "./coachingOutcomeLoop";

function Meta({ children, tone }) {
  const { C } = useTheme();
  const color = tone === "good" ? C.green : tone === "bad" ? C.red : tone === "warn" ? C.amber : C.textFaint;
  return <span style={{ fontSize: 9.5, color, letterSpacing: "0.1em", textTransform: "uppercase" }}>{children}</span>;
}

function Block({ title, stat, children, style }) {
  const { S } = useTheme();
  return (
    <section style={{ ...S.block, ...style }}>
      <div style={S.blockHead}><span style={S.blockTitle}>{"> "}{title}</span>{stat ? <span style={S.blockStat}>{stat}</span> : null}</div>
      {children}
    </section>
  );
}

function MetricGrid({ items }) {
  const { C } = useTheme();
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))`, gap: 1, background: C.lineBright, border: `1px solid ${C.lineBright}` }}>
      {items.map((item) => (
        <div key={item.label} style={{ padding: "10px 8px", background: C.bg, minWidth: 0 }}>
          <div style={{ fontSize: 15, color: item.tone === "good" ? C.green : item.tone === "bad" ? C.red : C.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.value}</div>
          <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3 }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function CoachingInbox({ inbox }) {
  const { C } = useTheme();
  return (
    <Block title="Coaching inbox" stat={`${inbox.count} open`}>
      {!inbox.items.length ? (
        <div style={{ padding: "12px 0", color: C.textDim, fontSize: 12 }}>Nothing needs a decision right now.</div>
      ) : inbox.items.map((item) => (
        <div key={item.id} style={{ display: "grid", gridTemplateColumns: "8px 1fr", gap: 9, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.priority === 0 ? C.red : item.priority === 1 ? C.amber : C.textFaint, marginTop: 5 }} />
          <div>
            <div style={{ fontSize: 12.5, color: C.text }}>{item.title}</div>
            <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.45, marginTop: 2 }}>{item.detail}</div>
          </div>
        </div>
      ))}
    </Block>
  );
}

function OutcomeHistory({ outcomeLoop }) {
  const { C } = useTheme();
  const records = outcomeLoop.records.slice(0, 6);
  return (
    <Block title="Recommendation lifecycle" stat={`${outcomeLoop.evaluated.length} evaluated`}>
      {!records.length ? <div style={{ padding: "12px 0", color: C.textDim, fontSize: 12 }}>Approve a weekly recommendation to begin the outcome loop.</div> : records.map((record) => {
        const tone = record.outcome.status === "effective" ? "good" : record.outcome.status === "harmful" ? "bad" : record.outcome.status === "active" ? "warn" : undefined;
        return (
          <div key={`${record.date}-${record.recommendationId}`} style={{ padding: "11px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontSize: 12.5, color: C.text, textTransform: "capitalize" }}>{record.kind.replace(/_/g, " ")}</div>
              <Meta tone={tone}>{record.outcome.label}</Meta>
            </div>
            <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.45, marginTop: 4 }}>
              {record.outcome.status === "active"
                ? `Active through ${record.outcome.due} · ${record.outcome.daysRemaining} days remaining`
                : record.outcome.reason || `Weight ${record.outcome.deltas?.weight ?? "—"} lb · waist ${record.outcome.deltas?.waist ?? "—"} in · adherence ${record.outcome.adherence ?? "—"}%`}
            </div>
          </div>
        );
      })}
    </Block>
  );
}

function PlanVersions({ outcomeLoop, settings, onSaveCoachingSettings, showToast }) {
  const { C, S } = useTheme();
  const active = settings?.coachingSystem?.activePlan || outcomeLoop.activePlan;
  const history = outcomeLoop.planVersions.slice(0, 5);
  const rollback = (plan) => {
    if (!onSaveCoachingSettings) return;
    const current = settings?.coachingSystem?.activePlan || null;
    const restored = { ...plan, status: "active", restoredAt: new Date().toISOString(), restoredFromVersionId: current?.id || null };
    onSaveCoachingSettings({
      ...settings,
      goals: { ...(settings.goals || {}), ...(restored.snapshot?.goals || {}) },
      coachingPhase: { ...(settings.coachingPhase || {}), phase: restored.snapshot?.phase || settings?.coachingPhase?.phase },
      coachingSystem: { ...(settings.coachingSystem || {}), activePlan: restored },
    });
    showToast?.(`${restored.label || "Plan"} restored`);
  };
  return (
    <Block title="Plan versions" stat={active?.label || "No active plan"}>
      {active ? (
        <div style={{ padding: "2px 0 10px" }}>
          <div style={{ fontSize: 20, fontFamily: S.fontSerif, color: C.text }}>{active.label}</div>
          <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5, marginTop: 4 }}>
            {active.snapshot?.goals?.calories || settings?.goals?.calories || "—"} kcal · {active.snapshot?.goals?.protein || settings?.goals?.protein || "—"}g protein · {(active.snapshot?.goals?.steps || settings?.goals?.steps || 9000).toLocaleString()} steps
          </div>
          {(active.snapshot?.trainingModifiers?.volumeReductionPct || 0) > 0 && <div style={{ fontSize: 10.5, color: C.amber, marginTop: 4 }}>Training volume reduced {active.snapshot.trainingModifiers.volumeReductionPct}% while this plan is active.</div>}
        </div>
      ) : <div style={{ padding: "10px 0", fontSize: 12, color: C.textDim }}>The first approved weekly change will create Plan v1.</div>}
      {history.map((plan) => (
        <div key={plan.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
          <div>
            <div style={{ fontSize: 11.5, color: C.text }}>{plan.label} · {String(plan.recommendationKind || "continue").replace(/_/g, " ")}</div>
            <div style={{ fontSize: 9.5, color: C.textFaint, marginTop: 2 }}>Effective {plan.effectiveDate || "—"}</div>
          </div>
          {active?.id !== plan.id && <button type="button" onClick={() => rollback(plan)} style={{ ...S.smallBtn, padding: "6px 9px" }}>Restore</button>}
        </div>
      ))}
    </Block>
  );
}

function Projection({ projection, settings, onSaveCoachingSettings, showToast }) {
  const { C, S } = useTheme();
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState(String(projection.goalRange.min ?? 178));
  const [max, setMax] = useState(String(projection.goalRange.max ?? 185));
  const save = () => {
    const nextMin = Number.parseFloat(min);
    const nextMax = Number.parseFloat(max);
    if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax) || nextMin > nextMax) return showToast?.("Enter a valid goal range");
    const next = buildCoachingSettingsPatch(settings, { goalWeightRange: { min: nextMin, max: nextMax } });
    onSaveCoachingSettings?.(next);
    setEditing(false);
    showToast?.("Goal range updated");
  };
  return (
    <Block title="Goal projection" stat={`${projection.confidence} confidence`}>
      <MetricGrid items={[
        { label: "Trend weight", value: projection.currentWeight ? `${projection.currentWeight} lb` : "—" },
        { label: "Goal range", value: `${projection.goalRange.min}–${projection.goalRange.max}` },
        { label: "Recent rate", value: projection.recentRate != null ? `${projection.recentRate} lb/wk` : "—", tone: projection.recentRate < 0 ? "good" : undefined },
      ]} />
      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5, marginTop: 11 }}>
        {projection.estimatedWindow ? `Estimated window: ${projection.estimatedWindow.start} to ${projection.estimatedWindow.end}.` : "No responsible completion window yet."}
      </div>
      <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5, marginTop: 4 }}>{projection.note}</div>
      {!editing ? <button type="button" onClick={() => setEditing(true)} style={{ ...S.smallBtn, marginTop: 10 }}>Edit goal range</button> : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 7, marginTop: 10 }}>
          <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" aria-label="Minimum goal weight" style={{ background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`, padding: "8px 9px", minWidth: 0 }} />
          <input value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" aria-label="Maximum goal weight" style={{ background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`, padding: "8px 9px", minWidth: 0 }} />
          <button type="button" onClick={save} style={{ ...S.smallBtn, padding: "8px 10px" }}>Save</button>
        </div>
      )}
    </Block>
  );
}

function MonthlyReview({ review, todayKey, data, updateEntryAtDate, showToast }) {
  const { C, S } = useTheme();
  const logged = Array.isArray(data?.[todayKey]?.body?.progressPhotos) ? data[todayKey].body.progressPhotos : [];
  const addPhotoSet = () => {
    const snapshot = { id: `photos-${Date.now()}`, recordedAt: new Date().toISOString(), poses: ["front", "side", "back"], standard: "same-lighting-distance-time" };
    updateEntryAtDate?.(todayKey, "body.progressPhotos", [...logged, snapshot]);
    showToast?.("Photo-check protocol recorded");
  };
  return (
    <Block title="Monthly physique review" stat={`${review.periodStart} → ${review.periodEnd}`}>
      <MetricGrid items={[
        { label: "Weight", value: review.weightDelta == null ? "—" : `${review.weightDelta > 0 ? "+" : ""}${review.weightDelta} lb`, tone: review.weightDelta < 0 ? "good" : undefined },
        { label: "Waist", value: review.waistDelta == null ? "—" : `${review.waistDelta > 0 ? "+" : ""}${review.waistDelta} in`, tone: review.waistDelta < 0 ? "good" : undefined },
        { label: "Protein", value: `${review.current.proteinAdherence}%` },
        { label: "Strength", value: review.strengthStatus, tone: review.strengthStatus === "stable" ? "good" : "bad" },
      ]} />
      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5, marginTop: 11 }}>{review.assessment}</div>
      <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5, marginTop: 4 }}>{review.nextBlock}</div>
      <div style={{ marginTop: 11, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 10, color: C.text, letterSpacing: "0.1em", textTransform: "uppercase" }}>Standard photo protocol</div>
        <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5, marginTop: 4 }}>Front · side · back · same room · same light · same camera distance · same time of day.</div>
        <button type="button" onClick={addPhotoSet} style={{ ...S.smallBtn, marginTop: 8 }}>Mark photo set complete</button>
      </div>
    </Block>
  );
}

function PhaseCard({ transition, settings, onSaveCoachingSettings, showToast }) {
  const { C, S } = useTheme();
  const apply = () => {
    if (transition.kind !== "transition") return;
    const next = buildCoachingSettingsPatch({ ...settings, coachingPhase: { ...(settings.coachingPhase || {}), phase: transition.to } }, { phase: transition.to });
    onSaveCoachingSettings?.(next);
    showToast?.(`Phase changed to ${transition.to.replace(/_/g, " ")}`);
  };
  return (
    <Block title="Phase management" stat={transition.confidence}>
      <div style={{ fontFamily: S.fontSerif, fontSize: 20, color: transition.kind === "transition" ? C.amber : C.text }}>{transition.title}</div>
      <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5, marginTop: 5 }}>{transition.reason}</div>
      {transition.kind === "transition" && <button type="button" onClick={apply} style={{ ...S.smallBtn, marginTop: 10 }}>Approve transition</button>}
    </Block>
  );
}

function Controls({ settings, onSaveCoachingSettings, showToast }) {
  const { C, S } = useTheme();
  const normalized = buildCoachingSettingsPatch(settings).coachingSystem;
  const [open, setOpen] = useState(false);
  const [guardrails, setGuardrails] = useState(normalized.clinicianGuardrails);
  const [prefs, setPrefs] = useState(normalized.notificationPrefs);
  const save = () => {
    const next = buildCoachingSettingsPatch(settings, { clinicianGuardrails: guardrails, notificationPrefs: prefs });
    onSaveCoachingSettings?.(next);
    showToast?.("Coaching controls saved");
  };
  return (
    <Block title="Coach controls" stat={open ? "Close" : "Open"}>
      <button type="button" onClick={() => setOpen((value) => !value)} style={{ ...S.smallBtn, width: "100%" }}>{open ? "Hide controls" : "Notifications and clinician guardrails"}</button>
      {open && <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, color: C.text, letterSpacing: "0.12em", textTransform: "uppercase" }}>Coaching notification policy</div>
        <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.45, marginTop: 4 }}>These switches control the coaching inbox now. Existing remote push delivery remains managed in Profile → Notifications.</div>
        {[
          ["morningCheckin", "Morning check-in"], ["scheduledTraining", "Scheduled training"], ["proteinGap", "Late protein gap"], ["factorInventory", "Factor inventory"], ["weeklyReview", "Weekly review"], ["fatiguePattern", "Unusual fatigue pattern"], ["progressPhotoDay", "Progress-photo day"],
        ].map(([key, label]) => <label key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: `1px solid ${C.line}`, fontSize: 11.5, color: C.textDim }}><span>{label}</span><input type="checkbox" checked={prefs[key] !== false} onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })} /></label>)}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 9 }}>
          <label style={{ fontSize: 9.5, color: C.textFaint }}>Quiet start<input type="time" value={prefs.quietHours?.start || "21:30"} onChange={(e) => setPrefs({ ...prefs, quietHours: { ...(prefs.quietHours || {}), start: e.target.value } })} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, padding: 7, background: C.bg, color: C.text, border: `1px solid ${C.lineBright}` }} /></label>
          <label style={{ fontSize: 9.5, color: C.textFaint }}>Quiet end<input type="time" value={prefs.quietHours?.end || "07:00"} onChange={(e) => setPrefs({ ...prefs, quietHours: { ...(prefs.quietHours || {}), end: e.target.value } })} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, padding: 7, background: C.bg, color: C.text, border: `1px solid ${C.lineBright}` }} /></label>
        </div>
        <div style={{ fontSize: 10, color: C.text, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 16 }}>Clinician guardrails</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", fontSize: 11.5, color: C.text }}><input type="checkbox" checked={guardrails.enabled === true} onChange={(e) => setGuardrails({ ...guardrails, enabled: e.target.checked })} />Enforce clinician-defined constraints</label>
        {[
          ["exerciseHeartRateGuidance", "Exercise heart-rate guidance"], ["stopRules", "Symptom-based stop rules"], ["medicationNotes", "Medication notes"], ["trainingRestrictions", "Training restrictions"], ["emergencyInstructions", "Emergency instructions"],
        ].map(([key, label]) => <label key={key} style={{ display: "block", fontSize: 9.5, color: C.textFaint, marginTop: 8 }}>{label}<textarea value={guardrails[key] || ""} onChange={(e) => setGuardrails({ ...guardrails, [key]: e.target.value })} rows={key === "stopRules" ? 3 : 2} style={{ width: "100%", boxSizing: "border-box", marginTop: 4, background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`, padding: "8px 9px", fontFamily: C.fontFamily, fontSize: 11 }} /></label>)}
        <label style={{ display: "block", fontSize: 9.5, color: C.textFaint, marginTop: 8 }}>Clinician review date<input type="date" value={guardrails.clinicianReviewDate || ""} onChange={(e) => setGuardrails({ ...guardrails, clinicianReviewDate: e.target.value })} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`, padding: "8px 9px" }} /></label>
        <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5, marginTop: 9 }}>These are hard constraints for coaching decisions. They do not replace medical care or emergency services.</div>
        <button type="button" onClick={save} style={{ ...S.smallBtn, width: "100%", marginTop: 10 }}>Save controls</button>
      </div>}
    </Block>
  );
}

export function CoachingOutcomeCenter({ review, data, settings, updateEntryAtDate, showToast, onSaveCoachingSettings }) {
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const todayKey = dateKey();
  const outcomeLoop = useMemo(() => buildOutcomeLoop({ data, settings, todayKey }), [data, settings, todayKey]);
  const projection = useMemo(() => buildGoalProjection({ data, settings, todayKey }), [data, settings, todayKey]);
  const monthlyReview = useMemo(() => buildMonthlyPhysiqueReview({ data, settings, todayKey }), [data, settings, todayKey]);
  const phaseTransition = useMemo(() => buildPhaseTransitionRecommendation({ monthlyReview, settings, projection }), [monthlyReview, settings, projection]);
  const nutritionAutopilot = useMemo(() => buildNutritionAutopilot({ data, todayKey, nutrition: data?.[todayKey]?.nutrition || {}, goals: settings?.goals || {}, hour: new Date().getHours() }), [data, todayKey, settings]);
  const inbox = useMemo(() => buildCoachingInbox({
    review,
    outcomeLoop,
    nutritionAutopilot,
    phaseTransition,
    notificationPrefs: settings?.coachingSystem?.notificationPrefs || {},
    todayKey,
  }), [review, outcomeLoop, nutritionAutopilot, phaseTransition, settings, todayKey]);

  return (
    <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, .8fr)", gap: 20, alignItems: "start", padding: "18px 0" } : { display: "contents" }}>
      <div style={isBroadsheet ? { minWidth: 0 } : undefined}>
        <WeeklyCoachingReview review={review} data={data} settings={settings} updateEntryAtDate={updateEntryAtDate} showToast={showToast} onSaveCoachingSettings={onSaveCoachingSettings} />
        <OutcomeHistory outcomeLoop={outcomeLoop} />
        <MonthlyReview review={monthlyReview} todayKey={todayKey} data={data} updateEntryAtDate={updateEntryAtDate} showToast={showToast} />
      </div>
      <aside style={isBroadsheet ? { minWidth: 0 } : undefined}>
        <CoachingInbox inbox={inbox} />
        <PlanVersions outcomeLoop={outcomeLoop} settings={settings} onSaveCoachingSettings={onSaveCoachingSettings} showToast={showToast} />
        <Projection projection={projection} settings={settings} onSaveCoachingSettings={onSaveCoachingSettings} showToast={showToast} />
        <PhaseCard transition={phaseTransition} settings={settings} onSaveCoachingSettings={onSaveCoachingSettings} showToast={showToast} />
        <Controls settings={settings} onSaveCoachingSettings={onSaveCoachingSettings} showToast={showToast} />
      </aside>
    </div>
  );
}

export default CoachingOutcomeCenter;
