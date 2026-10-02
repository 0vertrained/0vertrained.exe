import { useState, useEffect } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { THEMES, PRIMARY_THEMES } from "./theme";
import { useTheme } from "./theme";
import { DIETARY_TAGS } from "./mealPlan";
import { getOuraAuthUrl, disconnectOura, getOuraSyncEvents, getOuraTokenStatus, getOuraSyncCounts, syncOuraNow } from "./oura";
import { getWhoopAuthUrl, getWhoopTokenStatus, syncWhoopNow, disconnectWhoop, getWhoopSyncCounts, getWhoopSyncEvents } from "./whoop";
import { getGoogleHealthAuthUrl, getGoogleHealthTokenStatus, syncGoogleHealthNow, disconnectGoogleHealth, getGoogleHealthSyncCounts, getGoogleHealthSyncEvents } from "./googleHealth";
import { getStravaAuthUrl, getStravaTokenStatus, syncStravaNow, disconnectStrava, getStravaSyncCounts, getStravaSyncEvents } from "./strava";
import { buildSyncTimeline, buildSyncHealthBadge, formatSyncCounts } from "./recovery/wearableSyncEvents";
import { ONBOARDING_GOALS, ONBOARDING_DATA_MODES } from "./onboardingSetup";
import { friendlySyncError } from "./integrationErrors";
import { useConfirm } from "./ui/ConfirmDialog";
import { changeRecoveryPhrase } from "./auth";
import { suggestRecoveryPhrase } from "./recoveryPhraseSuggest";
import { readPerfRuns, clearPerfRuns } from "./perf";
import { APP_VERSION, SUPPORT_EMAIL, buildSupportMailto } from "./appMeta";

const GOAL_LABELS = Object.fromEntries(ONBOARDING_GOALS.map(g => [g.id, g.label]));
const DATA_MODE_LABELS = Object.fromEntries(ONBOARDING_DATA_MODES.map(m => [m.id, m.label]));

// Temporarily keep Google Health/Fitbit code in place, but keep the public UI disabled
// until Google data-access verification is complete.
const GOOGLE_HEALTH_INTEGRATION_ENABLED = false;

// Sync event debug timeline — metadata only, no raw payloads. Oura and Whoop
// rendered byte-identical timelines; this is that one grammar. `showCounts`
// appends the per-event record counts (Whoop only); `title` labels the block.
function SyncTimeline({ events, source, title, showCounts = false }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const timeline = buildSyncTimeline(events, { source, limit: 8 });
  const badge = buildSyncHealthBadge(events, source);
  const badgeColor = badge.tone === "warning" ? C.red : badge.tone === "caution" ? C.textDim : badge.tone === "good" ? C.green : C.textFaint;
  return (
    <div style={{ marginTop: 12, border: `1px solid ${C.line}`, padding: "10px 12px", fontFamily: mono }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim }}>{title}</span>
        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: badgeColor }}>{badge.label}</span>
      </div>
      {timeline.entries.map((e, i) => {
        const toneColor = e.tone === "warning" ? C.red : e.tone === "caution" ? C.textDim : e.tone === "good" ? C.green : C.textFaint;
        const countsStr = showCounts ? formatSyncCounts(e.counts) : "";
        return (
          <div key={e.id || i} style={{ padding: "5px 0", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 11, color: C.text, letterSpacing: "0.04em", textTransform: "uppercase" }}>{e.eventLabel}</span>
              <span style={{ fontSize: 10, color: toneColor, letterSpacing: "0.06em", textTransform: "uppercase" }}>{e.status}</span>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.45, marginTop: 2 }}>
              {e.message}
              {countsStr && <span style={{ color: C.textFaint }}> · {countsStr}</span>}
            </div>
            <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>{e.timeAgo || "—"}</div>
          </div>
        );
      })}
      <div style={{ marginTop: 8, fontSize: 9.5, color: C.textFaint, lineHeight: 1.5 }}>
        Metadata only — no raw biometric payloads or tokens are stored.
      </div>
    </div>
  );
}

export function SettingsScreen({ settings, onSave, onClose, busy, onThemeChange, currentTheme }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const { confirm, confirmDialog } = useConfirm();
  const [goals, setGoals]     = useState({ ...settings.goals });
  const [supps, setSupps]     = useState([...settings.supplements]);
  const [newSupp, setNewSupp] = useState("");
  const [dietary, setDietary] = useState([...(settings.dietaryRestrictions || [])]);
  const [socialOptIn, setSocialOptIn] = useState(settings.socialOptIn === true);
  const [trainingCues, setTrainingCues] = useState({ haptics: true, restAudio: false, ...(settings.trainingCues || {}) });
  const [section, setSection] = useState("goals");
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY); // V15.3 · two-pane (mockup 1m)

  // V13.6 · Change-recovery-phrase panel (Account section). Lets a signed-in
  // user rotate their phrase — closes the permanent-lockout gap where a phrase
  // set at signup could never be changed.
  const [recPhrase, setRecPhrase] = useState("");
  const [recConfirm, setRecConfirm] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [recMsg, setRecMsg] = useState("");
  const [recErr, setRecErr] = useState("");

  // V14.2 · Load-path diagnostics (About section). Read once per Settings
  // open; the Clear button empties both storage and the local list.
  const [perfRuns, setPerfRuns] = useState(() => readPerfRuns());

  // Oura — same user-facing sync controls as Whoop. Tokens stay server-side.
  const [ouraStatus, setOuraStatus] = useState(null);
  const [ouraBusy, setOuraBusy] = useState(false);
  const [ouraMsg, setOuraMsg] = useState("");
  const [ouraCounts, setOuraCounts] = useState(null);
  const [ouraEvents, setOuraEvents] = useState([]);

  // Whoop (V2.9 Foundation) — status is server-held; the browser never reads tokens.
  const [whoopStatus, setWhoopStatus] = useState(null);
  const [whoopBusy, setWhoopBusy] = useState(false);
  const [whoopMsg, setWhoopMsg] = useState("");
  // V2.9.2 — per-type completeness so the user can see exactly what landed.
  const [whoopCounts, setWhoopCounts] = useState(null);
  // V3.4 — sync event debug timeline.
  const [whoopEvents, setWhoopEvents] = useState([]);

  // Google Health / Fitbit — provider-standard OAuth and sync.
  const [_googleHealthStatus, setGoogleHealthStatus] = useState(null);
  const [_googleHealthBusy, setGoogleHealthBusy] = useState(false);
  const [googleHealthMsg, setGoogleHealthMsg] = useState("");
  const [_googleHealthCounts, setGoogleHealthCounts] = useState(null);
  const [_googleHealthEvents, setGoogleHealthEvents] = useState([]);

  // Strava — activity import only; excluded from AI Coach by policy.
  const [stravaStatus, setStravaStatus] = useState(null);
  const [stravaBusy, setStravaBusy] = useState(false);
  const [stravaMsg, setStravaMsg] = useState("");
  const [stravaCounts, setStravaCounts] = useState(null);
  const [stravaEvents, setStravaEvents] = useState([]);

  const refreshGoogleHealthStatus = async () => {
    const status = await getGoogleHealthTokenStatus();
    setGoogleHealthStatus(status);
    if (status?.connected) {
      const [counts, eventsRes] = await Promise.all([
        getGoogleHealthSyncCounts(),
        getGoogleHealthSyncEvents(20),
      ]);
      setGoogleHealthCounts(counts);
      setGoogleHealthEvents(eventsRes?.events || []);
    } else {
      setGoogleHealthCounts(null);
      setGoogleHealthEvents([]);
    }
    return status;
  };

  const refreshStravaStatus = async () => {
    const status = await getStravaTokenStatus();
    setStravaStatus(status);
    if (status?.connected) {
      const [counts, eventsRes] = await Promise.all([
        getStravaSyncCounts(),
        getStravaSyncEvents(20),
      ]);
      setStravaCounts(counts);
      setStravaEvents(eventsRes?.events || []);
    } else {
      setStravaCounts(null);
      setStravaEvents([]);
    }
    return status;
  };

  const refreshWhoopStatus = async () => {
    const status = await getWhoopTokenStatus();
    setWhoopStatus(status);
    if (status?.connected) {
      const [counts, eventsRes] = await Promise.all([
        getWhoopSyncCounts(),
        getWhoopSyncEvents(20),
      ]);
      setWhoopCounts(counts);
      setWhoopEvents(eventsRes?.events || []);
    } else {
      setWhoopCounts(null);
      setWhoopEvents([]);
    }
    return status;
  };

  useEffect(() => {
    if (section !== "integrations") return;
    let alive = true;
    (async () => {
      const [status, ouraStat, googleStat, stravaStat] = await Promise.all([
        getWhoopTokenStatus(),
        getOuraTokenStatus(),
        GOOGLE_HEALTH_INTEGRATION_ENABLED
          ? getGoogleHealthTokenStatus()
          : Promise.resolve({ connected: false, disabled: true }),
        getStravaTokenStatus(),
      ]);
      if (!alive) return;
      setWhoopStatus(status);
      setOuraStatus(ouraStat);
      setGoogleHealthStatus(googleStat);
      setStravaStatus(stravaStat);
      // Persist the durable flag only once the server confirms a live connection
      // (e.g. after returning from the OAuth redirect with ?whoop=connected).
      const connectionPatch = {};
      if (status?.connected && settings.whoopConnected !== true) connectionPatch.whoopConnected = true;
      if (ouraStat?.connected && settings.ouraConnected !== true) connectionPatch.ouraConnected = true;
      if (GOOGLE_HEALTH_INTEGRATION_ENABLED && googleStat?.connected && settings.googleHealthConnected !== true) connectionPatch.googleHealthConnected = true;
      if (stravaStat?.connected && settings.stravaConnected !== true) connectionPatch.stravaConnected = true;
      if (Object.keys(connectionPatch).length) {
        onSave({ ...settings, ...connectionPatch });
      }
      if (status?.connected) {
        const [counts, eventsRes] = await Promise.all([
          getWhoopSyncCounts(),
          getWhoopSyncEvents(20),
        ]);
        if (!alive) return;
        setWhoopCounts(counts);
        setWhoopEvents(eventsRes?.events || []);
      }
      // Fetch Oura counts + events too when Oura is connected so the card has
      // the same transparent "what landed" state as Whoop.
      if (ouraStat?.connected || settings?.ouraConnected) {
        const [ouraCountsRes, ouraEventsRes] = await Promise.all([
          getOuraSyncCounts(),
          getOuraSyncEvents(20),
        ]);
        if (!alive) return;
        setOuraCounts(ouraCountsRes);
        setOuraEvents(ouraEventsRes?.events || []);
      }
      if (GOOGLE_HEALTH_INTEGRATION_ENABLED && (googleStat?.connected || settings?.googleHealthConnected)) {
        const [googleCountsRes, googleEventsRes] = await Promise.all([
          getGoogleHealthSyncCounts(),
          getGoogleHealthSyncEvents(20),
        ]);
        if (!alive) return;
        setGoogleHealthCounts(googleCountsRes);
        setGoogleHealthEvents(googleEventsRes?.events || []);
      }
      if (stravaStat?.connected || settings?.stravaConnected) {
        const [stravaCountsRes, stravaEventsRes] = await Promise.all([
          getStravaSyncCounts(),
          getStravaSyncEvents(20),
        ]);
        if (!alive) return;
        setStravaCounts(stravaCountsRes);
        setStravaEvents(stravaEventsRes?.events || []);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const handleGoogleHealthConnect = async () => {
    setGoogleHealthMsg("");
    if (!GOOGLE_HEALTH_INTEGRATION_ENABLED) {
      setGoogleHealthMsg("Fitbit by Google is coming soon.");
      return;
    }
    const url = await getGoogleHealthAuthUrl();
    if (url) window.location.href = url;
    else setGoogleHealthMsg("Could not start Google Health/Fitbit connection.");
  };

  const _handleGoogleHealthSync = async (days = 30) => {
    if (!GOOGLE_HEALTH_INTEGRATION_ENABLED) {
      setGoogleHealthMsg("Fitbit by Google is coming soon.");
      return;
    }
    setGoogleHealthBusy(true);
    setGoogleHealthMsg(`Syncing last ${days} days…`);
    const res = await syncGoogleHealthNow(days);
    if (res?.error) {
      console.warn("Google Health sync failed:", res.error);
      setGoogleHealthMsg(friendlySyncError(res.error, "Google Health/Fitbit"));
    } else {
      setGoogleHealthMsg(`Synced ${res?.synced ?? 0} record(s) over ${res?.days ?? days} days.`);
    }
    await refreshGoogleHealthStatus();
    setGoogleHealthBusy(false);
  };

  const _handleGoogleHealthDisconnect = async () => {
    if (!GOOGLE_HEALTH_INTEGRATION_ENABLED) {
      setGoogleHealthMsg("Fitbit by Google is coming soon.");
      return;
    }
    if (!(await confirm({ message: "Disconnect Google Health/Fitbit? This removes imported Google Health data.", confirmLabel: "Disconnect", destructive: true }))) return;
    setGoogleHealthBusy(true);
    await disconnectGoogleHealth();
    await refreshGoogleHealthStatus();
    setGoogleHealthCounts(null);
    onSave({ ...settings, googleHealthConnected: false });
    setGoogleHealthMsg("Disconnected.");
    setGoogleHealthBusy(false);
  };

  const handleStravaConnect = async () => {
    setStravaMsg("");
    const url = await getStravaAuthUrl();
    if (url) window.location.href = url;
    else setStravaMsg("Could not start Strava connection.");
  };

  const handleStravaSync = async (days = 30) => {
    setStravaBusy(true);
    setStravaMsg(`Syncing last ${days} days…`);
    const res = await syncStravaNow(days);
    if (res?.error) {
      console.warn("Strava sync failed:", res.error);
      setStravaMsg(friendlySyncError(res.error, "Strava"));
    } else {
      setStravaMsg(`Synced ${res?.synced ?? 0} activity record(s) over ${res?.days ?? days} days.`);
    }
    await refreshStravaStatus();
    setStravaBusy(false);
  };

  const handleStravaDisconnect = async () => {
    if (!(await confirm({ message: "Disconnect Strava? This removes imported Strava activities.", confirmLabel: "Disconnect", destructive: true }))) return;
    setStravaBusy(true);
    await disconnectStrava();
    await refreshStravaStatus();
    setStravaCounts(null);
    onSave({ ...settings, stravaConnected: false });
    setStravaMsg("Disconnected.");
    setStravaBusy(false);
  };

  const handleWhoopConnect = async () => {
    setWhoopMsg("");
    const url = await getWhoopAuthUrl();
    if (url) window.location.href = url;
    else setWhoopMsg("Could not start Whoop connection.");
  };

  const handleWhoopSync = async (days = 14) => {
    setWhoopBusy(true);
    setWhoopMsg(`Syncing last ${days} days…`);
    const res = await syncWhoopNow(days);
    if (res?.error) {
      console.warn("Whoop sync failed:", res.error);
      setWhoopMsg(friendlySyncError(res.error, "Whoop"));
    } else {
      const c = res?.counts || {};
      const onlyCycle = (c.cycle || 0) > 0 && !(c.sleep || c.recovery || c.workout);
      setWhoopMsg(
        onlyCycle
          ? "Sync succeeded, but only cycle data was available."
          : `Synced ${res?.synced ?? 0} record(s) over ${res?.days ?? days} days.`
      );
    }
    await refreshWhoopStatus();
    setWhoopBusy(false);
  };

  const handleWhoopDisconnect = async () => {
    if (!(await confirm({ message: "Disconnect Whoop? This removes stored Whoop data.", confirmLabel: "Disconnect", destructive: true }))) return;
    setWhoopBusy(true);
    await disconnectWhoop();
    const status = await refreshWhoopStatus();
    setWhoopCounts(null);
    onSave({ ...settings, whoopConnected: false });
    setWhoopMsg("Disconnected.");
    setWhoopBusy(false);
    void status;
  };

  const refreshOuraStatus = async () => {
    const status = await getOuraTokenStatus();
    setOuraStatus(status);
    if (status?.connected) {
      const [counts, eventsRes] = await Promise.all([
        getOuraSyncCounts(),
        getOuraSyncEvents(20),
      ]);
      setOuraCounts(counts);
      setOuraEvents(eventsRes?.events || []);
    } else {
      setOuraCounts(null);
      setOuraEvents([]);
    }
    return status;
  };

  const handleOuraConnect = async () => {
    setOuraMsg("");
    const url = await getOuraAuthUrl();
    if (url) window.location.href = url;
    else setOuraMsg("Could not start Oura connection.");
  };

  const handleOuraSync = async (days = 14) => {
    setOuraBusy(true);
    setOuraMsg(`Syncing last ${days} days…`);
    const res = await syncOuraNow(days);
    if (res?.error) {
      console.warn("Oura sync failed:", res.error);
      setOuraMsg(friendlySyncError(res.error, "Oura"));
    } else {
      setOuraMsg(`Synced ${res?.synced ?? 0} record(s) over ${res?.days ?? days} days.`);
    }
    await refreshOuraStatus();
    setOuraBusy(false);
  };

  const handleOuraDisconnect = async () => {
    if (!(await confirm({ message: "Disconnect Oura? This removes stored Oura data.", confirmLabel: "Disconnect", destructive: true }))) return;
    setOuraBusy(true);
    await disconnectOura();
    const status = await refreshOuraStatus();
    setOuraCounts(null);
    onSave({ ...settings, ouraConnected: false });
    setOuraMsg("Disconnected.");
    setOuraBusy(false);
    void status;
  };

  const updateGoal = (key, val) => {
    const num = parseFloat(val);
    setGoals(g => ({ ...g, [key]: isNaN(num) ? 0 : num }));
  };

  const addSupp = () => {
    const s = newSupp.trim();
    if (!s || supps.includes(s)) return;
    setSupps(prev => [...prev, s]);
    setNewSupp("");
  };

  const removeSupp = (i) => setSupps(prev => prev.filter((_, idx) => idx !== i));

  const moveSupp = (i, dir) => {
    const arr = [...supps];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setSupps(arr);
  };

  const toggleDietary = (key) => setDietary(prev =>
    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
  );

  const handleSave = () => onSave({ goals, supplements: supps, dietaryRestrictions: dietary, socialOptIn, trainingCues });

  const submitRecoveryPhrase = async () => {
    setRecErr(""); setRecMsg("");
    const phrase = recPhrase.trim();
    if (phrase.length < 8) { setRecErr("Recovery phrase must be at least 8 characters."); return; }
    if (phrase !== recConfirm.trim()) { setRecErr("Recovery phrases do not match."); return; }
    setRecBusy(true);
    const res = await changeRecoveryPhrase({ newPhrase: phrase });
    setRecBusy(false);
    if (res.error) { setRecErr(res.error); return; }
    setRecPhrase(""); setRecConfirm("");
    setRecMsg("Recovery phrase updated. Store it somewhere safe.");
  };

  const fillSuggestedPhrase = () => {
    const suggestion = suggestRecoveryPhrase();
    setRecPhrase(suggestion);
    setRecConfirm(suggestion);
    setRecErr(""); setRecMsg("");
  };

  const inp = {
    ...S.cell,
    textAlign: "center",
    fontSize: 16,
    fontWeight: 600,
    padding: "10px 6px",
  };

  const lbl = {
    fontSize: 10,
    color: C.textDim,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    display: "block",
    marginBottom: 4,
    marginTop: 12,
  };

  // Shared integration-card styles. Oura and Whoop rendered these identically;
  // pulling them here keeps the two cards in lockstep and thins the inline noise.
  const statusBox = {
    padding: "10px", backgroundColor: C.bg, border: `1px solid ${C.line}`,
    borderRadius: 0, color: C.text, fontSize: 11, fontWeight: 600,
    marginBottom: 8, fontFamily: mono,
  };
  const countsBox = {
    padding: "10px", border: `1px solid ${C.line}`, borderRadius: 0,
    marginBottom: 8, fontFamily: mono, fontSize: 11, color: C.textDim,
  };
  const syncBtn = (busy) => ({
    ...S.cell, background: C.cell, color: C.text, border: `1px solid ${C.line}`,
    cursor: busy ? "default" : "pointer", fontSize: 11.5, fontWeight: 600,
  });
  const disconnectBtn = (busy) => ({
    ...S.cell, background: C.text, color: C.bg, border: "none", width: "100%",
    marginTop: 8, cursor: busy ? "default" : "pointer", fontSize: 11.5, fontWeight: 600,
  });
  const connectBtn = (busy) => ({
    ...S.cell, background: C.text, color: C.bg, border: "none", width: "100%",
    cursor: busy ? "default" : "pointer", fontSize: 13.5, fontWeight: 600,
  });
  // Ledger-style checkbox indicator shared by dietary / theme / social toggles.
  const checkDot = { width: 6, height: 6, borderRadius: 0, background: C.bg };
  const checkBox = (on, marginLeft) => ({
    width: 16, height: 16, borderRadius: 0,
    border: `1px solid ${on ? C.text : C.textFaint}`,
    background: on ? C.text : "transparent",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, ...(marginLeft ? { marginLeft } : {}),
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: C.bg, zIndex: 500,
      display: "flex", flexDirection: "column", maxWidth: "var(--ovt-content-width)", margin: "0 auto",
    }}>
      {confirmDialog}
      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.line}`, background: C.bg, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.25em", color: C.textFaint, textTransform: "uppercase" }}>§ Settings</div>
          <div style={{ fontSize: 28, fontWeight: 500, color: C.text, letterSpacing: "-0.03em", marginTop: 4, fontFamily: S.fontSerif }}>Targets & Sources</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: mono }}>✕ Close</button>
      </div>

      {/* V15.3 · Two-pane Settings (mockup 1m): persistent section nav left,
          content right; below the tier both wrappers are display:contents. */}
      <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" } : { display: "contents" }}>
      <aside data-section="settings-nav" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
      {/* Sub tabs */}
      <div style={{ display: "flex", flexDirection: isBroadsheet ? "column" : "row", position: isBroadsheet ? "sticky" : "static", top: isBroadsheet ? 12 : "auto", overflowX: "auto", scrollbarWidth: "none", borderBottom: isBroadsheet ? "none" : `1px solid ${C.line}`, borderRight: isBroadsheet ? `1px solid ${C.line}` : "none", background: C.bg }}>
        {[["goals","Macros"],["supps","Supplements"],["diet","Dietary"],["training","Training"],["theme","Theme"],["integrations","Integrations"],["account","Account"],["about","About"]].map(([key,label]) => (
          <button key={key} onClick={() => setSection(key)} style={{ flex: "0 0 auto", minWidth: 88, padding: "10px 10px", background: "none", border: "none", borderBottom: section === key ? `1px solid ${C.text}` : "1px solid transparent", marginBottom: -1, color: section === key ? C.text : C.textFaint, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>
      </aside>
      <section data-section="settings-pane" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>


      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>

        {section === "goals" && (
          <>
            {/* V2.2 setup summary — read-only glance at goal + data mode. */}
            {(settings.setup?.goal || settings.setup?.dataMode) && (
              <div style={{ border: `1px solid ${C.line}`, padding: "10px 12px", marginBottom: 16, display: "flex", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textFaint, marginBottom: 3 }}>Goal</div>
                  <div style={{ fontSize: 13, color: C.text, fontFamily: S.fontSerif }}>{GOAL_LABELS[settings.setup?.goal] || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textFaint, marginBottom: 3 }}>Recovery data</div>
                  <div style={{ fontSize: 13, color: C.text, fontFamily: S.fontSerif }}>{DATA_MODE_LABELS[settings.setup?.dataMode] || "Manual only"}</div>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
              Fig. 1 · Daily targets. Ruled values feed the Today ledger.
            </div>

            {/* Calorie target */}
            <div>
              <label style={lbl}>Daily Calories (kcal)</label>
              <input style={inp} type="number" inputMode="numeric" value={goals.calories} onChange={e => updateGoal("calories", e.target.value)} />
            </div>

            {/* Macro grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 4 }}>
              {[
                { key: "protein", label: "Protein (g)" },
                { key: "carbs",   label: "Carbs (g)" },
                { key: "fats",    label: "Fats (g)" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label style={lbl}>{label}</label>
                  <input style={inp} type="number" inputMode="numeric" value={goals[key]} onChange={e => updateGoal(key, e.target.value)} />
                </div>
              ))}
            </div>

            {/* Water */}
            <div>
              <label style={lbl}>Daily Water (oz)</label>
              <input style={inp} type="number" inputMode="numeric" value={goals.water} onChange={e => updateGoal("water", e.target.value)} />
            </div>

            {/* Macro preview */}
            <div style={{ marginTop: 20, background: C.bg, border: `1px solid ${C.lineBright}`, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: C.text, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>&gt; Daily Target Preview</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 1, background: C.lineBright, border: `1px solid ${C.lineBright}` }}>
                {[
                  { label: "Cal",  val: goals.calories },
                  { label: "Pro",  val: `${goals.protein}g` },
                  { label: "Carb", val: `${goals.carbs}g` },
                  { label: "Fat",  val: `${goals.fats}g` },
                  { label: "H₂O",  val: `${goals.water}oz` },
                ].map(({ label, val }) => (
                  <div key={label} style={{ background: C.cell, padding: "8px 4px", textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{val}</div>
                    <div style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {section === "supps" && (
          <>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
              Fig. 2 · Supplement stack. Ordered entries appear as Today toggles.
            </div>

            {/* Add new supplement */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                style={{ ...S.cell, flex: 1, textAlign: "left", padding: "10px 10px", fontSize: 14, fontWeight: 400 }}
                placeholder="Add supplement..."
                value={newSupp}
                onChange={e => setNewSupp(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addSupp()}
              />
              <button style={{ ...S.smallBtn, padding: "10px 14px", fontSize: 13 }} onClick={addSupp}>+ Add</button>
            </div>

            {/* Supplement list */}
            {supps.length === 0 && (
              <div style={{ fontSize: 11.5, color: C.textDim }}>No supplements yet — add one above.</div>
            )}
            {supps.map((s, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 32px 32px 32px", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <div style={{ background: C.cell, border: `1px solid ${C.lineBright}`, padding: "10px 12px", fontSize: 13.5, color: C.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s}</div>
                <button type="button" aria-label={`Move ${s} up`} onClick={() => moveSupp(i, -1)} style={{ ...S.smallBtn, padding: "8px", fontSize: 13, textAlign: "center" }}>↑</button>
                <button type="button" aria-label={`Move ${s} down`} onClick={() => moveSupp(i, +1)} style={{ ...S.smallBtn, padding: "8px", fontSize: 13, textAlign: "center" }}>↓</button>
                <button type="button" aria-label={`Remove ${s}`} onClick={() => removeSupp(i)} style={{ ...S.smallBtn, padding: "8px", fontSize: 13, color: C.red, borderColor: "#5a1a14", textAlign: "center" }}>✕</button>
              </div>
            ))}
          </>
        )}

        {section === "diet" && (
          <>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
              Fig. 3 · Dietary constraints. Meal plans are filtered against these rules.
            </div>
            {DIETARY_TAGS.map(({ key, label }) => {
              const on = dietary.includes(key);
              return (
                <button key={key} onClick={() => toggleDietary(key)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, border: `1px solid ${on ? C.text : C.line}`, borderRadius: 0, padding: "14px 16px", marginBottom: 8, cursor: "pointer", fontFamily: mono, textAlign: "left" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: on ? C.text : C.textDim, letterSpacing: "0.04em" }}>{label}</div>
                  <div style={checkBox(on)}>
                    {on && <div style={checkDot} />}
                  </div>
                </button>
              );
            })}
            {dietary.length === 0 && (
              <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 4 }}>No restrictions — all recipes available.</div>
            )}
          </>
        )}

        {section === "training" && (
          <>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
              Fig. 4 · Session cues. Haptics are used when the device supports them; audio stays off until you opt in.
            </div>
            {[
              ["haptics", "Haptic cues", "A light tick on set completion and a stronger rest-timer cue."],
              ["restAudio", "Rest-end audio", "An optional short chirp when lifting rest reaches zero."],
            ].map(([key, label, description]) => {
              const on = trainingCues[key] === true;
              return (
                <button key={key} type="button" onClick={() => setTrainingCues(v => ({ ...v, [key]: !on }))}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, background: C.bg, border: `1px solid ${on ? C.text : C.line}`, padding: "14px 16px", marginBottom: 8, cursor: "pointer", fontFamily: mono, textAlign: "left" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: on ? C.text : C.textDim, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                    <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4, lineHeight: 1.5 }}>{description}</div>
                  </div>
                  <div style={checkBox(on, 12)}>{on && <div style={checkDot} />}</div>
                </button>
              );
            })}
          </>
        )}

        {section === "theme" && (
          <div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
              Fig. 4 · Plate mode. Same layout, inverted stock.
            </div>
            {PRIMARY_THEMES.map(id => THEMES[id]).filter(Boolean).map(t => {
              const active = (currentTheme || "whitepaperLight") === t.id;
              return (
                <button key={t.id} onClick={() => onThemeChange && onThemeChange(t.id)}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, border: `1px solid ${active ? C.text : C.line}`, borderRadius: 0, padding: "14px 16px", marginBottom: 8, cursor: "pointer", fontFamily: mono, textAlign: "left" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? C.text : C.textDim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{t.label}</div>
                    <div style={{ fontSize: 11.5, color: C.textDim }}>{t.desc}</div>
                  </div>
                  <div style={checkBox(active, 12)}>
                    {active && <div style={checkDot} />}
                  </div>
                </button>
              );
            })}
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 8, lineHeight: 1.6 }}>
              // More themes coming soon.
            </div>
          </div>
        )}

        {section === "integrations" && (
          <>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
              Fig. 5 · Data sources. Wearables become recovery figures and ledger rows.
            </div>

            {/* Google Health / Fitbit Connection */}
            <div style={{ marginBottom: 20 }}>
              <label style={lbl}>Fitbit by Google / Google Health</label>
              <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 12, lineHeight: 1.6 }}>
                Coming soon — connect your Google account to bring Fitbit sleep, recovery, and activity data into the app.
              </div>
              <button
                type="button"
                disabled
                onClick={handleGoogleHealthConnect}
                style={{
                  ...connectBtn(true),
                  background: C.cell,
                  color: C.textFaint,
                  border: `1px solid ${C.line}`,
                  cursor: "not-allowed",
                }}
              >
                Coming soon
              </button>
              {googleHealthMsg && (
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.6, fontFamily: mono }}>
                  {googleHealthMsg}
                </div>
              )}
            </div>

            {/* Strava Connection */}
            <div style={{ marginBottom: 20, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
              <label style={lbl}>Strava</label>
              <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 12, lineHeight: 1.6 }}>
                Opt-in. Brings your runs, rides, walks, and hikes into the cardio ledger and training load —
                one tap on Today logs a Strava session as that day&apos;s cardio. Strava data stays out of AI Coach.
              </div>
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint, marginBottom: 12 }}>
                Powered by Strava
              </div>
              {(stravaStatus?.connected || settings.stravaConnected) ? (
                <>
                  <div style={statusBox}>
                    {stravaStatus?.isExpired ? "⚠ Connection needs reconnect." : "✓ Strava Connected"}
                    {(stravaStatus?.lastSynced || stravaCounts?.lastSynced)
                      ? ` · last synced ${new Date(stravaStatus?.lastSynced || stravaCounts?.lastSynced).toLocaleDateString()} ${new Date(stravaStatus?.lastSynced || stravaCounts?.lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : " · not synced yet"}
                  </div>

                  {stravaCounts && (
                    <div style={countsBox}>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: (stravaCounts.activities || 0) > 0 ? C.text : C.textFaint }}>
                        <span>Activities:</span>
                        <span>{stravaCounts.activities || 0} sessions</span>
                      </div>
                      {stravaCounts.latestDate && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.line}`, color: C.textFaint }}>
                          Latest available date: {stravaCounts.latestDate}
                        </div>
                      )}
                      <div style={{ marginTop: 6, color: C.textFaint, lineHeight: 1.6 }}>
                        AI Coach eligibility: {stravaStatus?.aiEligible ? "enabled" : "excluded by Strava policy guardrail"}.
                      </div>
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => handleStravaSync(30)} disabled={stravaBusy} style={syncBtn(stravaBusy)}>
                      {stravaBusy ? "…" : "Sync now"}
                    </button>
                    <button onClick={() => handleStravaSync(90)} disabled={stravaBusy} style={syncBtn(stravaBusy)}>
                      {stravaBusy ? "…" : "Sync last 90 days"}
                    </button>
                  </div>
                  <button onClick={handleStravaDisconnect} disabled={stravaBusy} style={disconnectBtn(stravaBusy)}>
                    Disconnect
                  </button>

                  {stravaMsg && (
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.6, fontFamily: mono }}>
                      {stravaMsg}
                    </div>
                  )}

                  {stravaEvents.length > 0 && (
                    <SyncTimeline events={stravaEvents} source="strava" title="Strava sync timeline" />
                  )}
                </>
              ) : (
                <button onClick={handleStravaConnect} disabled={stravaBusy} style={connectBtn(stravaBusy)}>
                  + Connect Strava
                </button>
              )}
            </div>

            {/* Oura Ring Connection */}
            <div style={{ marginBottom: 20 }}>
              <label style={lbl}>Oura Ring</label>
              <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 12, lineHeight: 1.6 }}>
                HRV-based recovery, sleep analysis, resting heart rate, and body temperature tracking.
              </div>
              {(ouraStatus?.connected || settings.ouraConnected) ? (
                <>
                  <div style={statusBox}>
                    {ouraStatus?.isExpired ? "⚠ Connection needs reconnect." : "✓ Oura Connected"}
                    {(ouraStatus?.lastSynced || ouraCounts?.lastSynced)
                      ? ` · last synced ${new Date(ouraStatus?.lastSynced || ouraCounts?.lastSynced).toLocaleDateString()} ${new Date(ouraStatus?.lastSynced || ouraCounts?.lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : " · not synced yet"}
                  </div>

                  {ouraCounts && (
                    <div style={countsBox}>
                      {[
                        { key: "sleep", label: "Sleep", unit: "days" },
                        { key: "readiness", label: "Readiness", unit: "days" },
                        { key: "activity", label: "Activity", unit: "days" },
                        { key: "heartrate", label: "Heart rate", unit: "record" },
                        { key: "spo2", label: "SpO₂", unit: "days" },
                      ].map(({ key, label, unit }) => {
                        const n = ouraCounts[key] || 0;
                        const u = unit === "record" ? (n === 1 ? "record" : "records") : unit;
                        return (
                          <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: n > 0 ? C.text : C.textFaint }}>
                            <span>{label}:</span>
                            <span>{n} {u}</span>
                          </div>
                        );
                      })}
                      {ouraCounts.latestDate && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.line}`, color: C.textFaint }}>
                          Latest available date: {ouraCounts.latestDate}
                        </div>
                      )}
                      {!(ouraCounts.readiness || 0) && (
                        <div style={{ marginTop: 6, color: C.textFaint, lineHeight: 1.6 }}>
                          Oura connected. Scored readiness will fill in automatically after your next
                          night — background sync keeps it current, so there's nothing to do here.
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => handleOuraSync(14)} disabled={ouraBusy} style={syncBtn(ouraBusy)}>
                      {ouraBusy ? "…" : "Sync now"}
                    </button>
                    <button onClick={() => handleOuraSync(30)} disabled={ouraBusy} style={syncBtn(ouraBusy)}>
                      {ouraBusy ? "…" : "Sync last 30 days"}
                    </button>
                  </div>
                  <button onClick={handleOuraDisconnect} disabled={ouraBusy} style={disconnectBtn(ouraBusy)}>
                    Disconnect
                  </button>

                  {ouraMsg && (
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.6, fontFamily: mono }}>
                      {ouraMsg}
                    </div>
                  )}

                  {/* V3.4 parity · Oura sync event debug timeline */}
                  {ouraEvents.length > 0 && (
                    <SyncTimeline events={ouraEvents} source="oura" title="Oura sync timeline" />
                  )}
                </>
              ) : (
                <button onClick={handleOuraConnect} disabled={ouraBusy} style={connectBtn(false)}>
                  + Connect Oura Ring
                </button>
              )}
            </div>

            {/* HRV Source Selection (if connected) */}
            {(ouraStatus?.connected || settings.ouraConnected) && (
              <div>
                <label style={lbl}>HRV Calculation</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[["ourAlgorithm", "Our Algorithm"], ["ouraMapped", "Oura Balance"]].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => onSave({ ...settings, hrvSource: val })}
                      style={{
                        ...S.cell,
                        background: (settings.hrvSource || "ourAlgorithm") === val ? C.text : C.cell,
                        color: (settings.hrvSource || "ourAlgorithm") === val ? C.bg : C.text,
                        border: "none",
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Whoop Connection (V2.9 Foundation) */}
            <div style={{ marginTop: 24, marginBottom: 20, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
              <label style={lbl}>Whoop</label>
              <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 12, lineHeight: 1.6 }}>
                Opt-in. Syncs recovery, sleep, strain cycles, and workouts. Manual recovery
                stays first-class — Whoop does not change the recovery algorithm yet
                (algorithm blending arrives next sprint).
              </div>

              {whoopStatus?.connected ? (
                <>
                  <div style={statusBox}>
                    {whoopStatus.isExpired
                      ? "⚠ Connection needs reconnect."
                      : "✓ Whoop Connected"}
                    {whoopStatus.lastSynced
                      ? ` · last synced ${new Date(whoopStatus.lastSynced).toLocaleDateString()} ${new Date(whoopStatus.lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : " · not synced yet"}
                  </div>

                  {/* V2.9.2 · per-type data completeness */}
                  {whoopCounts && (
                    <div style={countsBox}>
                      {[
                        { key: "cycle", label: "Cycle", unit: "days" },
                        { key: "sleep", label: "Sleep", unit: "days" },
                        { key: "recovery", label: "Recovery", unit: "days" },
                        { key: "workout", label: "Workout", unit: "session" },
                      ].map(({ key, label, unit }) => {
                        const n = whoopCounts[key] || 0;
                        const u = unit === "session" ? (n === 1 ? "session" : "sessions") : unit;
                        return (
                          <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: n > 0 ? C.text : C.textFaint }}>
                            <span>{label}:</span>
                            <span>{n} {u}</span>
                          </div>
                        );
                      })}
                      {whoopCounts.latestDate && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.line}`, color: C.textFaint }}>
                          Latest available date: {whoopCounts.latestDate}
                        </div>
                      )}
                      {/* Missing-data explanation — cycle-only is expected early on. */}
                      {(whoopCounts.cycle || 0) > 0 && !(whoopCounts.sleep || whoopCounts.recovery) && (
                        <div style={{ marginTop: 6, color: C.textFaint, lineHeight: 1.6 }}>
                          Sleep and recovery will appear automatically after Whoop processes your next
                          sleep — background sync keeps this current, so there's nothing to do here.
                        </div>
                      )}
                      {/* No scored recovery yet, but a connection exists. */}
                      {!(whoopCounts.recovery || 0) && (
                        <div style={{ marginTop: 6, color: C.textFaint, lineHeight: 1.6 }}>
                          Whoop connected. Scored recovery fills in automatically after your next sleep.
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => handleWhoopSync(14)} disabled={whoopBusy} style={syncBtn(whoopBusy)}>
                      {whoopBusy ? "…" : "Sync now"}
                    </button>
                    <button onClick={() => handleWhoopSync(30)} disabled={whoopBusy} style={syncBtn(whoopBusy)}>
                      {whoopBusy ? "…" : "Sync last 30 days"}
                    </button>
                  </div>
                  <button onClick={handleWhoopDisconnect} disabled={whoopBusy} style={disconnectBtn(whoopBusy)}>
                    Disconnect
                  </button>

                  {/* V3.4 · Sync event debug timeline — metadata only, no raw payloads */}
                  {whoopEvents.length > 0 && (
                    <SyncTimeline events={whoopEvents} source="whoop" title="Sync timeline" showCounts />
                  )}
                </>
              ) : (
                <button onClick={handleWhoopConnect} disabled={whoopBusy} style={connectBtn(whoopBusy)}>
                  + Connect Whoop
                </button>
              )}

              {whoopMsg && (
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.6, fontFamily: mono }}>
                  {whoopMsg}
                </div>
              )}
            </div>

            <div style={{ marginTop: 24 }}>
              <label style={lbl}>Social Sharing</label>
              <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 12, lineHeight: 1.6 }}>
                Opt in before your username and derived leaderboard / PR stats appear to other users. Raw daily entries stay private.
              </div>
              <button
                type="button"
                onClick={() => setSocialOptIn(v => !v)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, border: `1px solid ${socialOptIn ? C.text : C.line}`, borderRadius: 0, padding: "14px 16px", cursor: "pointer", fontFamily: mono, textAlign: "left" }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: socialOptIn ? C.text : C.textDim, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    {socialOptIn ? "Sharing enabled" : "Sharing disabled"}
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                    {socialOptIn ? "Your derived scores can appear on Social boards." : "You are hidden from Social boards."}
                  </div>
                </div>
                <div style={checkBox(socialOptIn, 12)}>
                  {socialOptIn && <div style={checkDot} />}
                </div>
              </button>
            </div>
          </>
        )}
        {section === "account" && (
          <div>
            <div style={{ fontSize: 11, color: C.textDim, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono, marginBottom: 6 }}>
              Recovery phrase
            </div>
            <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 14 }}>
              Your recovery phrase is the only way to reset your password — there's no email on file. Change it here, and write the new one down somewhere safe. Setting a new phrase replaces the old one immediately.
            </div>

            <label style={{ ...lbl, marginBottom: 6 }}>New recovery phrase</label>
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={recPhrase}
              onChange={(e) => setRecPhrase(e.target.value)}
              placeholder="at least 8 characters"
              style={{ ...inp, textAlign: "left", width: "100%", boxSizing: "border-box", marginBottom: 10 }}
            />

            <label style={{ ...lbl, marginBottom: 6 }}>Confirm new phrase</label>
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={recConfirm}
              onChange={(e) => setRecConfirm(e.target.value)}
              placeholder="re-enter the phrase"
              style={{ ...inp, textAlign: "left", width: "100%", boxSizing: "border-box", marginBottom: 10 }}
            />

            <button
              type="button"
              onClick={fillSuggestedPhrase}
              style={{ background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, padding: "8px 12px", fontFamily: mono, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", marginBottom: 12 }}
            >
              ⚄ Suggest a strong phrase
            </button>

            {recErr && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{recErr}</div>}
            {recMsg && <div style={{ fontSize: 12, color: C.green, marginBottom: 10 }}>{recMsg}</div>}

            <button
              type="button"
              onClick={submitRecoveryPhrase}
              disabled={recBusy}
              style={{ ...S.foodBtn, marginTop: 0, width: "100%" }}
            >
              {recBusy ? "Updating..." : "Update recovery phrase"}
            </button>
          </div>
        )}

        {section === "about" && (
          <div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6, marginBottom: 16 }}>
              0VERTRAINED {APP_VERSION} · private beta training ledger.
            </div>
            <a href={buildSupportMailto({ subject: "0VERTRAINED support" })}
              style={{ display: "block", border: `1px solid ${C.text}`, padding: "14px 16px", color: C.text, textDecoration: "none", fontFamily: mono, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Email support · {SUPPORT_EMAIL}
            </a>

            {/* V14.2 · Load-path diagnostics. `t` = ms since the run began,
                `rq` = fetch/XHR round trips so far, `kb` = transfer bytes where
                the browser exposes them (cross-origin responses without
                Timing-Allow-Origin read 0 — round-trip count is the reliable
                column). Last runs, newest first. */}
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.line}`, paddingBottom: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono }}>
                  Fig. D · Load diagnostics
                </span>
                <button
                  type="button"
                  onClick={() => { clearPerfRuns(); setPerfRuns([]); }}
                  style={{ background: "none", border: "none", color: C.textFaint, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer" }}
                >
                  Clear
                </button>
              </div>
              {perfRuns.length === 0 && (
                <div style={{ fontSize: 11, color: C.textFaint, fontFamily: mono }}>
                  No runs recorded yet — open the app or the Recovery tab, then revisit.
                </div>
              )}
              {perfRuns.slice(0, 6).map((run) => (
                <div key={`${run.kind}-${run.startedAt}`} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.textDim, fontFamily: mono, marginBottom: 2 }}>
                    {run.kind} · {new Date(run.startedAt).toLocaleString()}
                  </div>
                  {run.marks.map((m) => (
                    <div key={m.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: mono, color: C.text, borderBottom: `1px solid ${C.line}`, padding: "3px 0" }}>
                      <span>{m.label}</span>
                      <span style={{ color: C.textDim }}>{m.t}ms · {m.reqs}rq{m.kb ? ` · ${m.kb}kb` : ""}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </section>
      </div>

      {/* Save bar */}
      <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.lineBright}`, background: C.bg, display: "flex", gap: 8 }}>
        <button style={{ ...S.foodBtn, marginTop: 0, flex: 1, color: C.textDim, borderColor: C.lineBright }} onClick={onClose}>Cancel</button>
        <button style={{ ...S.foodBtn, marginTop: 0, flex: 2 }} onClick={handleSave} disabled={busy}>
          {busy ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
