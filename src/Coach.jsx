import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { useTheme } from "./theme";
import { supabase } from "./supabaseClient";
import { calcWeeklyReview, calcRecoveryScore } from "./recovery";
import { loadOuraData, isOuraConnected } from "./oura";
import { isWhoopConnected, loadWhoopData } from "./whoop";
import { buildCoachContext } from "./coachContextBuilder";
import { buildDailyLoads, computeRollingLoads } from "./loadModel";
import { buildDecisionContext, getDailyRecommendation, summarizeRecommendationForCoach } from "./decisionEngine";
import { MarkdownMessage } from "./MarkdownMessage";
import { buildOutcomeLoop } from "./coachingOutcomeLoop";
import { buildCoachEvidencePacket } from "./coachEvidence";

//  Coach — embedded AI assistant (mobile-first floating button + slide-up sheet)
//
//  Visibility gate: only renders when the logged-in user's id matches
//  VITE_COACH_USER_ID. This is a CONVENIENCE/visibility flag only — the real
//  security gate is enforced server-side in netlify/functions/coach.js, which
//  re-verifies the Supabase JWT and the allowed user id. Never rely on this
//  client flag for security.

// Visibility gate now lives in coachEnabled.js so the app shell can check it
// without importing this (lazy-loaded) module. Re-exported here so existing
// importers keep working.
import { isCoachEnabled } from "./coachEnabled";
export { isCoachEnabled };

// Persisted conversation cap — keep the thread useful without unbounded growth.
const HISTORY_LIMIT = 40;
const historyKey = (userId) => (typeof userId === "string" && userId.trim()) ? `ovt_coach_history_${userId}` : null;

function loadHistory(userId) {
  try {
    const key = historyKey(userId);
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-HISTORY_LIMIT) : [];
  } catch { return []; }
}
function saveHistory(userId, msgs) {
  try {
    const key = historyKey(userId);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(msgs.slice(-HISTORY_LIMIT)));
  } catch {}
}

// Build the minimal data slice sent to the coach. Summarized numbers only —
// no raw nested payloads, no usernames, no other users' data.
export function buildSlice({ data, settings, program, todayKey, todayName }) {
  const daySummary = (dateKey, d) => {
    if (!d) return null;
    const n = (v) => (v === "" || v === undefined || v === null || isNaN(+v)) ? null : +v;
    return {
      date: dateKey,
      calories: n(d.nutrition?.calories),
      protein:  n(d.nutrition?.protein),
      carbs:    n(d.nutrition?.carbs),
      fats:     n(d.nutrition?.fats),
      water:    n(d.nutrition?.water),
      weight:   n(d.body?.weight),
      sleep:    n(d.body?.sleep),
      miles:    n(d.workout?.cardio?.miles),
      workoutDone: !!(d.workout?.completed) ||
        Object.keys(d.workout?.exercises || {}).length > 0 ||
        (+(d.workout?.cardio?.miles) > 0),
    };
  };

  // Last 14 calendar days
  const days = [];
  const today = new Date(todayKey + "T12:00:00");
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const s = daySummary(key, data[key]);
    if (s) days.push(s);
  }

  // Yesterday for recovery
  const y = new Date(today); y.setDate(today.getDate() - 1);
  const yKey = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,"0")}-${String(y.getDate()).padStart(2,"0")}`;
  let recovery = null;
  try {
    const rec = calcRecoveryScore(data[yKey], data, yKey);
    if (rec) recovery = { score: rec.score, read: rec.read };
  } catch {}

  // Weekly review
  let weekly = null;
  try {
    const wr = calcWeeklyReview(data, settings?.goals);
    if (wr) weekly = {
      weekScore: wr.weekScore, workoutsDone: wr.workoutsDone, totalMiles: wr.totalMiles,
      avgCalories: wr.avgCalories, avgProtein: wr.avgProtein, avgSleep: wr.avgSleep,
      avgWeight: wr.avgWeight, proteinDays: wr.proteinDays,
    };
  } catch {}

  const todayData = data[todayKey];
  const todaySlice = todayData ? {
    ...daySummary(todayKey, todayData),
    workoutType: program?.[todayName]?.type || null,
  } : { date: todayKey, workoutType: program?.[todayName]?.type || null };

  let intelligenceSummary = null;
  try {
    const dailyLoads = computeRollingLoads(buildDailyLoads(data, 28));
    const recommendation = getDailyRecommendation(buildDecisionContext({
      todayProgram: program?.[todayName] || null,
      entries: data,
      settings,
      trainingLoad: dailyLoads,
      todayKey,
      recovery,
    }));
    intelligenceSummary = summarizeRecommendationForCoach(recommendation);
  } catch {}

  let coachingSystem = null;
  try {
    const loop = buildOutcomeLoop({ data, settings, todayKey });
    const activePlan = settings?.coachingSystem?.activePlan || loop.activePlan;
    const latestOutcome = loop.evaluated?.[0] || null;
    const guardrails = settings?.coachingSystem?.clinicianGuardrails || null;
    coachingSystem = {
      phase: settings?.coachingPhase?.phase || settings?.coachingSystem?.phase || null,
      activePlan: activePlan ? {
        label: activePlan.label || null,
        effectiveDate: activePlan.effectiveDate || null,
        recommendationKind: activePlan.recommendationKind || null,
        goals: activePlan.snapshot?.goals || null,
        trainingModifiers: activePlan.snapshot?.trainingModifiers || null,
      } : null,
      latestOutcome: latestOutcome ? {
        recommendationKind: latestOutcome.kind,
        status: latestOutcome.outcome?.status,
        label: latestOutcome.outcome?.label,
      } : null,
      clinicianGuardrails: guardrails?.enabled === true ? {
        enabled: true,
        exerciseHeartRateGuidance: guardrails.exerciseHeartRateGuidance || null,
        stopRules: guardrails.stopRules || null,
        trainingRestrictions: guardrails.trainingRestrictions || null,
        emergencyInstructions: guardrails.emergencyInstructions || null,
      } : { enabled: false },
    };
  } catch {}

  return {
    goals: settings?.goals || null,
    days,
    today: todaySlice,
    recovery,
    weekly,
    wearableSummary: null, // populated asynchronously by Coach component
    intelligenceSummary,
    coachingSystem,
  };
}

// Suggested prompts grounded in today's actual state, so the empty thread shows
// the user what the coach is *for* and that it already knows their data.
function buildSuggestions({ data, settings, program, todayKey, todayName }) {
  const out = [];
  try {
    const y = new Date(todayKey + "T12:00:00"); y.setDate(y.getDate() - 1);
    const yKey = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,"0")}-${String(y.getDate()).padStart(2,"0")}`;
    let recovery = null;
    try { const r = calcRecoveryScore(data[yKey], data, yKey); if (r) recovery = { score: r.score, read: r.read }; } catch {}
    let readiness = null;
    try {
      const rec = getDailyRecommendation(buildDecisionContext({
        todayProgram: program?.[todayName] || null,
        entries: data, settings,
        trainingLoad: computeRollingLoads(buildDailyLoads(data, 28)),
        todayKey, recovery,
      }));
      readiness = rec?.readiness || null;
    } catch {}

    if (readiness === "pull_back" || readiness === "rest") {
      out.push("Why are you recommending I pull back today?");
    } else if (readiness === "push") {
      out.push("Recovery looks strong — where should I push today?");
    } else {
      out.push("How's my recovery — push or hold today?");
    }

    // Protein gap for today
    const t = data[todayKey]?.nutrition || {};
    const goalP = +(settings?.goals?.protein) || 0;
    const haveP = +(t.protein) || 0;
    const remP = Math.max(0, Math.round(goalP - haveP));
    if (goalP && remP >= 20) {
      out.push(`What should I eat to hit my last ${remP}g of protein?`);
    } else {
      out.push("What should I eat tonight to recover well?");
    }

    out.push("Am I on track for fat loss this week?");
    out.push("Analyze my weight trend.");
  } catch {
    return [
      "How's my recovery — push or rest today?",
      "What should I eat tonight to hit my protein?",
      "Am I on track for fat loss this week?",
      "Analyze my weight trend.",
    ];
  }
  return out.slice(0, 4);
}

export function Coach({ data, settings, program, todayKey, todayName, userId, open, onClose }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const [input, setInput]     = useState("");
  const [msgs, setMsgs]       = useState([]);   // { role:'user'|'coach'|'error', text }
  const [busy, setBusy]       = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY); // slide-over
  // Escape closes the slide-over at the tier — parity with the
  // palette's keyboard model.
  useEffect(() => {
    if (!open || !isBroadsheet) return;
    const h = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, isBroadsheet, onClose]);
  const scrollRef = useRef(null);

  // Visibility gate — render nothing unless this is the allowed coach user.
  const enabled = isCoachEnabled(userId);

  // Restore prior conversation once we know who the user is.
  useEffect(() => {
    if (!enabled) return;
    setMsgs(loadHistory(userId));
    setHydrated(true);
  }, [enabled, userId]);

  // Persist the conversation as it grows (after the initial restore).
  useEffect(() => {
    if (!enabled || !hydrated) return;
    saveHistory(userId, msgs);
  }, [enabled, hydrated, userId, msgs]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy, open]);

  const suggestions = useMemo(
    () => buildSuggestions({ data, settings, program, todayKey, todayName }),
    [data, settings, program, todayKey, todayName]
  );

  const clearThread = useCallback(() => {
    setMsgs([]);
    try { localStorage.removeItem(historyKey(userId)); } catch {}
  }, [userId]);

  const send = useCallback(async (text) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setMsgs(m => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      // Attach the Supabase access token so the function can verify identity.
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) {
        setMsgs(m => [...m, { role: "error", text: "Not logged in. Please sign in again." }]);
        setBusy(false);
        return;
      }
      const slice = buildSlice({ data, settings, program, todayKey, todayName });

      // Inject AI-eligible unified recovery context. When both Oura and Whoop are connected
      // the resolver layers Whoop strain/respiratory-rate + mixed-signal
      // flags on top of the canonical Oura summary; Oura-only gives the plain
      // Oura summary. Never averages sources, never re-scores recovery.
      try {
        const ouraConnected = await isOuraConnected();
        const whoopConnected = await isWhoopConnected().catch(() => false);
        if (ouraConnected || whoopConnected) {
          const ouraData = ouraConnected ? await loadOuraData(7) : null;
          const whoopData = whoopConnected ? await loadWhoopData(7) : null;
          const manualBody = data?.[todayKey]?.body || null;
          const summary = buildCoachContext({ ouraData, whoopData, manualData: manualBody, settings });
          if (summary) slice.wearableSummary = summary;
        }
      } catch {
        // Wearables unavailable — proceed without biometric context
      }

      const evidencePacket = buildCoachEvidencePacket({
        question,
        data,
        settings,
        program,
        todayKey,
        todayName,
        wearableSummary: slice.wearableSummary,
        intelligenceSummary: slice.intelligenceSummary,
      });
      const conversation = msgs
        .filter((message) => message?.role === "user" || message?.role === "coach")
        .slice(-8)
        .map((message) => ({ role: message.role, text: message.text }));

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
        body: JSON.stringify({ question, slice, evidencePacket, conversation }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgs(m => [...m, { role: "error", text: out?.error || `Coach error (${res.status}).` }]);
      } else {
        setMsgs(m => [...m, {
          role: "coach",
          text: out.reply || "(no response)",
          runId: out.runId || null,
          meta: out.meta || null,
          feedback: null,
        }]);
      }
    } catch (e) {
      setMsgs(m => [...m, { role: "error", text: "Network error reaching coach." }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, data, settings, program, todayKey, todayName, msgs]);

  const submitFeedback = useCallback(async (messageIndex, value) => {
    const message = msgs[messageIndex];
    if (!message?.runId || ![-1, 1].includes(value)) return;
    setMsgs((current) => current.map((item, index) => index === messageIndex ? { ...item, feedback: value } : item));
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) return;
      await fetch("/api/coach-feedback", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
        body: JSON.stringify({ runId: message.runId, rating: value }),
      });
    } catch { /* feedback is best-effort */ }
  }, [msgs]);

  if (!enabled) return null;

  return (
    <>
      {/* Slide-up sheet */}
      {open && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 400,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "flex-end",
          background: "rgba(0,0,0,0.5)",
        }} onClick={() => onClose?.()}>
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Coach"
            style={{
              // At the tier the sheet becomes a right slide-over so
              // Today stays legible behind the scrim.
              ...(isBroadsheet
                ? { width: 480, maxWidth: "40vw", height: "100dvh", alignSelf: "flex-end", marginLeft: "auto" }
                : { width: "100%", maxWidth: "var(--ovt-content-width)", height: "85dvh" }),
              background: C.panel, borderTop: `1px solid ${C.line}`,
              borderTopLeftRadius: C.cardRadius ? 16 : 0, borderTopRightRadius: C.cardRadius ? 16 : 0,
              display: "flex", flexDirection: "column",
              animation: "coachUp 0.25s ease",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "14px 16px", borderBottom: `1px solid ${C.line}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: C.serifFamily || mono, fontStyle: "italic", color: C.text, fontSize: 18 }} aria-hidden="true">&theta;</span>
                <span style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: C.text, fontFamily: mono, fontWeight: 600 }}>Coach</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {msgs.length > 0 && (
                  <button type="button" onClick={clearThread} aria-label="Clear conversation" style={{
                    background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim,
                    fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
                    fontFamily: mono, padding: "4px 9px",
                  }}>Clear</button>
                )}
                <button type="button" onClick={() => onClose?.()} aria-label="Close Coach" style={{
                  background: "none", border: "none", color: C.textDim, fontSize: 18, cursor: "pointer", fontFamily: mono,
                }}><span aria-hidden="true">&times;</span></button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} role="log" aria-live="polite" aria-label="Conversation" style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
              {msgs.length === 0 && (
                <div style={{ color: C.textFaint, fontSize: 13, lineHeight: 1.7, fontFamily: mono }}>
                  <div style={{ color: C.textDim, marginBottom: 10, letterSpacing: "0.05em" }}>Ask about today, your training, nutrition, recovery, or longer-term progress.</div>
                  {suggestions.map((ex) => (
                    <button
                      type="button"
                      key={ex}
                      onClick={() => send(ex)}
                      style={{
                        display: "block", textAlign: "left", width: "100%",
                        padding: "8px 11px", marginBottom: 6, border: `1px solid ${C.lineBright}`,
                        borderRadius: 0, color: C.textDim, cursor: "pointer", background: C.bg,
                        fontFamily: mono, fontSize: 13, lineHeight: 1.5,
                      }}
                    >{ex}</button>
                  ))}
                  {/* Honest data-boundary note */}
                  <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.line}`, fontSize: 11, lineHeight: 1.6, color: C.textFaint, letterSpacing: "0.02em" }}>
                    Privacy: the coach receives a question-specific evidence packet plus a bounded recent conversation — no account credentials, no other users' data, and no raw wearable payloads. The API key stays server-side.
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} style={{ marginBottom: 12, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "85%", padding: "9px 12px", borderRadius: 0,
                    fontSize: 14, lineHeight: 1.55, fontFamily: mono,
                    whiteSpace: m.role === "coach" ? "normal" : "pre-wrap",
                    background: m.role === "user" ? C.bg : (m.role === "error" ? (C.mono ? "#1f0d0d" : "#fef2f2") : C.cell),
                    border: `1px solid ${m.role === "user" ? C.text : (m.role === "error" ? C.red : C.lineBright)}`,
                    color: m.role === "user" ? C.text : (m.role === "error" ? C.red : C.text),
                  }}>
                    {m.role === "coach" ? <>
                      <MarkdownMessage text={m.text} />
                      {Array.isArray(m.meta?.evidenceUsed) && m.meta.evidenceUsed.length > 0 && (
                        <details style={{ marginTop: 9, paddingTop: 7, borderTop: `1px solid ${C.line}`, color: C.textDim }}>
                          <summary style={{ cursor: "pointer", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                            Evidence · {m.meta.evidenceUsed.length}
                          </summary>
                          <div style={{ display: "grid", gap: 5, marginTop: 7 }}>
                            {m.meta.evidenceUsed.map((item) => (
                              <div key={item.id} style={{ fontSize: 10.5, lineHeight: 1.45, color: C.textFaint }}>
                                <span style={{ color: C.textDim }}>{item.id}</span> · {item.label}{item.dateRange ? ` · ${item.dateRange}` : ""}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {m.runId && (
                        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                          <span style={{ color: C.textFaint, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>Useful?</span>
                          <button type="button" onClick={() => submitFeedback(i, 1)} aria-label="Mark coach response helpful" style={{ border: `1px solid ${m.feedback === 1 ? C.text : C.line}`, background: "none", color: m.feedback === 1 ? C.text : C.textFaint, fontFamily: mono, fontSize: 9.5, padding: "3px 7px", cursor: "pointer" }}>Yes</button>
                          <button type="button" onClick={() => submitFeedback(i, -1)} aria-label="Mark coach response unhelpful" style={{ border: `1px solid ${m.feedback === -1 ? C.red : C.line}`, background: "none", color: m.feedback === -1 ? C.red : C.textFaint, fontFamily: mono, fontSize: 9.5, padding: "3px 7px", cursor: "pointer" }}>No</button>
                          {m.meta?.fallbackUsed && <span style={{ color: C.textFaint, fontSize: 9.5 }}>fallback used</span>}
                        </div>
                      )}
                    </> : m.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div style={{ color: C.textFaint, fontSize: 13, fontFamily: mono, letterSpacing: "0.1em" }} aria-live="polite">coach is thinking&hellip;</div>
              )}
            </div>

            {/* Input */}
            <div style={{ padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${C.line}`, display: "flex", gap: 8 }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                placeholder="Ask your coach&hellip;"
                aria-label="Ask your coach a question"
                style={{
                  flex: 1, background: C.inputBg, border: `1px solid ${C.lineBright}`,
                  borderRadius: 0, padding: "11px 12px", fontSize: 16,
                  color: C.text, fontFamily: mono, outline: "none",
                }}
              />
              <button type="button" onClick={() => send()} disabled={busy || !input.trim()} aria-label="Send message" style={{
                background: C.bg, border: `1px solid ${C.line}`, borderRadius: 0,
                padding: "0 16px", color: C.text, fontSize: 11.5, letterSpacing: "0.12em",
                textTransform: "uppercase", fontFamily: mono, cursor: busy ? "default" : "pointer",
                opacity: (busy || !input.trim()) ? 0.5 : 1,
              }}>Send</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes coachUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </>
  );
}
