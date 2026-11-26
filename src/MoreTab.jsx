// src/MoreTab.jsx
// Train's program screens: ProgramTab with its editors. The file keeps its
// old name until those screens are rebuilt; Profile lives in
// ProfileScreen.jsx.
import { useState } from "react";
import { useTheme } from "./theme";
import { DEFAULT_PROGRAM, DAYS, PROGRAM_PRESETS, PRESET_LINEUP, presetProgram, getTodayKey } from "./constants";
import { resolveTrackingMode, TRACKING_MODES } from "./workoutLogging";
import { seedSupersetPrefsFromProgram } from "./liftLogPrefs";
import { buildSplitSessionsFromLegacy, getProgramSessions, usesProgramSessions } from "./programSessions";
import { ProgramBuilderPanel } from "./ProgramBuilderPanel";
import { useConfirm } from "./ui/ConfirmDialog";
import { RacePlanPanel } from "./RacePlanPanel";
import { isRunPlanSpec } from "./runPlanGenerator";
import { describeBuildWeek, keepRacePlan } from "./raceBuild";
import { formatPlanDate, raceWeekCopy } from "./RaceWeekLine";

// Exported for Train, which is now the home of the plan.
export function ProgramTab({  program, onSaveProgram, onApplyGeneratedProgram, settings, initialAction }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const { confirm, confirmDialog } = useConfirm();
  // initialAction lets the More hub open this tab straight into a
  // sub-flow — "generate" → Program Builder, "switch" → preset browser,
  // "edit" → weekly editor — so the hub cards are one tap from the action.
  // Unknown/omitted values fall through to the weekly program overview.
  const [editMode, setEditMode]       = useState(initialAction === "edit");
  const [draft, setDraft]             = useState(initialAction === "edit" ? JSON.parse(JSON.stringify(program || DEFAULT_PROGRAM)) : null);
  const [openDay, setOpenDay]         = useState(initialAction === "edit" ? DAYS[0] : null);
  const [busy, setBusy]               = useState(false);
  const [showPresets, setShowPresets] = useState(initialAction === "switch");
  const [previewPreset, setPreviewPreset] = useState(null); // preset id being previewed
  const [builderOpen, setBuilderOpen] = useState(initialAction === "generate"); // V2.3 Program Builder panel
  const [racePlanOpen, setRacePlanOpen] = useState(initialAction === "race");   // race plan panel
  const hasRacePlan = isRunPlanSpec(program?.__raceBuild);

  const enterEdit = () => {
    setDraft(JSON.parse(JSON.stringify(program || DEFAULT_PROGRAM)));
    setEditMode(true);
    setOpenDay(DAYS[0]);
  };

  const cancelEdit = () => { setEditMode(false); setDraft(null); };

  const commitEdit = async () => {
    if (!(await confirm({ message: "Save changes to your program? This will overwrite your current split.", confirmLabel: "Save changes" }))) return;
    setBusy(true);
    const ok = await onSaveProgram(draft);
    setBusy(false);
    if (ok) { setEditMode(false); setDraft(null); }
  };

  const loadPreset = async (presetId) => {
    const preset = PROGRAM_PRESETS[presetId];
    const basePreset = presetProgram(presetId);
    const keepsPlan = hasRacePlan && !basePreset.__raceBuild;
    if (!(await confirm({ message: `Switch to "${preset.name}"? This will replace your current program.${keepsPlan ? " Your race plan stays." : ""}`, confirmLabel: "Switch program" }))) return;
    setBusy(true);
    const programToSave = keepRacePlan(program, basePreset);
    const ok = await onSaveProgram(programToSave);
    setBusy(false);
    if (ok) {
      // Preset-declared supersets go live immediately (sticky prefs).
      seedSupersetPrefsFromProgram(programToSave);
      setShowPresets(false); setPreviewPreset(null);
    }
  };

  const prog = editMode ? draft : (program || DEFAULT_PROGRAM);

  // ── Program Builder V2 — generate a plan. Cancel leaves the current
  // program untouched; Apply is handled by onApplyGeneratedProgram. ──
  if (builderOpen) {
    return (
      <ProgramBuilderPanel
        settings={settings}
        currentProgram={program}
        initialGoal={settings?.programBuilder?.goal || undefined}
        onCancel={() => setBuilderOpen(false)}
        onApply={async (payload) => {
          const ok = await onApplyGeneratedProgram({ ...payload, program: keepRacePlan(program, payload.program) });
          if (ok !== false) setBuilderOpen(false);
        }}
      />
    );
  }

  // ── Race plan — Save writes the spec into the program's marker;
  // End removes it. Both go through the normal program save path. ──
  if (racePlanOpen) {
    return (
      <RacePlanPanel
        program={program || DEFAULT_PROGRAM}
        todayKey={getTodayKey()}
        onCancel={() => setRacePlanOpen(false)}
        onSave={async (spec) => {
          const ok = await onSaveProgram({ ...(program || DEFAULT_PROGRAM), __raceBuild: spec });
          if (ok) setRacePlanOpen(false);
          return ok;
        }}
        onEnd={async () => {
          const next = { ...(program || DEFAULT_PROGRAM) };
          delete next.__raceBuild;
          const ok = await onSaveProgram(next);
          if (ok) setRacePlanOpen(false);
          return ok;
        }}
      />
    );
  }

  if (editMode && draft) {
    return <>{confirmDialog}<ProgramEditor draft={draft} setDraft={setDraft} openDay={openDay} setOpenDay={setOpenDay} onCancel={cancelEdit} onSave={commitEdit} busy={busy} /></>;
  }

  // ── Preset browser ──
  if (showPresets) {
    const preview = previewPreset ? PROGRAM_PRESETS[previewPreset] : null;
    return (
      <div>
        {confirmDialog}
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.line}`, background:C.panel, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:14, fontWeight:600, color:C.text }}>Switch Program</div>
          <button onClick={() => { setShowPresets(false); setPreviewPreset(null); }} style={{ background:"none", border:`1px solid ${C.lineBright}`, color:C.textDim, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", fontFamily:mono, padding:"4px 10px" }}>← Back</button>
        </div>

        {/* Preset list */}
        {!previewPreset && (
          <div style={{ padding:"12px 16px" }}>
            <div style={{ fontSize:11, color:C.textDim, letterSpacing:"0.08em", marginBottom:14 }}>Tap a program to preview it before switching.</div>
            {PRESET_LINEUP.map(id => PROGRAM_PRESETS[id]).filter(Boolean).map(p => (
              <button key={p.id} onClick={() => setPreviewPreset(p.id)}
                style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", background:C.block, border:`1px solid ${C.lineBright}`, padding:"14px 16px", marginBottom:8, cursor:"pointer", fontFamily:mono, textAlign:"left" }}>
                <div>
                  <div style={{ fontSize:13.5, fontWeight:600, color:C.text, marginBottom:4 }}>{p.name}</div>
                  <div style={{ fontSize:11, color:C.textDim, lineHeight:1.6, marginBottom:6 }}>{p.desc}</div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {p.tags.map(t => (
                      <span key={t} style={{ fontSize:9.5, letterSpacing:"0.1em", padding:"2px 7px", border:`1px solid ${C.lineBright}`, color:C.textDim }}>{t}</span>
                    ))}
                  </div>
                </div>
                <span style={{ color:C.text, fontSize:14, marginLeft:12 }}>→</span>
              </button>
            ))}
          </div>
        )}

        {/* Preset preview */}
        {previewPreset && preview && (() => {
          const previewProg = presetProgram(previewPreset);
          return (
            <div>
              <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.line}`, background:C.block }}>
                <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:4 }}>{preview.name}</div>
                <div style={{ fontSize:11, color:C.textDim, marginBottom:10 }}>{preview.desc}</div>
                <button onClick={() => loadPreset(previewPreset)} disabled={busy}
                  style={{ width:"100%", padding:"11px", background:C.bg, border:`1px solid ${C.text}`, color:C.text, fontFamily:mono, fontSize:11.5, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer" }}>
                  {busy ? "Switching..." : "Switch to This Program"}
                </button>
              </div>
              {/* Day-by-day preview */}
              <div style={{ padding:"0 16px" }}>
                {DAYS.map(day => {
                  const d = previewProg[day] || {};
                  const sessions = getProgramSessions(d);
                  const hasTraining = sessions.length > 0;
                  if (!hasTraining) return (
                    <div key={day} style={{ padding:"9px 0", borderBottom:`1px solid ${C.line}`, display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontSize:13, color:C.text }}>{day}</span>
                      <span style={{ fontSize:11, color:C.textDim }}>Rest</span>
                    </div>
                  );
                  return (
                    <div key={day} style={{ padding:"9px 0", borderBottom:`1px solid ${C.line}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:13, color:C.text }}>{day}</span>
                        <span style={{ fontSize:11, color:C.text }}>{d.type}</span>
                      </div>
                      {getProgramSessions(d).map(session => (
                        <ProgramSessionBlock key={session.id} session={session} compact />
                      ))}
                    </div>
                  );
                })}
              </div>
              <div style={{ padding:16 }}>
                <button onClick={() => setPreviewPreset(null)} style={{ width:"100%", padding:"10px", background:"none", border:`1px solid ${C.lineBright}`, color:C.textDim, fontFamily:mono, fontSize:11, cursor:"pointer", letterSpacing:"0.1em" }}>← Back to programs</button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  if (editMode && draft) {
    return <>{confirmDialog}<ProgramEditor draft={draft} setDraft={setDraft} openDay={openDay} setOpenDay={setOpenDay} onCancel={cancelEdit} onSave={commitEdit} busy={busy} /></>;
  }

  const todayKey = getTodayKey();
  const planCopy = hasRacePlan ? raceWeekCopy(describeBuildWeek(program, todayKey)) : null;
  return (
    <div>
      {hasRacePlan && (
        <div style={S.block} data-plate="race-plan">
          <div style={S.blockHead}>
            <span style={S.blockTitle}>{"> "}Race plan</span>
            <button style={S.smallBtn} onClick={() => setRacePlanOpen(true)}>[ EDIT ]</button>
          </div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>Race</span><span style={S.ruledValue}>{program.__raceBuild.raceName} · {formatPlanDate(program.__raceBuild.raceDate)}</span></div>
          <div style={S.ruledRow}><span style={S.ruledLabel}>{planCopy ? planCopy.eyebrow.replace(/^Race plan · /i, "") : "Status"}</span><span style={S.ruledValue}>{planCopy ? planCopy.main : "Race done. Set the next one"}</span></div>
          <div style={{ ...S.annotation, marginTop: 8 }}>runs come from the plan and show on Today. The list below is your base template: lifting as written.</div>
        </div>
      )}
      <div style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Weekly Program</span>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
            {!hasRacePlan && <button style={S.smallBtn} onClick={() => setRacePlanOpen(true)}>[ RACE PLAN ]</button>}
            <button style={S.smallBtn} onClick={() => setBuilderOpen(true)}>[ GENERATE ]</button>
            <button style={S.smallBtn} onClick={() => setShowPresets(true)}>[ SWITCH ]</button>
            <button style={S.smallBtn} onClick={enterEdit}>[ EDIT ]</button>
          </div>
        </div>
        {DAYS.map(day => {
          const p      = prog[day] || {};
          const isOpen = openDay === day;
          return (
            <div key={day}>
              <button type="button" aria-expanded={isOpen}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${day} program`}
                onClick={() => setOpenDay(isOpen ? null : day)}
                style={{ width:"100%", display:"flex", alignItems:"center", padding:"9px 0", border:"none", borderBottom:`1px solid ${C.line}`, background:"none", color:"inherit", cursor:"pointer", textAlign:"left" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13.5, color:C.text, textTransform:"uppercase", letterSpacing:"0.04em" }}>{day}</div>
                  <div style={{ fontSize:10, color:C.textDim, marginTop:2 }}>{p.type||"—"}</div>
                </div>
                <span style={{ color:C.text, fontSize:11.5 }} aria-hidden="true">{isOpen?"−":"+"}</span>
              </button>
              {isOpen && (
                <div style={{ padding:"10px 0 12px", borderBottom:`1px solid ${C.line}` }}>
                  {getProgramSessions(p).map(session => (
                    <ProgramSessionBlock key={session.id} session={session} />
                  ))}
                  {getProgramSessions(p).length === 0 && <div style={{ fontSize:11.5, color:C.textDim }}>Rest day</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Structured steps (what the cardio timer pre-fills from) describe the
// same workout as the type and notes. Rewriting either here makes them stale,
// so they're dropped and the timer goes back to reading the notes.
function editCardio(cardio, field, val) {
  const next = { ...cardio, [field]: field === "miles" ? parseFloat(val) || 0 : val };
  if (field === "type" || field === "notes") delete next.steps;
  return next;
}

// Program session display
// A hold's target is seconds and a carry's is yards (the set composer
// already reads them that way), so "3×45" on a plank reads as "3×45s".
function targetUnit(exercise) {
  const mode = resolveTrackingMode(exercise);
  if (mode === TRACKING_MODES.TIMED_HOLD) return "s";
  if (mode === TRACKING_MODES.CARRY) return " yd";
  return "";
}

function ProgramSessionBlock({ session, compact = false }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const liftCount = (session.lifting || []).length;
  const miles = Number(session.cardio?.miles) || 0;
  return (
    <div style={{ border:`1px solid ${C.lineBright}`, background:C.cell, padding: compact ? "7px 8px" : "9px 10px", marginTop: compact ? 6 : 8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8, marginBottom:6 }}>
        <div style={{ minWidth:0 }}>
          <span style={{ fontSize:10, color:C.text, letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:mono }}>{session.label}</span>
          <span style={{ fontSize:11.5, color:C.textDim, marginLeft:8 }}>{session.title}</span>
        </div>
        <span style={{ fontSize:10, color:C.textFaint, whiteSpace:"nowrap" }}>{liftCount} lifts{miles ? ` · ${miles}mi` : ""}</span>
      </div>
      {(session.lifting || []).map((ex, i) => (
        <div key={`${ex.name}-${i}`} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", gap:8 }}>
          <span style={{ fontSize: compact ? 9 : 10, color:C.textDim }}>{ex.name}</span>
          <span style={{ fontSize: compact ? 8 : 9, color:C.text, whiteSpace:"nowrap" }}>{ex.sets}×{ex.reps}{targetUnit(ex)}</span>
        </div>
      ))}
      {session.cardio && (
        <div style={{ marginTop:6, fontSize: compact ? 8 : 9, color:C.textDim, lineHeight:1.45 }}>
          CARDIO: {session.cardio.type || "Run"} · {session.cardio.miles || 0}mi · {session.cardio.effort || ""}
          {session.cardio.notes ? <><br/><span style={{ color:C.textFaint }}>// {session.cardio.notes}</span></> : null}
        </div>
      )}
    </div>
  );
}

// Program Editor
function ProgramEditor({  draft, setDraft, openDay, setOpenDay, onCancel, onSave, busy }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const day = openDay || DAYS[0];
  const p   = draft[day] || { type:"", code:"", lifting:[], cardio:null };

  const setDay = (field, val) => setDraft(prev => ({ ...prev, [day]: { ...prev[day], [field]: val } }));

  const setExercise = (i, field, val) => {
    const lifting = [...(p.lifting||[])];
    lifting[i] = { ...lifting[i], [field]: field==="sets"||field==="reps" ? parseInt(val)||0 : val };
    setDay("lifting", lifting);
  };

  const addExercise = () => {
    const lifting = [...(p.lifting||[]), { name:"New Exercise", sets:3, reps:10 }];
    setDay("lifting", lifting);
  };

  const removeExercise = (i) => {
    const lifting = (p.lifting||[]).filter((_,idx) => idx!==i);
    setDay("lifting", lifting);
  };

  const moveExercise = (i, dir) => {
    const lifting = [...(p.lifting||[])];
    const j = i+dir;
    if (j<0 || j>=lifting.length) return;
    [lifting[i], lifting[j]] = [lifting[j], lifting[i]];
    setDay("lifting", lifting);
  };

  const setCardio = (field, val) => {
    const cardio = editCardio(p.cardio || { type:"", miles:0, effort:"", notes:"" }, field, val);
    setDay("cardio", cardio);
  };

  const toggleCardio = () => setDay("cardio", p.cardio ? null : { type:"Run", miles:3, effort:"Zone 2", notes:"" });

  const inp = { ...S.cell, textAlign:"left", padding:"9px 10px", fontSize:14, fontWeight:400, marginBottom:6 };
  const numInp = { ...S.cell, textAlign:"center", fontSize:14, fontWeight:600 };
  const lbl = { fontSize:10, color:C.textDim, letterSpacing:"0.12em", textTransform:"uppercase", display:"block", marginBottom:4, marginTop:10 };

  if (usesProgramSessions(p)) {
    return <SessionProgramEditor draft={draft} setDraft={setDraft} openDay={openDay} setOpenDay={setOpenDay} onCancel={onCancel} onSave={onSave} busy={busy} />;
  }

  const splitToSessions = () => {
    setDraft(prev => ({ ...prev, [day]: buildSplitSessionsFromLegacy(prev[day] || p) }));
  };

  return (
    <div style={{ paddingBottom:80 }}>
      {/* Day selector */}
      <div style={{ display:"flex", overflowX:"auto", borderBottom:`1px solid ${C.line}`, background:C.panel, padding:"0 4px" }}>
        {DAYS.map(d => (
          <button key={d} onClick={() => setOpenDay(d)} style={{ padding:"10px 12px", background:"none", border:"none", borderBottom: openDay===d ? `2px solid ${C.green}` : "2px solid transparent", color: openDay===d ? C.green : C.textDim, fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", cursor:"pointer", fontFamily:mono, whiteSpace:"nowrap", flexShrink:0 }}>{d.slice(0,3)}</button>
        ))}
      </div>

      <div style={{ padding:"14px 16px" }}>
        {/* Day meta */}
        <label style={lbl}>Day Name / Type</label>
        <input style={inp} value={p.type||""} onChange={e => setDay("type", e.target.value)} placeholder="e.g. Push + Easy Run" />
        <label style={lbl}>Short Code (header)</label>
        <input style={inp} value={p.code||""} onChange={e => setDay("code", e.target.value)} placeholder="e.g. PUSH+RUN" />
        <button type="button" style={{ ...S.smallBtn, width:"100%", marginTop:10, justifyContent:"center" }} onClick={splitToSessions}>Split into AM/PM sessions</button>

        {/* Lifting */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, marginBottom:8 }}>
          <span style={{ ...S.blockTitle }}>Lifting</span>
          <button style={S.smallBtn} onClick={addExercise}>+ Add Exercise</button>
        </div>

        {(p.lifting||[]).length===0 && <div style={{ fontSize:11, color:C.textDim, marginBottom:8 }}>No lifting yet — tap Add Exercise.</div>}

        {(p.lifting||[]).map((ex, i) => (
          <div key={i} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, padding:"10px 12px", marginBottom:8 }}>
            <input style={{ ...inp, marginBottom:6 }} value={ex.name} onChange={e => setExercise(i,"name",e.target.value)} placeholder="Exercise name" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:6 }}>
              <div><span style={{ ...lbl, marginTop:0 }}>Sets</span><input style={numInp} type="number" inputMode="numeric" value={ex.sets} onChange={e => setExercise(i,"sets",e.target.value)} /></div>
              <div><span style={{ ...lbl, marginTop:0 }}>Reps</span><input style={numInp} type="number" inputMode="numeric" value={ex.reps} onChange={e => setExercise(i,"reps",e.target.value)} /></div>
              <div style={{ display:"flex", flexDirection:"column", justifyContent:"flex-end", gap:4 }}>
                <button type="button" aria-label="Move exercise up" style={{ ...S.smallBtn, fontSize:11.5 }} onClick={() => moveExercise(i,-1)}>↑</button>
                <button type="button" aria-label="Move exercise down" style={{ ...S.smallBtn, fontSize:11.5 }} onClick={() => moveExercise(i,+1)}>↓</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
                <button type="button" aria-label="Remove exercise" style={{ ...S.smallBtn, color:C.red, borderColor:"#5a1a14", fontSize:11.5 }} onClick={() => removeExercise(i)}>✕</button>
              </div>
            </div>
          </div>
        ))}

        {/* Cardio */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, marginBottom:8 }}>
          <span style={{ ...S.blockTitle }}>Cardio</span>
          <button style={S.smallBtn} onClick={toggleCardio}>{p.cardio ? "Remove Cardio" : "+ Add Cardio"}</button>
        </div>

        {p.cardio && (
          <div style={{ background:C.cell, border:`1px solid ${C.lineBright}`, padding:"10px 12px" }}>
            <label style={{ ...lbl, marginTop:0 }}>Type</label>
            <input style={inp} value={p.cardio.type||""} onChange={e => setCardio("type", e.target.value)} placeholder="e.g. Easy Run, Intervals, Tempo" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <div><label style={{ ...lbl, marginTop:4 }}>Target Miles</label><input style={numInp} type="number" inputMode="decimal" value={p.cardio.miles||""} onChange={e => setCardio("miles", e.target.value)} /></div>
              <div><label style={{ ...lbl, marginTop:4 }}>Effort</label><input style={inp} value={p.cardio.effort||""} onChange={e => setCardio("effort", e.target.value)} placeholder="Zone 2, 85%, High" /></div>
            </div>
            <label style={lbl}>Notes</label>
            <input style={inp} value={p.cardio.notes||""} onChange={e => setCardio("notes", e.target.value)} placeholder="coaching note shown on Today tab" />
          </div>
        )}

        {!p.cardio && (p.lifting||[]).length===0 && <div style={{ fontSize:11, color:C.textDim }}>Rest day — no lifting or cardio</div>}
      </div>

      {/* Sticky save/cancel bar */}
      <div style={{ position:"fixed", bottom:64, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:"var(--ovt-content-width)", display:"flex", gap:8, padding:"10px 16px", background:C.panel, borderTop:`1px solid ${C.lineBright}`, zIndex:150 }}>
        <button style={{ ...S.foodBtn, marginTop:0, flex:1, color:C.textDim, borderColor:C.lineBright }} onClick={onCancel}>Cancel</button>
        <button style={{ ...S.foodBtn, marginTop:0, flex:2 }} onClick={onSave} disabled={busy}>{busy ? "Saving..." : "Save Program"}</button>
      </div>
    </div>
  );
}

// AM/PM Program Editor
function SessionProgramEditor({ draft, setDraft, openDay, setOpenDay, onCancel, onSave, busy }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const day = openDay || DAYS[0];
  const p = draft[day] || { type:"", code:"", lifting:[], cardio:null, sessions:[] };
  const sessions = getProgramSessions(p);
  const [activeSessionId, setActiveSessionId] = useState(sessions[0]?.id || "am");
  const activeIndex = Math.max(0, sessions.findIndex(s => s.id === activeSessionId));
  const active = sessions[activeIndex] || sessions[0] || { id:"am", label:"AM", title:"AM Session", lifting:[], cardio:null };

  const updateDay = (nextDay) => setDraft(prev => ({ ...prev, [day]: { ...nextDay, lifting: [], cardio: null } }));
  const setDayField = (field, val) => updateDay({ ...p, [field]: val });
  const updateSessions = (nextSessions) => updateDay({ ...p, sessions: nextSessions, lifting: [], cardio: null });
  const updateSession = (idx, patch) => {
    const next = sessions.map((s, i) => i === idx ? { ...s, ...patch } : s);
    updateSessions(next);
  };
  const addSession = () => {
    const n = sessions.length + 1;
    const next = [...sessions, { id:`session-${n}`, label:`S${n}`, title:`Session ${n}`, lifting:[], cardio:null }];
    updateSessions(next);
    setActiveSessionId(`session-${n}`);
  };
  const duplicateSession = () => {
    const id = `${active.id}-copy`;
    const clone = { ...active, id, label:`${active.label}+`, title:`${active.title} Copy`, lifting:[...(active.lifting||[])], cardio: active.cardio ? { ...active.cardio } : null };
    const next = [...sessions.slice(0, activeIndex + 1), clone, ...sessions.slice(activeIndex + 1)];
    updateSessions(next);
    setActiveSessionId(id);
  };
  const removeSession = () => {
    const next = sessions.filter((_, i) => i !== activeIndex);
    updateSessions(next);
    setActiveSessionId(next[0]?.id || "am");
  };
  const moveSession = (dir) => {
    const j = activeIndex + dir;
    if (j < 0 || j >= sessions.length) return;
    const next = [...sessions];
    [next[activeIndex], next[j]] = [next[j], next[activeIndex]];
    updateSessions(next);
  };

  const setExercise = (i, field, val) => {
    const lifting = [...(active.lifting||[])];
    lifting[i] = { ...lifting[i], [field]: field==="sets"||field==="reps" ? parseInt(val)||0 : val };
    updateSession(activeIndex, { lifting });
  };
  const addExercise = () => updateSession(activeIndex, { lifting: [...(active.lifting||[]), { name:"New Exercise", sets:2, reps:10 }] });
  const removeExercise = (i) => updateSession(activeIndex, { lifting: (active.lifting||[]).filter((_, idx) => idx !== i) });
  const moveExercise = (i, dir) => {
    const lifting = [...(active.lifting||[])];
    const j = i + dir;
    if (j < 0 || j >= lifting.length) return;
    [lifting[i], lifting[j]] = [lifting[j], lifting[i]];
    updateSession(activeIndex, { lifting });
  };
  const setCardio = (field, val) => {
    const cardio = editCardio(active.cardio || { type:"", miles:0, effort:"", notes:"" }, field, val);
    updateSession(activeIndex, { cardio });
  };
  const toggleCardio = () => updateSession(activeIndex, { cardio: active.cardio ? null : { type:"Run", miles:2, effort:"Zone 2", notes:"" } });

  const inp = { ...S.cell, textAlign:"left", padding:"9px 10px", fontSize:14, fontWeight:400, marginBottom:6 };
  const numInp = { ...S.cell, textAlign:"center", fontSize:14, fontWeight:600 };
  const lbl = { fontSize:10, color:C.textDim, letterSpacing:"0.12em", textTransform:"uppercase", display:"block", marginBottom:4, marginTop:10 };

  return (
    <div style={{ paddingBottom:80 }}>
      <div style={{ display:"flex", overflowX:"auto", borderBottom:`1px solid ${C.line}`, background:C.panel, padding:"0 4px" }}>
        {DAYS.map(d => <button key={d} onClick={() => setOpenDay(d)} style={{ padding:"10px 12px", background:"none", border:"none", borderBottom: openDay===d ? `2px solid ${C.green}` : "2px solid transparent", color: openDay===d ? C.green : C.textDim, fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", cursor:"pointer", fontFamily:mono, whiteSpace:"nowrap", flexShrink:0 }}>{d.slice(0,3)}</button>)}
      </div>
      <div style={{ padding:"14px 16px" }}>
        <label style={lbl}>Day Name / Type</label>
        <input style={inp} value={p.type||""} onChange={e => setDayField("type", e.target.value)} />
        <label style={lbl}>Short Code</label>
        <input style={inp} value={p.code||""} onChange={e => setDayField("code", e.target.value)} />

        <div style={{ display:"flex", gap:6, overflowX:"auto", margin:"14px 0 10px" }}>
          {sessions.map(s => <button key={s.id} type="button" onClick={() => setActiveSessionId(s.id)} style={{ ...S.smallBtn, color: s.id===active.id ? C.text : C.textDim, borderColor: s.id===active.id ? C.text : C.lineBright }}>{s.label}</button>)}
          <button type="button" style={S.smallBtn} onClick={addSession}>+ Session</button>
        </div>

        <div style={{ background:C.block, border:`1px solid ${C.lineBright}`, padding:"12px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"80px 1fr", gap:8 }}>
            <div><label style={{ ...lbl, marginTop:0 }}>Label</label><input style={inp} value={active.label||""} onChange={e => updateSession(activeIndex, { label:e.target.value, id:e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"") || active.id })} /></div>
            <div><label style={{ ...lbl, marginTop:0 }}>Title</label><input style={inp} value={active.title||""} onChange={e => updateSession(activeIndex, { title:e.target.value })} /></div>
          </div>
          <label style={lbl}>Emphasis / Guardrail</label>
          <input style={inp} value={active.emphasis||""} onChange={e => updateSession(activeIndex, { emphasis:e.target.value })} placeholder="e.g. Heavy compounds · 1-2 RIR" />
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
            <button type="button" style={S.smallBtn} onClick={() => moveSession(-1)}>↑ Session</button>
            <button type="button" style={S.smallBtn} onClick={() => moveSession(1)}>↓ Session</button>
            <button type="button" style={S.smallBtn} onClick={duplicateSession}>Duplicate</button>
            <button type="button" style={{ ...S.smallBtn, color:C.red, borderColor:"#5a1a14" }} onClick={removeSession} disabled={sessions.length <= 1}>Remove</button>
          </div>
        </div>

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, marginBottom:8 }}>
          <span style={{ ...S.blockTitle }}>{active.label} Lifting</span>
          <button type="button" style={S.smallBtn} onClick={addExercise}>+ Add Exercise</button>
        </div>
        {(active.lifting||[]).map((ex, i) => (
          <div key={i} style={{ background:C.cell, border:`1px solid ${C.lineBright}`, padding:"10px 12px", marginBottom:8 }}>
            <input style={{ ...inp, marginBottom:6 }} value={ex.name} onChange={e => setExercise(i,"name",e.target.value)} />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:6 }}>
              <div><span style={{ ...lbl, marginTop:0 }}>Sets</span><input style={numInp} type="number" inputMode="numeric" value={ex.sets} onChange={e => setExercise(i,"sets",e.target.value)} /></div>
              <div><span style={{ ...lbl, marginTop:0 }}>Reps</span><input style={numInp} type="number" inputMode="numeric" value={ex.reps} onChange={e => setExercise(i,"reps",e.target.value)} /></div>
              <div style={{ display:"flex", flexDirection:"column", justifyContent:"flex-end", gap:4 }}><button type="button" aria-label="Move exercise up" style={{ ...S.smallBtn, fontSize:11.5 }} onClick={() => moveExercise(i,-1)}>↑</button><button type="button" aria-label="Move exercise down" style={{ ...S.smallBtn, fontSize:11.5 }} onClick={() => moveExercise(i,1)}>↓</button></div>
              <div style={{ display:"flex", flexDirection:"column", justifyContent:"flex-end" }}><button type="button" aria-label="Remove exercise" style={{ ...S.smallBtn, color:C.red, borderColor:"#5a1a14", fontSize:11.5 }} onClick={() => removeExercise(i)}>✕</button></div>
            </div>
          </div>
        ))}
        {(active.lifting||[]).length===0 && <div style={{ fontSize:11, color:C.textDim }}>No lifting in this session.</div>}

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16, marginBottom:8 }}>
          <span style={{ ...S.blockTitle }}>{active.label} Cardio</span>
          <button type="button" style={S.smallBtn} onClick={toggleCardio}>{active.cardio ? "Remove Cardio" : "+ Add Cardio"}</button>
        </div>
        {active.cardio && <div style={{ background:C.cell, border:`1px solid ${C.lineBright}`, padding:"10px 12px" }}>
          <label style={{ ...lbl, marginTop:0 }}>Type</label><input style={inp} value={active.cardio.type||""} onChange={e => setCardio("type", e.target.value)} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div><label style={{ ...lbl, marginTop:4 }}>Target Miles</label><input style={numInp} type="number" inputMode="decimal" value={active.cardio.miles||""} onChange={e => setCardio("miles", e.target.value)} /></div>
            <div><label style={{ ...lbl, marginTop:4 }}>Effort</label><input style={inp} value={active.cardio.effort||""} onChange={e => setCardio("effort", e.target.value)} /></div>
          </div>
          <label style={lbl}>Notes</label><input style={inp} value={active.cardio.notes||""} onChange={e => setCardio("notes", e.target.value)} />
        </div>}
      </div>
      <div style={{ position:"fixed", bottom:64, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:"var(--ovt-content-width)", display:"flex", gap:8, padding:"10px 16px", background:C.panel, borderTop:`1px solid ${C.lineBright}`, zIndex:150 }}>
        <button style={{ ...S.foodBtn, marginTop:0, flex:1, color:C.textDim, borderColor:C.lineBright }} onClick={onCancel}>Cancel</button>
        <button style={{ ...S.foodBtn, marginTop:0, flex:2 }} onClick={onSave} disabled={busy}>{busy ? "Saving..." : "Save Program"}</button>
      </div>
    </div>
  );
}

// More Tab
// More: management hub
// Small consistent header for every More subview: a "← More" back-to-hub button
// plus a title. Replaces the old always-visible horizontal subnav — the hub
// cards are now the navigation, so each detail view just needs a way home.
// A single labelled navigation/action row inside a hub group. Left column is a
// label + optional sublabel; the whole row is the tap target. Keeps the ledger
// look (hairline border, mono) while giving each action a generous target.
// `variant` distinguishes primary action cards (Generate / Edit / Form
// Check) from utility rows (Settings, data). Primary gets a heavier top+left
// rule and darker ink; utility keeps the quiet hairline. Behaviour unchanged.
