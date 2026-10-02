// src/MoreTab.jsx
// V8 refactor · Extracted verbatim from App.jsx (no behavior change): the
// Profile hub (MoreTab) with ProgramTab, ProgramEditor, SocialTab,
// CirclesSection, PR boards, CoachPreferencesCard, and hub primitives.
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useTheme } from "./theme";
import { copyToClipboard } from "./clipboard";
// V12.1 · FormCheck was referenced below without ANY import — a latent
// ReferenceError on the legacy subView === "form" path, caught by ESLint's
// first run. Lazy so the 80 KB analyzer chunk stays out of this chunk too.
const FormCheck = lazy(() => import("./FormCheck").then(m => ({ default: m.FormCheck })));
import { DEFAULT_PROGRAM, DAYS, PROGRAM_PRESETS } from "./constants";
import { seedSupersetPrefsFromProgram } from "./liftLogPrefs";
import { buildSplitSessionsFromLegacy, getProgramSessions, usesProgramSessions } from "./programSessions";
import { loadLeaderboard, loadLiftingPRs, loadRunningPRs, loadSocialSummary, listMyCircles, createCircle, joinCircle, loadCircleSummary } from "./data";
import { summarizeProgramForHub } from "./moreHub";
import { countLoggedDays, buildBetaFeedbackText } from "./firstWeekJourney";
import { buildLeaderboardHero, getBoardAverages, buildHighlights, buildPRComparison, getGapToNext, normalizeSocialSummary, buildDeltaBadge } from "./socialSummary";
import { DEFAULT_COACH_PREFERENCES, normalizeCoachPreferences, mergeCoachPreferences, buildCoachMemoryExport, summarizeRecentTrend } from "./coachMemory";
import { ProgramBuilderPanel } from "./ProgramBuilderPanel";
import { NotificationsCard } from "./NotificationsCard";
import { useConfirm } from "./ui/ConfirmDialog";

function ProgramTab({  program, onSaveProgram, onApplyGeneratedProgram, settings, initialAction }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const { confirm, confirmDialog } = useConfirm();
  // initialAction (V2.4B) lets the More hub open this tab straight into a
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
    if (!(await confirm({ message: `Switch to "${preset.name}"? This will replace your current program.`, confirmLabel: "Switch program" }))) return;
    setBusy(true);
    const programToSave = (presetId === "hybrid" || !preset?.program) ? DEFAULT_PROGRAM : preset.program;
    const ok = await onSaveProgram(programToSave);
    setBusy(false);
    if (ok) {
      // V17.4 · Preset-declared supersets go live immediately (sticky prefs).
      seedSupersetPrefsFromProgram(programToSave);
      setShowPresets(false); setPreviewPreset(null);
    }
  };

  const prog = editMode ? draft : (program || DEFAULT_PROGRAM);

  // ── Program Builder V2 (V2.3) — generate a plan. Cancel leaves the current
  // program untouched; Apply is handled by onApplyGeneratedProgram. ──
  if (builderOpen) {
    return (
      <ProgramBuilderPanel
        settings={settings}
        currentProgram={program}
        initialGoal={settings?.programBuilder?.goal || undefined}
        onCancel={() => setBuilderOpen(false)}
        onApply={async (payload) => {
          const ok = await onApplyGeneratedProgram(payload);
          if (ok !== false) setBuilderOpen(false);
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
            {Object.values(PROGRAM_PRESETS).map(p => (
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
          const previewProg = (previewPreset === "hybrid" || !preview.program) ? DEFAULT_PROGRAM : preview.program;
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

  return (
    <div>
      <div style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Weekly Program</span>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
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

// ─── Program session display ──────────────────────────────────────────────────
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
          <span style={{ fontSize: compact ? 8 : 9, color:C.text, whiteSpace:"nowrap" }}>{ex.sets}×{ex.reps}</span>
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

// ─── Program Editor ───────────────────────────────────────────────────────────
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
    const cardio = { ...(p.cardio || { type:"", miles:0, effort:"", notes:"" }), [field]: field==="miles"?parseFloat(val)||0:val };
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

// ─── AM/PM Program Editor ─────────────────────────────────────────────────────
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
    const cardio = { ...(active.cardio || { type:"", miles:0, effort:"", notes:"" }), [field]: field==="miles" ? parseFloat(val)||0 : val };
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

// ─── Social Tab (Leaderboard + PR Board) ──────────────────────────────────────
const LEADERBOARD_CATEGORIES = [
  { key: "total_miles",   label: "Miles",    unit: "mi",  decimals: 1 },
  { key: "workouts_done", label: "Workouts", unit: "",    decimals: 0 },
  { key: "protein_days",  label: "Protein",  unit: "days", decimals: 0 },
  { key: "total_volume",  label: "Volume",   unit: "lbs", decimals: 0 },
  { key: "water_days",    label: "Water",    unit: "days", decimals: 0 },
];

const PERIODS = [
  { key: 7,  label: "This Week" },
  { key: 30, label: "This Month" },
  { key: 0,  label: "All Time" },
];

function socialFormat(value, cat) {
  const n = parseFloat(value) || 0;
  return cat?.decimals === 0 ? String(Math.round(n)) : n.toFixed(cat?.decimals ?? 1);
}

// ─── V4.5 · Private invite-only Circles ───────────────────────────────────────
// A small aggregate-only group surface. Circles are invite-code join, and expose
// ONLY derived member aggregates (usernames + counts/sums) computed server-side —
// never raw logs, biometrics, feeds, comments, or DMs. When the migration hasn't
// been applied the wrappers return { ok:false }, and we show a graceful notice
// rather than an error state.
const CIRCLE_ERRORS = {
  name_required: "Enter a circle name first.",
  code_required: "Enter an invite code first.",
  invalid_code: "That invite code didn't match any circle.",
  too_many_circles: "You've reached the circle limit.",
  not_authenticated: "Sign in to use circles.",
  not_a_member: "You're not a member of that circle.",
  code_generation_failed: "Couldn't generate a code — try again.",
};

function CirclesSection({ myUsername }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [circles, setCircles] = useState([]);
  const [available, setAvailable] = useState(true); // false → migration not applied
  const [loading, setLoading] = useState(true);
  const [nameInput, setNameInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const res = await listMyCircles();
    if (!res.ok) { setAvailable(false); setLoading(false); return; }
    setAvailable(true);
    const env = res.data;
    if (env && env.ok) {
      const list = Array.isArray(env.circles) ? env.circles : [];
      setCircles(list);
      setSelectedId((cur) => cur || (list[0]?.circle_id ?? null));
    } else {
      setCircles([]);
    }
    setLoading(false);
  };

  useEffect(() => { let c = false; (async () => { if (!c) await refresh(); })(); return () => { c = true; }; }, []);

  useEffect(() => {
    if (!selectedId) { setSummary(null); return; }
    let cancelled = false;
    setSummaryLoading(true);
    loadCircleSummary(selectedId, 7).then((res) => {
      if (cancelled) return;
      setSummary(res.ok && res.data && res.data.ok ? res.data : null);
      setSummaryLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  const onCreate = async () => {
    if (busy) return;
    setBusy(true); setNotice(null);
    const res = await createCircle(nameInput.trim());
    if (!res.ok) { setAvailable(false); setBusy(false); return; }
    const env = res.data;
    if (env && env.ok) { setNameInput(""); setSelectedId(env.circle_id); await refresh(); setNotice(`Circle created · invite code ${env.invite_code}`); }
    else setNotice(CIRCLE_ERRORS[env?.error] || "Couldn't create circle.");
    setBusy(false);
  };

  const onJoin = async () => {
    if (busy) return;
    setBusy(true); setNotice(null);
    const res = await joinCircle(codeInput.trim());
    if (!res.ok) { setAvailable(false); setBusy(false); return; }
    const env = res.data;
    if (env && env.ok) { setCodeInput(""); setSelectedId(env.circle_id); await refresh(); setNotice(`Joined ${env.name || "circle"}.`); }
    else setNotice(CIRCLE_ERRORS[env?.error] || "Couldn't join circle.");
    setBusy(false);
  };

  const caption = { fontSize: 10, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono };
  const small = { fontSize: 11, color: C.textDim, lineHeight: 1.55, letterSpacing: "0.03em" };
  const card = { ...S.block, background: C.bg };
  const input = { flex: 1, minWidth: 0, background: C.inputBg, border: `1px solid ${C.line}`, color: C.text, fontFamily: mono, fontSize: 11.5, padding: "8px 9px", letterSpacing: "0.04em" };
  const btn = { background: C.block, border: `1px solid ${C.textDim}`, color: C.text, fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 11px", cursor: busy ? "default" : "pointer", flexShrink: 0, opacity: busy ? 0.6 : 1 };
  const pill = (active) => ({ padding: "4px 10px", background: "none", border: `1px solid ${active ? C.text : C.lineBright}`, color: active ? C.text : C.textFaint, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 });

  const selected = circles.find((c) => c.circle_id === selectedId) || null;

  return (
    <section style={card}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Circles</span>
        <span style={S.blockStat}>invite-only</span>
      </div>
      <div style={{ ...small, marginBottom: 10 }}>
        Private, invite-only groups that share <strong>aggregate stats only</strong> — usernames, counts, and totals for members.
        No feeds, comments, or DMs, and never raw logs, biometrics, or Coach chat.
      </div>

      {!available ? (
        <div style={{ ...small, color: C.textFaint, border: `1px solid ${C.line}`, padding: "10px 11px" }}>
          Circles aren't available yet. Apply the <span style={{ color: C.text }}>V4.5 social circles</span> migration
          (supabase/migration_add_social_circles.sql) to enable invite-only group aggregates.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input style={input} value={nameInput} maxLength={40} placeholder="New circle name"
              onChange={(e) => setNameInput(e.target.value)} />
            <button type="button" style={btn} disabled={busy} onClick={onCreate}>Create</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input style={input} value={codeInput} maxLength={12} placeholder="Invite code"
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())} />
            <button type="button" style={btn} disabled={busy} onClick={onJoin}>Join</button>
          </div>

          {notice && <div style={{ ...small, color: C.text, marginBottom: 10 }}>{notice}</div>}

          {loading ? (
            <div style={{ ...small, color: C.textDim }}>Loading circles…</div>
          ) : circles.length === 0 ? (
            <div style={small}>No circles yet — create one and share its invite code, or join with a code from a friend.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10 }}>
                {circles.map((c) => (
                  <button type="button" key={c.circle_id} style={pill(c.circle_id === selectedId)} onClick={() => setSelectedId(c.circle_id)}>
                    {c.name}{c.member_count ? ` · ${c.member_count}` : ""}
                  </button>
                ))}
              </div>

              {selected && selected.is_owner && selected.invite_code && (
                <div style={{ ...small, marginBottom: 8 }}>
                  Invite code for <span style={{ color: C.text }}>{selected.name}</span>: <span style={{ color: C.text, letterSpacing: "0.14em" }}>{selected.invite_code}</span>
                </div>
              )}

              {summaryLoading ? (
                <div style={{ ...small, color: C.textDim }}>Loading circle aggregates…</div>
              ) : summary && Array.isArray(summary.members) && summary.members.length > 0 ? (
                <div>
                  <div style={{ ...caption, marginBottom: 6 }}>{summary.name} · last 7 days · aggregate only</div>
                  {summary.members.map((m) => {
                    const isMe = m.username === myUsername;
                    return (
                      <div key={m.username} style={{ padding: "9px 0", borderBottom: `1px solid ${C.line}`, borderLeft: isMe ? `2px solid ${C.text}` : "2px solid transparent", paddingLeft: isMe ? 8 : 0 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "baseline" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                            {m.username}{isMe && <span style={{ fontSize: 10, fontWeight: 400 }}> (you)</span>}
                          </div>
                          <div style={{ ...small, fontSize: 10 }}>
                            {Math.round(m.workouts_done || 0)} workouts · {Math.round(m.total_volume || 0)} vol · {(Number(m.total_miles) || 0).toFixed(1)} mi · {Math.round(m.protein_days || 0)} protein days
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : selected ? (
                <div style={small}>No shared aggregates yet — members appear here once they opt into Social Sharing and log training.</div>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}

function SocialTab({ myUsername, socialOptIn }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [view, setView]               = useState("leaderboard");
  const [period, setPeriod]           = useState(7);
  const [category, setCategory]       = useState("total_miles");
  const [board, setBoard]             = useState([]);
  const [liftPRs, setLiftPRs]         = useState([]);
  const [runPRs, setRunPRs]           = useState([]);
  const [prFilter, setPrFilter]       = useState("lifting");
  const [loading, setLoading]         = useState(true);
  const [serverSummary, setServerSummary] = useState(null);

  // Leaderboard cache: key = period_days, value = { rows, ts }
  // 5-minute TTL prevents refetch on every period toggle while keeping data fresh.
  const lbCache = useRef({});
  const CACHE_TTL = 5 * 60 * 1000;

  useEffect(() => {
    let cancelled = false;
    const cached = lbCache.current[period];
    const now = Date.now();
    if (cached && now - cached.ts < CACHE_TTL) {
      setBoard(cached.rows);
      setLoading(false);
    } else {
      setLoading(true);
      loadLeaderboard(period).then(rows => {
        if (!cancelled) {
          lbCache.current[period] = { rows, ts: Date.now() };
          setBoard(rows);
          setLoading(false);
        }
      });
    }
    // V4.4 server summary is fetched even when the older leaderboard cache hits;
    // otherwise rank deltas/highlights can lag behind the visible board.
    loadSocialSummary(period).then(result => {
      if (!cancelled && result.ok && result.data) {
        setServerSummary(normalizeSocialSummary(result.data));
      } else if (!cancelled) {
        setServerSummary(null);
      }
    });
    return () => { cancelled = true; };
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    loadLiftingPRs().then(rows => { if (!cancelled) setLiftPRs(rows); });
    loadRunningPRs().then(rows => { if (!cancelled) setRunPRs(rows); });
    return () => { cancelled = true; };
  }, []);

  const cat = LEADERBOARD_CATEGORIES.find(c => c.key === category) || LEADERBOARD_CATEGORIES[0];
  // Prefer server leaderboard rows when available (single RPC vs 3 separate calls)
  const activeBoard = (serverSummary?.leaderboard?.length) ? serverSummary.leaderboard : board;
  const ranked = [...activeBoard]
    .map(r => ({ ...r, value: parseFloat(r[category]) || 0 }))
    .sort((a, b) => b.value - a.value);
  const leaderVal = ranked.length ? ranked[0].value : 0;
  const hero = buildLeaderboardHero({ board: activeBoard, myUsername, category });
  const bestCategory = hero.bestCategory;
  const localAverages = getBoardAverages(activeBoard);
  const averages = serverSummary?.boardAverages && Object.keys(serverSummary.boardAverages).length
    ? { ...localAverages, ...serverSummary.boardAverages }
    : localAverages;
  const prCompare = buildPRComparison({ liftPRs, runPRs, myUsername });
  const periodLabel = PERIODS.find(p => p.key === period)?.label || "Board";
  const myRow = activeBoard.find(r => r.username === myUsername) || null;

  // V4.4: gap to the person one rank above (more motivational than leader gap)
  const gapToNext = getGapToNext(activeBoard, myUsername, category);
  // Build a gap label preferring next-rank gap over leader gap
  let gapToNextLabel = null;
  if (hero.hasData && gapToNext !== null) {
    const formatted = cat.decimals === 0 ? Math.round(gapToNext) : gapToNext.toFixed(cat.decimals);
    gapToNextLabel = `${formatted} ${cat.unit} to next rank`.trim();
  }

  // V4.4: period-over-period rank movement from server (workouts-based primary metric)
  const deltaBadge = buildDeltaBadge(serverSummary?.currentUser?.rankDelta ?? null);

  // V4.4: server highlights override V4.3 local highlights when available
  const serverHighlights = serverSummary?.highlights?.length
    ? serverSummary.highlights.map(h => {
        const catMeta = LEADERBOARD_CATEGORIES.find(c => c.key === h.category);
        return {
          id:    `server_${h.category}`,
          label: `${catMeta?.label ?? h.category} Leader`,
          value: catMeta?.decimals === 0 ? String(Math.round(h.value)) : h.value.toFixed(catMeta?.decimals ?? 1),
          unit:  catMeta?.unit ?? '',
          note:  h.username,
          tone:  h.username === myUsername ? 'good' : 'neutral',
        };
      })
    : null;
  const highlights = (serverHighlights || buildHighlights({ board: activeBoard, liftPRs, runPRs, myUsername })).slice(0, 6);

  const caption = { fontSize: 10, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono };
  const small = { fontSize: 11, color: C.textDim, lineHeight: 1.55, letterSpacing: "0.03em" };
  const card = { ...S.block, background: C.bg };
  const pill = (active) => ({ padding:"4px 10px", background:"none", border:`1px solid ${active ? C.text : C.lineBright}`, color: active ? C.text : C.textFaint, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:mono, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 });

  return (
    <div>
      <section style={{ ...card, paddingTop: 16 }}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Social Hub</span>
          <span style={S.blockStat}>{socialOptIn ? "visible" : "private"}</span>
        </div>
        <div style={{ fontFamily: S.fontSerif, fontSize: 24, lineHeight: 1.05, color: C.text, letterSpacing: "-0.03em" }}>
          {socialOptIn
            ? (hero.hasData ? `#${hero.rank} in ${cat.label}` : "Shared boards, not raw logs")
            : "Private mode is on"}
        </div>
        <div style={{ ...small, marginTop: 8 }}>
          {socialOptIn
            ? (hero.hasData
                ? `${periodLabel}: ${gapToNextLabel || hero.gapLabel}${bestCategory ? ` · strongest board: ${bestCategory.label} (#${bestCategory.rank})` : ""}${deltaBadge ? ` · ${deltaBadge}` : ""}.`
                : "You are opted in, but this board needs logged data before your rank appears.")
            : "You can view boards, but your stats stay hidden until Settings → Social Sharing is enabled."}
        </div>
      </section>

      <section style={card}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Privacy boundary</span>
          <span style={S.blockStat}>opt-in only</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div>
            <div style={caption}>Shared if enabled</div>
            <div style={{ ...small, marginTop: 5 }}>Username, leaderboard aggregates, PR numbers.</div>
          </div>
          <div>
            <div style={caption}>Never shared</div>
            <div style={{ ...small, marginTop: 5 }}>Raw logs, biometrics, Oura/Whoop payloads, Coach chat, notes.</div>
          </div>
        </div>
      </section>

      <CirclesSection myUsername={myUsername} />

      <div style={{ display:"flex", borderBottom:`1px solid ${C.line}`, background:C.panel }}>
        <button type="button" onClick={() => setView("leaderboard")} style={{ flex:1, padding:"10px 8px", background:"none", border:"none", borderBottom: view==="leaderboard" ? `1px solid ${C.text}` : "1px solid transparent", marginBottom:-1, color: view==="leaderboard" ? C.text : C.textFaint, fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:mono, cursor:"pointer" }}>Leaderboard</button>
        <button type="button" onClick={() => setView("prs")} style={{ flex:1, padding:"10px 8px", background:"none", border:"none", borderBottom: view==="prs" ? `1px solid ${C.text}` : "1px solid transparent", marginBottom:-1, color: view==="prs" ? C.text : C.textFaint, fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:mono, cursor:"pointer" }}>PR Board</button>
      </div>

      {view === "leaderboard" && (
        <>
          <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.line}`, display:"flex", gap:6, overflowX:"auto" }}>
            {PERIODS.map(p => <button type="button" key={p.key} onClick={() => setPeriod(p.key)} style={pill(period===p.key)}>{p.label}</button>)}
          </div>
          <div style={{ padding:"8px 16px", borderBottom:`1px solid ${C.line}`, display:"flex", gap:4, overflowX:"auto" }}>
            {LEADERBOARD_CATEGORIES.map(c2 => <button type="button" key={c2.key} onClick={() => setCategory(c2.key)} style={pill(category===c2.key)}>{c2.label}</button>)}
          </div>

          <section style={card}>
            <div style={S.blockHead}>
              <span style={S.blockTitle}>{"> "}My week vs board</span>
              <span style={S.blockStat}>{periodLabel}</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:1, background:C.line, border:`1px solid ${C.line}` }}>
              {LEADERBOARD_CATEGORIES.slice(0, 4).map(c2 => {
                const mine = myRow ? parseFloat(myRow[c2.key]) || 0 : 0;
                const avg = averages[c2.key] || 0;
                const leader = ranked.length ? parseFloat(ranked[0][c2.key]) || 0 : 0;
                return (
                  <div key={c2.key} style={{ background:C.bg, padding:"10px 9px" }}>
                    <div style={caption}>{c2.label}</div>
                    <div style={{ fontFamily:S.fontSerif, fontSize:20, color:C.text, marginTop:4 }}>{socialFormat(mine, c2)}</div>
                    <div style={{ ...small, fontSize:10 }}>Avg {socialFormat(avg, c2)} · Lead {socialFormat(leader, c2)} {c2.unit}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section style={card}>
            <div style={S.blockHead}>
              <span style={S.blockTitle}>{"> "}Board highlights</span>
              <span style={S.blockStat}>derived only</span>
            </div>
            {highlights.length === 0 ? <div style={small}>No shared highlights yet — boards populate as opted-in athletes log training.</div> : (
              <div style={{ display:"grid", gap:7 }}>
                {highlights.map(h => (
                  <div key={h.id} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:12, alignItems:"baseline", padding:"8px 0", borderBottom:`1px solid ${C.line}` }}>
                    <div><div style={caption}>{h.label}</div><div style={{ ...small, marginTop:2 }}>{h.note}</div></div>
                    <div style={{ textAlign:"right" }}><span style={{ fontFamily:S.fontSerif, fontSize:20, color:h.tone === "good" ? C.green : C.text }}>{h.value}</span><span style={{ ...caption, marginLeft:4 }}>{h.unit}</span></div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {loading ? (
            <div style={{ padding:24, color:C.textDim, fontSize:11.5 }}>Loading leaderboard…</div>
          ) : ranked.length === 0 ? (
            <div style={{ padding:24, color:C.textDim, fontSize:11.5 }}>No shared data yet — opt in and log workouts to populate.</div>
          ) : (
            <section style={{ ...card, paddingBottom: 8 }}>
              <div style={S.blockHead}>
                <span style={S.blockTitle}>{"> "}{cat.label} board</span>
                <span style={S.blockStat}>{periodLabel}</span>
              </div>
              {ranked.map((r, i) => {
                const isMe = r.username === myUsername;
                const widthPct = leaderVal > 0 ? Math.round((r.value / leaderVal) * 100) : 0;
                return (
                  <div key={r.username} style={{ padding:"10px 0", borderBottom:`1px solid ${C.line}`, borderLeft:isMe ? `2px solid ${C.text}` : "2px solid transparent", paddingLeft:isMe ? 8 : 0 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"28px 1fr auto", gap:8, alignItems:"baseline" }}>
                      <span style={{ fontSize:15, fontWeight:600, color:i===0 ? C.green : C.textDim, textAlign:"center" }}>{i+1}</span>
                      <div><div style={{ fontSize:13.5, fontWeight:600, color:C.text, letterSpacing:"0.04em", textTransform:"uppercase" }}>{r.username}{isMe && <span style={{ fontSize:10, color:C.text, fontWeight:400 }}> (you)</span>}</div><div style={{ ...small, fontSize:10 }}>{r.workouts_done} workouts</div></div>
                      <div style={{ textAlign:"right" }}><div style={{ fontSize:18, fontWeight:600, color:i===0 ? C.green : C.text }}>{socialFormat(r.value, cat)}</div><div style={caption}>{cat.unit}</div></div>
                    </div>
                    <div style={{ height:2, background:C.line, marginTop:8 }}><div style={{ height:"100%", width:`${widthPct}%`, background:isMe ? C.green : C.textFaint }} /></div>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {view === "prs" && (
        <>
          <div style={{ padding:"8px 16px", borderBottom:`1px solid ${C.line}`, display:"flex", gap:4 }}>
            <button type="button" onClick={() => setPrFilter("lifting")} style={pill(prFilter==="lifting")}>Lifting</button>
            <button type="button" onClick={() => setPrFilter("running")} style={pill(prFilter==="running")}>Running</button>
          </div>
          {prFilter === "lifting" && <LiftingPRBoard prs={liftPRs} myUsername={myUsername} comparisons={prCompare.lifting} />}
          {prFilter === "running" && <RunningPRBoard prs={runPRs} myUsername={myUsername} comparison={prCompare.running} />}
        </>
      )}
    </div>
  );
}

function LiftingPRBoard({ prs, myUsername, comparisons = [] }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const caption = { fontSize: 10, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono };
  const small = { fontSize: 11, color: C.textDim, lineHeight: 1.5 };
  if (!prs?.length) return <div style={{ padding:24, color:C.textDim, fontSize:11.5 }}>No lifting PRs yet — log some sets.</div>;
  return (
    <div>
      <section style={S.block}>
        <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Lifting records</span><span style={S.blockStat}>board vs you</span></div>
        {comparisons.map(c => {
          const youHold = c.boardHolder === myUsername;
          return (
            <div key={c.exercise} style={{ padding:"10px 0", borderBottom:`1px solid ${C.line}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"baseline" }}>
                <div><div style={{ fontSize:13, letterSpacing:"0.08em", textTransform:"uppercase", color:C.text }}>{c.exercise}</div><div style={small}>Board: {c.boardHolder || "—"} · {Math.round(c.boardBest)} lb</div></div>
                <div style={{ textAlign:"right" }}><div style={{ fontFamily:S.fontSerif, fontSize:20, color:youHold ? C.green : C.text }}>{c.myBest ? Math.round(c.myBest) : "—"}</div><div style={caption}>{youHold ? "you hold it" : c.myBest ? `${Math.round(c.gap)} lb gap` : "no PR yet"}</div></div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function RunningPRBoard({ prs, myUsername, comparison }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const caption = { fontSize: 10, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono };
  if (!prs?.length) return <div style={{ padding:24, color:C.textDim, fontSize:11.5 }}>No running PRs yet — log some runs.</div>;
  const dist = comparison?.distance;
  const pace = comparison?.pace;
  return (
    <div>
      <section style={S.block}>
        <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Running records</span><span style={S.blockStat}>distance + pace</span></div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:1, background:C.line, border:`1px solid ${C.line}` }}>
          <div style={{ background:C.bg, padding:"10px 9px" }}>
            <div style={caption}>Longest run</div>
            <div style={{ fontFamily:S.fontSerif, fontSize:24, color:dist?.boardHolder === myUsername ? C.green : C.text }}>{dist?.myBest ? dist.myBest.toFixed(1) : "—"}</div>
            <div style={{ fontSize:11, color:C.textDim, lineHeight:1.5 }}>Board: {dist?.boardHolder || "—"} · {(dist?.boardBest || 0).toFixed(1)} mi</div>
            <div style={caption}>{dist?.boardHolder === myUsername ? "you hold it" : dist?.myBest ? `${dist.gap.toFixed(1)} mi gap` : "no run PR yet"}</div>
          </div>
          <div style={{ background:C.bg, padding:"10px 9px" }}>
            <div style={caption}>Fastest pace</div>
            <div style={{ fontFamily:S.fontSerif, fontSize:24, color:pace?.boardHolder === myUsername ? C.green : C.text }}>{pace?.myBestStr || "—"}</div>
            <div style={{ fontSize:11, color:C.textDim, lineHeight:1.5 }}>Board: {pace?.boardHolder || "—"} · {pace?.boardBestStr || "—"}/mi</div>
            <div style={caption}>{pace?.boardHolder === myUsername ? "you hold it" : pace?.gapSec != null ? `${Math.round(pace.gapSec)} sec gap` : "no pace PR yet"}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── More Tab ─────────────────────────────────────────────────────────────────
// ─── More: management hub (V2.4B) ─────────────────────────────────────────────
// Small consistent header for every More subview: a "← More" back-to-hub button
// plus a title. Replaces the old always-visible horizontal subnav — the hub
// cards are now the navigation, so each detail view just needs a way home.
function MoreSubHeader({ title, onBack }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 16px", borderBottom:`1px solid ${C.line}`, background:C.panel }}>
      <button onClick={onBack}
        style={{ background:"none", border:`1px solid ${C.lineBright}`, color:C.textDim, fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", fontFamily:mono, padding:"5px 11px" }}>
        ← More
      </button>
      <span style={{ fontSize:13, letterSpacing:"0.14em", textTransform:"uppercase", color:C.text, fontFamily:mono }}>{title}</span>
    </div>
  );
}

// A single labelled navigation/action row inside a hub group. Left column is a
// label + optional sublabel; the whole row is the tap target. Keeps the ledger
// look (hairline border, mono) while giving each action a generous target.
// V2.6: `variant` distinguishes primary action cards (Generate / Edit / Form
// Check) from utility rows (Settings, data). Primary gets a heavier top+left
// rule and darker ink; utility keeps the quiet hairline. Behaviour unchanged.
function HubAction({ label, sublabel, cta = "→", onClick, variant = "utility" }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const primary = variant === "primary";
  return (
    <button onClick={onClick}
      style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, background: primary ? C.block : C.inputBg, border:`1px solid ${primary ? C.textDim : C.line}`, borderLeft:`${primary ? 3 : 1}px solid ${primary ? C.text : C.line}`, padding: primary ? "14px 13px" : "12px 13px", cursor:"pointer", fontFamily:mono, textAlign:"left", marginTop:8 }}>
      <span style={{ minWidth:0 }}>
        <span style={{ display:"block", fontSize: primary ? 12 : 11, fontWeight: primary ? 600 : 400, letterSpacing:"0.06em", color:C.text, textTransform:"uppercase" }}>{label}</span>
        {sublabel && <span style={{ display:"block", fontSize:11, color:C.textDim, marginTop:3, letterSpacing:"0.03em", lineHeight:1.5 }}>{sublabel}</span>}
      </span>
      <span style={{ fontSize: primary ? 15 : 13, color:C.text, flexShrink:0 }}>{cta}</span>
    </button>
  );
}

function CoachPreferencesCard({ settings, allData, onSave, showToast }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const prefs = normalizeCoachPreferences(settings?.coachPreferences || DEFAULT_COACH_PREFERENCES);
  const [draft, setDraft] = useState(prefs);
  const [fallbackText, setFallbackText] = useState(null);

  useEffect(() => {
    setDraft(normalizeCoachPreferences(settings?.coachPreferences || DEFAULT_COACH_PREFERENCES));
  }, [settings?.coachPreferences]);

  const update = (key, value) => setDraft((d) => mergeCoachPreferences(d, { [key]: value }));
  const save = () => onSave?.(normalizeCoachPreferences(draft));
  const reset = () => {
    const next = { ...DEFAULT_COACH_PREFERENCES };
    setDraft(next);
    onSave?.(next);
  };
  const copyExport = async () => {
    const trend = summarizeRecentTrend(allData, Date.now());
    const text = buildCoachMemoryExport({ preferences: draft, trend });
    const ok = await copyToClipboard(text);
    if (ok) { setFallbackText(null); showToast?.("Coach memory copied"); }
    else { setFallbackText(text); showToast?.("Select all + copy"); }
  };

  const selectStyle = { background:C.inputBg, border:`1px solid ${C.line}`, color:C.text, fontFamily:mono, fontSize:11.5, padding:"7px 8px", width:"100%" };
  const labelStyle = { fontSize:10, color:C.textFaint, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 };
  const field = (label, node) => <div><div style={labelStyle}>{label}</div>{node}</div>;
  const optionList = (vals) => vals.map(v => <option key={v} value={v}>{v}</option>);

  return (
    <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${C.line}` }}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Coach Memory</span>
        <span style={S.blockStat}>{draft.enabled ? "enabled" : "off"}</span>
      </div>
      <div style={{ fontSize:11, color:C.textDim, lineHeight:1.6, marginBottom:10 }}>
        Optional, local coaching preferences only. Suggest-only: it changes tone/context, not your program, scores, or privacy boundaries.
      </div>
      <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, fontSize:11.5, color:C.text }}>
        <input type="checkbox" checked={draft.enabled} onChange={(e) => update("enabled", e.target.checked)} />
        Use my coach preferences
      </label>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        {field("Tone", <select value={draft.tone} onChange={(e)=>update("tone", e.target.value)} style={selectStyle}>{optionList(["balanced","direct","encouraging"])}</select>)}
        {field("Focus", <select value={draft.focus} onChange={(e)=>update("focus", e.target.value)} style={selectStyle}>{optionList(["hybrid","strength","endurance","physique"])}</select>)}
        {field("Intensity", <select value={draft.intensity} onChange={(e)=>update("intensity", e.target.value)} style={selectStyle}>{optionList(["conservative","moderate","aggressive"])}</select>)}
        {field("Rest bias", <select value={draft.restBias} onChange={(e)=>update("restBias", e.target.value)} style={selectStyle}>{optionList(["balanced","more-rest","more-volume"])}</select>)}
      </div>
      <textarea
        value={draft.note}
        onChange={(e) => update("note", e.target.value)}
        maxLength={240}
        rows={2}
        placeholder="Optional preference note, e.g. knee rehab; keep deloads conservative."
        style={{ ...S.notesInput, marginTop:8, fontSize:13 }}
      />
      <div style={{ display:"flex", gap:8, marginTop:8 }}>
        <button type="button" onClick={save} style={{ ...S.foodBtn, marginTop:0, flex:1 }}>Save Coach Prefs</button>
        <button type="button" onClick={copyExport} style={S.smallBtn}>Copy</button>
        <button type="button" onClick={reset} style={S.smallBtn}>Reset</button>
      </div>
      {fallbackText && (
        <textarea readOnly value={fallbackText} onFocus={(e)=>e.target.select()} rows={7} style={{ ...S.notesInput, marginTop:8, fontSize:11.5, fontFamily:mono }} />
      )}
    </div>
  );
}

export function MoreTab({ program, onSaveProgram, onApplyGeneratedProgram, exportJSON, exportCSV, fileRef, onPasteImport, onSettings, onLogout, myUsername, settings, allData, showToast, onSaveCoachPreferences }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [subView, setSubView] = useState("hub"); // "hub" | "program" | "form" | "social"
  const [programAction, setProgramAction] = useState(null); // "generate" | "switch" | "edit" | null
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackFallback, setFeedbackFallback] = useState(null);

  const copyBetaFeedback = async () => {
    const text = buildBetaFeedbackText({
      tab: "Profile",
      settings,
      loggedDays: countLoggedDays(allData),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      note: feedbackNote,
    });
    const ok = await copyToClipboard(text);
    if (ok) { setFeedbackFallback(null); showToast?.("Beta note copied"); }
    else { setFeedbackFallback(text); showToast?.("Select all + copy"); }
  };

  const backToHub = () => { setSubView("hub"); setProgramAction(null); };
  const openProgram = (action) => { setProgramAction(action); setSubView("program"); };

  const planSummary = summarizeProgramForHub(program);

  // Group note — quiet caption used for privacy / deferred / routing copy.
  const note = { fontSize:11, color:C.textDim, lineHeight:1.6, marginTop:10, letterSpacing:"0.03em" };
  const groupDesc = { fontSize:11, color:C.textDim, lineHeight:1.6, marginBottom:2, letterSpacing:"0.03em" };

  if (subView === "program") {
    return (
      <div>
        <MoreSubHeader title="Training Plan" onBack={backToHub} />
        <ProgramTab program={program} onSaveProgram={onSaveProgram} onApplyGeneratedProgram={onApplyGeneratedProgram} settings={settings} initialAction={programAction} />
      </div>
    );
  }
  if (subView === "form") {
    return (
      <div>
        <MoreSubHeader title="Form Check" onBack={backToHub} />
        <Suspense fallback={null}><FormCheck /></Suspense>
      </div>
    );
  }
  if (subView === "social") {
    return (
      <div>
        <MoreSubHeader title="Social" onBack={backToHub} />
        <SocialTab myUsername={myUsername} socialOptIn={settings?.socialOptIn === true} />
      </div>
    );
  }

  // ── Hub landing: grouped management cards ──
  return (
    <div>
      <div style={{ padding:"14px 16px 4px", background:C.bg }}>
        <div style={{ fontSize:13.5, letterSpacing:"0.16em", textTransform:"uppercase", color:C.text, fontFamily:mono }}>Manage</div>
        <div style={{ fontSize:11, color:C.textDim, marginTop:3, letterSpacing:"0.04em" }}>Plan, form check, data, and app settings.</div>
      </div>

      {/* 1 — Training Plan (first: never bury the builder) */}
      <div style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}Training Plan</span>
          <span style={S.blockStat}>{planSummary.hasProgram ? planSummary.line : "no plan"}</span>
        </div>
        <div style={groupDesc}>{planSummary.hasProgram ? `Your current week: ${planSummary.line}.` : "No plan yet — generate one to get started."}</div>
        <HubAction label="Generate plan" sublabel="Build a fresh weekly program" onClick={() => openProgram("generate")} variant="primary" />
        <HubAction label="Edit weekly program" sublabel="Adjust days, exercises, and cardio" onClick={() => openProgram("edit")} variant="primary" />
        <HubAction label="Switch preset" sublabel="Preview and load a ready-made split" onClick={() => openProgram("switch")} />
        <div style={note}>Block and periodization guidance lives in Progress → Block.</div>
      </div>

      {/* 2 — Form Check */}
      <div style={S.block}>
        <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Form Check</span></div>
        <div style={groupDesc}>Capture or upload a lift and save derived form summaries.</div>
        <HubAction label="Analyze movement" sublabel="Squat · bench · deadlift and more" onClick={() => setSubView("form")} variant="primary" />
        <div style={note}>Raw videos are not stored; derived summaries only.<br />Movement-quality trends live in Progress → Form.</div>
      </div>

      {/* 3 — Account + Data */}
      <div style={S.block}>
        <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Account + Data</span></div>
        <div style={groupDesc}>Settings, integrations, and local backups.</div>
        <HubAction label="Settings" sublabel="Macro targets · supplements · theme" onClick={onSettings} />
        <div style={note}>Oura and social sharing are managed in Settings.</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:12 }}>
          <div style={{ fontSize:10.5, color:C.textFaint, letterSpacing:"0.12em", textTransform:"uppercase" }}>Data · synced live, export for a local backup</div>
          <button style={{ ...S.foodBtn, marginTop:0 }} onClick={exportJSON}>Export Full Backup [JSON]</button>
          <button style={{ ...S.foodBtn, marginTop:0 }} onClick={exportCSV}>Export Stats [CSV]</button>
          <button style={{ ...S.foodBtn, marginTop:0 }} onClick={() => fileRef.current?.click()}>Import From File [JSON]</button>
          <button style={{ ...S.foodBtn, marginTop:0 }} onClick={onPasteImport}>Import From Pasted Text</button>
        </div>
        <div style={note}>Erase-my-data controls are not included in this beta. Export a local backup before deleting app data.</div>

        {/* V13 · Logout lives here now — a once-a-quarter action belongs in
            Account + Data, not in the always-visible masthead. */}
        {typeof onLogout === "function" && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
            <HubAction label="Log out" sublabel="End this session on this device — your data stays synced" onClick={onLogout} />
          </div>
        )}

        {/* Beta feedback — privacy-safe plain-text note (no logs, no identifiers). */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
          {!feedbackOpen ? (
            <HubAction label="Copy beta feedback note" sublabel="Version, tab, and setup mode only — no personal data" onClick={() => setFeedbackOpen(true)} />
          ) : (
            <div>
              <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.6, marginBottom: 6 }}>
                Copies app version, current tab, logged-day count, setup goal/mode, and browser. No entries or account details are included.
              </div>
              <textarea value={feedbackNote} onChange={(e) => setFeedbackNote(e.target.value)} rows={2}
                placeholder="What worked, what was confusing, what you'd change…"
                style={{ ...S.notesInput, marginTop: 0, fontSize: 13.5 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button style={{ ...S.foodBtn, marginTop: 0, flex: 1 }} onClick={copyBetaFeedback}>Copy Beta Feedback Note</button>
                <button style={{ ...S.smallBtn }} onClick={() => { setFeedbackOpen(false); setFeedbackFallback(null); }}>Close</button>
              </div>
              {feedbackFallback && (
                <textarea readOnly value={feedbackFallback} onFocus={(e) => e.target.select()} rows={7}
                  style={{ ...S.notesInput, marginTop: 8, fontSize: 11.5, fontFamily: mono }} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* 4 — App */}
      <div style={S.block}>
        <div style={S.blockHead}>
          <span style={S.blockTitle}>{"> "}App</span>
          <span style={S.blockStat}>Beta build</span>
        </div>
        <div style={groupDesc}>Preferences, sharing, and this build.</div>
        <HubAction label="Theme & preferences" sublabel="Managed in Settings" onClick={onSettings} />
        <NotificationsCard showToast={showToast} />
        <CoachPreferencesCard settings={settings} allData={allData} onSave={onSaveCoachPreferences} showToast={showToast} />
        <HubAction label="Social sharing" sublabel="Leaderboard and PR board" onClick={() => setSubView("social")} />
        <div style={note}>Beta feedback is welcome — use the privacy-safe feedback note above when something feels confusing.</div>
      </div>

      <a href="#/demo" style={{ display: "block", textAlign: "center", padding: "12px 4px", borderTop: `1px solid ${C.line}`, background: C.bg, fontFamily: mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim, textDecoration: "none" }}>View / share demo page →</a>
    </div>
  );
}

