import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { supabase } from "./supabaseClient";
import { calcWeeklyReview, calcRecoveryScore } from "./recovery";
import { loadOuraData, isOuraConnected } from "./oura";
import { isWhoopConnected, loadWhoopData } from "./whoop";
import { buildCoachContext } from "./coachContextBuilder";
import { buildDailyLoads, computeRollingLoads } from "./loadModel";
import { buildDecisionContext, getDailyRecommendation, summarizeRecommendationForCoach } from "./decisionEngine";
import { MarkdownMessage } from "./MarkdownMessage";
import { Icon } from "./ui/ledger";
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
    const guardrails = settings?.coachingSystem?.clinicianGuardrails || null;
    coachingSystem = {
      phase: settings?.coachingPhase?.phase || settings?.coachingSystem?.phase || null,
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
  const [input, setInput]     = useState("");
  const [msgs, setMsgs]       = useState([]);   // { role:'user'|'coach'|'error', text }
  const [busy, setBusy]       = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY); // slide-over
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // A dialog at every size: focus starts in the question field, Tab stays
  // inside, Escape closes, and focus goes back to what opened it.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (e) => {
      if (e.key === "Escape") { onCloseRef.current?.(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = panelRef.current.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), summary, [tabindex]:not([tabindex='-1'])");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => opener?.isConnected && opener.focus?.());
    };
  }, [open]);

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

  if (!enabled || !open) return null;
  // Phone: a sheet from the bottom. Wide screens: a panel down the right side.
  const panelStyle = {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    ...(isBroadsheet
      ? { width: 480, maxWidth: "40vw", top: 0, bottom: 0, left: "auto", right: 0, margin: 0, height: "100dvh", maxHeight: "none", borderRadius: 0, borderLeft: "1px solid var(--line)" }
      : { maxWidth: "var(--ovt-content-width)", height: "calc(100dvh - 48px)" }),
  };
  return (
    <>
      <div className="scrim mo-scrim" aria-hidden="true" onClick={() => onClose?.()} />
      <section ref={panelRef} className="sheet mo-rise" role="dialog" aria-modal="true" aria-labelledby="coach-title" data-screen="coach" style={panelStyle}>
        {!isBroadsheet && <span className="grab" aria-hidden="true" />}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 id="coach-title" className="t-h grow">Coach</h2>
          {msgs.length > 0 && <button type="button" className="btn btn-g btn-sm" onClick={clearThread}>Clear</button>}
          <button type="button" className="ibtn" aria-label="Close" onClick={() => onClose?.()}><Icon name="close" /></button>
        </div>

        <div ref={scrollRef} role="log" aria-label="Conversation" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, paddingBottom: 4 }}>
          {msgs.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p className="t-b c2">Ask about today, your training, food, recovery or longer-term progress.</p>
              <ul className="rows" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {suggestions.map((ex) => (
                  <li key={ex}>
                    <button type="button" className="row" onClick={() => send(ex)}>
                      <span className="t-b grow" style={{ textAlign: "left" }}>{ex}</span>
                      <Icon name="next" size="s" className="c2" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="t-s c2">For each question the coach gets the numbers that answer it and the last few messages. Never your password, anyone else's data or raw wearable data, and the AI key stays on the server.</p>
            </div>
          )}
          {msgs.map((m, i) => {
            if (m.role === "user") {
              return <p key={i} className="t-b" style={{ alignSelf: "flex-end", maxWidth: "85%", padding: "8px 12px", borderRadius: 12, background: "var(--sunk)", overflowWrap: "anywhere" }}><span className="sr">You: </span>{m.text}</p>;
            }
            if (m.role === "error") {
              return <p key={i} className="err" role="alert"><Icon name="warn" size="s" /><span>{m.text}</span></p>;
            }
            const evidence = Array.isArray(m.meta?.evidenceUsed) ? m.meta.evidenceUsed : [];
            return (
              <article key={i} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <p className="t-c c2">Coach</p>
                <MarkdownMessage text={m.text} />
                {evidence.length > 0 && (
                  <details className="banner" style={{ flexDirection: "column", gap: 4 }}>
                    <summary className="t-ss" style={{ minHeight: 24, cursor: "pointer" }}>From your data, {evidence.length} {evidence.length === 1 ? "item" : "items"}</summary>
                    <ul className="lst" style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
                      {evidence.map((item) => (
                        <li key={item.id}><span className="n-s c2">{item.id}</span> {item.label}{item.dateRange ? `, ${item.dateRange}` : ""}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {m.runId && (
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <span className="t-s c2 grow">Was this useful?</span>
                    <button type="button" className="btn btn-s btn-sm" aria-pressed={m.feedback === 1} onClick={() => submitFeedback(i, 1)}>Helpful</button>
                    <button type="button" className="btn btn-s btn-sm" aria-pressed={m.feedback === -1} onClick={() => submitFeedback(i, -1)}>Not helpful</button>
                  </div>
                )}
                {m.meta?.fallbackUsed && <p className="t-s c2">Answered by the backup model.</p>}
              </article>
            );
          })}
          {busy && <p className="t-s c2" role="status">The coach is thinking…</p>}
        </div>

        <p className="t-s c2">The coach can't change your plan or targets.</p>
        <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <label className="field grow">
            <span className="lbl">Ask the coach</span>
            <input ref={inputRef} className="input" autoComplete="off" enterKeyHint="send" value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-p" aria-disabled={busy || !input.trim() || undefined}>Send</button>
        </form>
      </section>
    </>
  );
}
