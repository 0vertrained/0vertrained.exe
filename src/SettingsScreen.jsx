import { Fragment, useState, useEffect, useRef } from "react";
import { THEMES, PRIMARY_THEMES } from "./theme";
import { FoldRow, Flow, Icon, LinkRow, Seg, Switch, TopBar } from "./ui/ledger";
import { DIETARY_TAGS } from "./mealPlan";
import { getOuraAuthUrl, disconnectOura, getOuraSyncEvents, getOuraTokenStatus, getOuraSyncCounts, syncOuraNow } from "./oura";
import { getWhoopAuthUrl, getWhoopTokenStatus, syncWhoopNow, disconnectWhoop, getWhoopSyncCounts, getWhoopSyncEvents } from "./whoop";
import { getStravaAuthUrl, getStravaTokenStatus, syncStravaNow, disconnectStrava, getStravaSyncCounts, getStravaSyncEvents } from "./strava";
import { buildSyncTimeline, buildSyncHealthBadge, formatSyncCounts } from "./recovery/wearableSyncEvents";
import { ONBOARDING_GOALS, ONBOARDING_DATA_MODES } from "./onboardingSetup";
import { friendlySyncError } from "./integrationErrors";
import { useConfirm } from "./ui/ConfirmDialog";
import { changeRecoveryPhrase } from "./auth";
import { suggestRecoveryPhrase } from "./recoveryPhraseSuggest";
import { buildBetaFeedbackText } from "./firstWeekJourney";
import { copyToClipboard } from "./clipboard";
import { APP_VERSION, SUPPORT_EMAIL, buildSupportMailto } from "./appMeta";
import { nativePlugin } from "./native";
import { AppleWatchCard } from "./sections/AppleWatchCard";

const GOAL_LABELS = Object.fromEntries(ONBOARDING_GOALS.map(g => [g.id, g.label]));
const DATA_MODE_LABELS = Object.fromEntries(ONBOARDING_DATA_MODES.map(m => [m.id, m.label]));

// A provider's sync events, newest first: metadata only, never payloads.
// `showCounts` adds each event's record counts (Whoop reports them).
function SyncTimeline({ events, source, title, showCounts = false }) {
  const timeline = buildSyncTimeline(events, { source, limit: 8 });
  const badge = buildSyncHealthBadge(events, source);
  const tone = (value) => (value === "warning" ? "stop" : value === "caution" ? "caution" : value === "good" ? "good" : "c2");
  return (
    <section aria-label={`${title} sync timeline`} style={column(6)}>
      <div className="sec"><h3 className="t-ss">{title}</h3><span className={`t-s ${tone(badge.tone)}`}>{badge.label}</span></div>
      <ul className="rows">
        {timeline.entries.map((entry, index) => {
          const counts = showCounts ? formatSyncCounts(entry.counts) : "";
          return (
            <li key={entry.id || index} className="row" style={{ alignItems: "flex-start", padding: "8px 0", minHeight: 0 }}>
              <span className="kv grow">
                <span className="t-s">{entry.eventLabel} · <span className={tone(entry.tone)}>{entry.status}</span></span>
                <span className="t-s c2">{entry.message}{counts ? ` · ${counts}` : ""}</span>
              </span>
              <span className="t-s c2">{entry.timeAgo || "—"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// When a provider last synced, in words.
function synced(at) {
  if (!at) return "not synced yet";
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "not synced yet";
  const sameDay = when.toDateString() === new Date().toDateString();
  return `synced ${sameDay ? "" : `${when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, `}${when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()}`;
}
const statusLine = (on, status, lastSynced) => {
  if (!on) return <p className="t-ss c2">Not connected</p>;
  if (status?.isExpired) return <p className="t-ss caution">Sign-in expired. Reconnect to resume syncing. Last {synced(lastSynced)}.</p>;
  return <p className="t-ss good">Connected · {synced(lastSynced)}</p>;
};
const countRows = (rows) => (
  <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
    {rows.map(([label, value]) => (
      <Fragment key={label}><dt className="t-s c2">{label}</dt><dd className="t-s">{value}</dd></Fragment>
    ))}
  </dl>
);
const plural = (n, one, many) => `${n}${NBSP}${n === 1 ? one : many}`;

// One wearable: its state, what it brings, and its controls.
function ProviderCard({ id, name, on, status, lastSynced, about, extra = null, busyNow, onConnect, connectLabel, onDisconnect, syncs, onSync, message, counts }) {
  return (
    <section className="card" aria-labelledby={`int-${id}`} style={{ ...column(8), padding: 12, borderColor: on && status?.isExpired ? "var(--caution)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 id={`int-${id}`} className="t-h grow">{name}</h2>
        {!on && <button type="button" className="btn btn-p btn-sm" aria-disabled={busyNow || undefined} onClick={() => !busyNow && onConnect()}>{connectLabel}</button>}
        {on && status?.isExpired && <button type="button" className="btn btn-p btn-sm" aria-disabled={busyNow || undefined} onClick={() => !busyNow && onConnect()}>Reconnect</button>}
      </div>
      {statusLine(on, status, lastSynced)}
      <p className="t-s c2">{about}</p>
      {extra}
      {on && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {syncs.map(([label, days]) => (
              <button key={label} type="button" className="btn btn-s btn-sm" aria-disabled={busyNow || undefined} onClick={() => !busyNow && onSync(id, days)}>{busyNow ? "Syncing…" : label}</button>
            ))}
            <button type="button" className="btn btn-g btn-sm" aria-disabled={busyNow || undefined} onClick={() => !busyNow && onDisconnect()}>Disconnect</button>
          </div>
          {counts && <ul className="rows" style={{ borderTop: "1px solid var(--line)" }}><FoldRow title="What has synced" sub="Days and records by type">{counts}</FoldRow></ul>}
        </>
      )}
      {message && <p className="t-s" role="status">{message}</p>}
    </section>
  );
}

// Settings is one page (targets, training cues, theme) with its own screens
// for these. A section the app opens Settings at (Recovery's links and the
// wearable sign-in return name "integrations") lands on its screen.
const SETTINGS_PAGES = ["supps", "diet", "integrations", "account", "about"];
const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const NBSP = "\u00a0";

// InitialSection opens a section directly (Recovery's links and the
// OAuth return land on Integrations); notice is the one status line shown
// there ({ tone: "ok" | "error", text }); onPatch persists a connection flag
// quietly, without the full Save path's close + toast.
export function SettingsScreen({ settings, onSave, onClose, busy, onThemeChange, currentTheme, initialSection = null, notice = null, onPatch = null, loggedDays = 0, currentTab = "Settings", backLabel = null }) {
  const { confirm, confirmDialog } = useConfirm();
  // Runs on the Apple Watch: only in an iPhone app build that has them.
  const watchRuns = Boolean(nativePlugin("OTRuns"));
  const [goals, setGoals]     = useState({ ...settings.goals });
  const [supps, setSupps]     = useState([...settings.supplements]);
  const [newSupp, setNewSupp] = useState("");
  const [dietary, setDietary] = useState([...(settings.dietaryRestrictions || [])]);
  const [trainingCues, setTrainingCues] = useState({ haptics: true, restAudio: false, ...(settings.trainingCues || {}) });
  const [section, setSection] = useState(() => (SETTINGS_PAGES.includes(initialSection) ? initialSection : "home"));
  // A new screen starts at its top, with focus on its way back.
  const shellRef = useRef(null);
  const shownSection = useRef(section);
  useEffect(() => {
    if (shownSection.current === section) return;
    shownSection.current = section;
    const shell = shellRef.current;
    const frame = shell?.closest(".flow-screen");
    if (frame) frame.scrollTop = 0;
    shell?.querySelector(".top .back")?.focus({ preventScroll: true });
  }, [section]);

  // Change-recovery-phrase panel (Account section). Lets a signed-in
  // user rotate their phrase — closes the permanent-lockout gap where a phrase
  // set at signup could never be changed.
  const [recPhrase, setRecPhrase] = useState("");
  const [recConfirm, setRecConfirm] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [recMsg, setRecMsg] = useState("");
  const [recErr, setRecErr] = useState("");

  // Load-path diagnostics (About section). Read once per Settings
  // open; the Clear button empties both storage and the local list.
  // Beta feedback note lives under About (it was on the Profile hub).
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackFallback, setFeedbackFallback] = useState(null);
  const [feedbackCopied, setFeedbackCopied] = useState(false);
  const copyBetaFeedback = async () => {
    const text = buildBetaFeedbackText({
      tab: currentTab,
      settings,
      loggedDays,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      note: feedbackNote,
      version: APP_VERSION,
    });
    const ok = await copyToClipboard(text);
    setFeedbackFallback(ok ? null : text);
    setFeedbackCopied(ok);
  };

  // Oura — same user-facing sync controls as Whoop. Tokens stay server-side.
  const [ouraStatus, setOuraStatus] = useState(null);
  const [ouraBusy, setOuraBusy] = useState(false);
  const [ouraMsg, setOuraMsg] = useState("");
  const [ouraCounts, setOuraCounts] = useState(null);
  const [ouraEvents, setOuraEvents] = useState([]);

  // Whoop — status is server-held; the browser never reads tokens.
  const [whoopStatus, setWhoopStatus] = useState(null);
  const [whoopBusy, setWhoopBusy] = useState(false);
  const [whoopMsg, setWhoopMsg] = useState("");
  // Per-type completeness so the user can see exactly what landed.
  const [whoopCounts, setWhoopCounts] = useState(null);
  // Sync event debug timeline.
  const [whoopEvents, setWhoopEvents] = useState([]);

  // Strava — activity import only; excluded from AI Coach by policy.
  const [stravaStatus, setStravaStatus] = useState(null);
  const [stravaBusy, setStravaBusy] = useState(false);
  const [stravaMsg, setStravaMsg] = useState("");
  const [stravaCounts, setStravaCounts] = useState(null);
  const [stravaEvents, setStravaEvents] = useState([]);

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
      const [status, ouraStat, stravaStat] = await Promise.all([
        getWhoopTokenStatus(),
        getOuraTokenStatus(),
        getStravaTokenStatus(),
      ]);
      if (!alive) return;
      setWhoopStatus(status);
      setOuraStatus(ouraStat);
      setStravaStatus(stravaStat);
      // Persist the durable flag only once the server confirms a live connection
      // (e.g. after returning from the OAuth redirect with ?whoop=connected).
      const connectionPatch = {};
      if (status?.connected && settings.whoopConnected !== true) connectionPatch.whoopConnected = true;
      if (ouraStat?.connected && settings.ouraConnected !== true) connectionPatch.ouraConnected = true;
      if (stravaStat?.connected && settings.stravaConnected !== true) connectionPatch.stravaConnected = true;
      if (Object.keys(connectionPatch).length) {
        // Quietly when the shell offers it: the full Save path closes
        // Settings, which would shut this screen right after an OAuth return
        // lands here.
        if (onPatch) onPatch(connectionPatch);
        else onSave({ ...settings, ...connectionPatch });
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

  const handleSave = () => onSave({ goals, supplements: supps, dietaryRestrictions: dietary, trainingCues });

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

  // ── The screens ────────────────────────────────────────────────────────────
  const page = section;
  const goHome = () => setSection("home");
  const draftDirty = JSON.stringify({ goals, supps, dietary, trainingCues }) !== JSON.stringify({
    goals: { ...settings.goals },
    supps: [...(settings.supplements || [])],
    dietary: [...(settings.dietaryRestrictions || [])],
    trainingCues: { haptics: true, restAudio: false, ...(settings.trainingCues || {}) },
  });
  const macroKcal = ["protein", "carbs", "fats"].every((key) => Number(goals[key]) > 0)
    ? Math.round(Number(goals.protein) * 4 + Number(goals.carbs) * 4 + Number(goals.fats) * 9)
    : null;
  const ouraOn = Boolean(ouraStatus?.connected || settings.ouraConnected);
  const stravaOn = Boolean(stravaStatus?.connected || settings.stravaConnected);
  const whoopOn = Boolean(whoopStatus?.connected);
  const titles = { home: "Settings", supps: "Supplements", diet: "Dietary restrictions", integrations: "Integrations", account: "Account", about: "Help and about" };

  const foot = (
    <div className="foot" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {draftDirty && <p className="t-s c2" role="status">Not saved yet.</p>}
      <button type="button" className="btn btn-p btn-b" aria-disabled={busy || undefined} onClick={() => !busy && handleSave()}>{busy ? "Saving…" : "Save settings"}</button>
    </div>
  );

  const home = (
    <>
      {(settings.setup?.goal || settings.setup?.dataMode) && (
        <p className="t-s c2">Goal: {GOAL_LABELS[settings.setup?.goal] || "not set"}. Recovery data: {DATA_MODE_LABELS[settings.setup?.dataMode] || "Manual only"}.</p>
      )}
      <section aria-labelledby="set-targets" style={column(12)}>
        <h2 id="set-targets" className="t-h">Targets</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px 16px" }}>
          {[["calories", "Calories (kcal)"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fats", "Fat (g)"], ["water", "Water (oz)"]].map(([key, label]) => (
            <label key={key} className="field">
              <span className="lbl">{label}</span>
              <input className="input n" type="number" inputMode="numeric" value={goals[key] ?? ""} onChange={(event) => updateGoal(key, event.target.value)} />
            </label>
          ))}
        </div>
        {macroKcal !== null && (
          <p className="banner" role="status">
            <span>Protein, carbs and fat add up to <b>{macroKcal.toLocaleString("en-US")}{NBSP}kcal</b>. Protein is {Math.round((Number(goals.protein) * 4 / macroKcal) * 100)}% of that.</span>
          </p>
        )}
        <p className="t-s c2">Today and Fuel measure your day against these.</p>
      </section>
      <hr className="hr" />
      <section aria-labelledby="set-cues" style={column(4)}>
        <h2 id="set-cues" className="t-h">Training cues</h2>
        <div className="rows">
          {[
            ["haptics", "Haptics", "A light tick when a set is logged, a stronger one when rest ends."],
            ["restAudio", "Sound when rest ends", "A short chirp when lifting rest reaches zero."],
          ].map(([key, label, sub]) => (
            <div key={key} className="row" style={{ alignItems: "flex-start", padding: "8px 0" }}>
              <span className="kv grow"><span id={`cue-${key}`} className="t-bs">{label}</span><span className="t-s c2">{sub}</span></span>
              <Switch checked={trainingCues[key] === true} onChange={(value) => setTrainingCues((current) => ({ ...current, [key]: value }))} labelledBy={`cue-${key}`} />
            </div>
          ))}
        </div>
        <p className="t-s c2">Haptics work where the device supports them. Sound stays off until you turn it on.</p>
      </section>
      <div style={column(6)}>
        <span id="set-theme" className="lbl">Theme</span>
        <Seg labelledBy="set-theme" options={PRIMARY_THEMES.map((id) => THEMES[id]).filter(Boolean).map((theme) => ({ value: theme.id, label: theme.desc }))} value={currentTheme || "whitepaperLight"} onChange={(id) => onThemeChange?.(id)} />
        <p className="t-s c2">Changes at once, and is kept for this device.</p>
      </div>
      <ul className="rows" style={{ borderTop: "1px solid var(--line)" }}>
        <li><LinkRow label="Supplements" sub={supps.length ? supps.join(", ") : "None yet"} onClick={() => setSection("supps")} /></li>
        <li><LinkRow label="Dietary restrictions" sub={dietary.length ? DIETARY_TAGS.filter((tag) => dietary.includes(tag.key)).map((tag) => tag.label).join(", ") : "None"} onClick={() => setSection("diet")} /></li>
        <li><LinkRow label="Integrations" sub={watchRuns ? "Apple Watch, Oura, Whoop and Strava" : "Oura, Whoop and Strava"} onClick={() => setSection("integrations")} /></li>
        <li><LinkRow label="Account" sub="Change your recovery phrase" onClick={() => setSection("account")} /></li>
        <li><LinkRow label="Help and about" sub="Version, support and beta feedback" onClick={() => setSection("about")} /></li>
      </ul>
    </>
  );

  const suppsPage = (
    <>
      <p className="t-b">These appear on Today, in this order, to tick off.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <label className="field grow">
          <span className="lbl">Add a supplement</span>
          <input className="input" value={newSupp} onChange={(event) => setNewSupp(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addSupp()} />
        </label>
        <button type="button" className="btn btn-s" onClick={addSupp} style={{ alignSelf: "flex-end" }}>Add</button>
      </div>
      {supps.length === 0 ? <p className="t-s c2">No supplements yet. Add one above.</p> : (
        <ul className="rows" style={{ borderTop: "1px solid var(--line)" }}>
          {supps.map((supp, index) => (
            <li key={supp} className="row" style={{ minHeight: 52, gap: 4 }}>
              <span className="t-bs grow">{supp}</span>
              <button type="button" className="ibtn" aria-label={`Move ${supp} up`} aria-disabled={index === 0 || undefined} onClick={() => moveSupp(index, -1)}><Icon name="up" size="s" /></button>
              <button type="button" className="ibtn" aria-label={`Move ${supp} down`} aria-disabled={index === supps.length - 1 || undefined} onClick={() => moveSupp(index, +1)}><Icon name="down" size="s" /></button>
              <button type="button" className="ibtn" aria-label={`Remove ${supp}`} onClick={() => removeSupp(index)}><Icon name="close" size="s" /></button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const dietPage = (
    <>
      <p className="t-b">Meal plans leave out recipes that break these.</p>
      <div className="chips" role="group" aria-label="Dietary restrictions">
        {DIETARY_TAGS.map(({ key, label }) => (
          <button key={key} type="button" className="chip" aria-pressed={dietary.includes(key)} onClick={() => toggleDietary(key)}>{label}</button>
        ))}
      </div>
      {dietary.length === 0 && <p className="t-s c2">None set, so every recipe is available.</p>}
    </>
  );

  const onSync = (id, days) => (id === "oura" ? handleOuraSync(days) : id === "whoop" ? handleWhoopSync(days) : handleStravaSync(days));

  const integrationsPage = (
    <>
      {notice?.text && (
        <p role="status" data-testid="integrations-notice" className={notice.tone === "error" ? "banner caution" : "banner"}>{notice.text}</p>
      )}
      {watchRuns && <AppleWatchCard />}
      <ProviderCard onSync={onSync} {...{
        id: "oura", name: "Oura", on: ouraOn, status: ouraStatus, lastSynced: ouraStatus?.lastSynced || ouraCounts?.lastSynced,
        about: "HRV-based recovery, sleep, resting heart rate and body temperature.",
        busyNow: ouraBusy, onConnect: handleOuraConnect, connectLabel: "Connect Oura Ring", onDisconnect: handleOuraDisconnect,
        syncs: [["Sync now", 14], ["Sync last 30 days", 30]], message: ouraMsg,
        counts: ouraCounts && (
          <>
            {countRows([
              ["Sleep", plural(ouraCounts.sleep || 0, "day", "days")],
              ["Readiness", plural(ouraCounts.readiness || 0, "day", "days")],
              ["Activity", plural(ouraCounts.activity || 0, "day", "days")],
              ["Heart rate", plural(ouraCounts.heartrate || 0, "record", "records")],
              ["SpO₂", plural(ouraCounts.spo2 || 0, "day", "days")],
              ...(ouraCounts.latestDate ? [["Latest day", ouraCounts.latestDate]] : []),
            ])}
            {!(ouraCounts.readiness || 0) && <p className="t-s c2">Scored readiness fills in after your next night. Background sync keeps it current, so there is nothing to do here.</p>}
          </>
        ),
      }} />
      <ProviderCard onSync={onSync} {...{
        id: "whoop", name: "Whoop", on: whoopOn, status: whoopStatus, lastSynced: whoopStatus?.lastSynced,
        about: "Opt-in. Syncs recovery, sleep, strain cycles and workouts. Manual recovery stays first-class, and the recovery score is still computed by the app.",
        busyNow: whoopBusy, onConnect: handleWhoopConnect, connectLabel: "Connect Whoop", onDisconnect: handleWhoopDisconnect,
        syncs: [["Sync now", 14], ["Sync last 30 days", 30]], message: whoopMsg,
        counts: whoopCounts && (
          <>
            {countRows([
              ["Cycle", plural(whoopCounts.cycle || 0, "day", "days")],
              ["Sleep", plural(whoopCounts.sleep || 0, "day", "days")],
              ["Recovery", plural(whoopCounts.recovery || 0, "day", "days")],
              ["Workout", plural(whoopCounts.workout || 0, "session", "sessions")],
              ...(whoopCounts.latestDate ? [["Latest day", whoopCounts.latestDate]] : []),
            ])}
            {(whoopCounts.cycle || 0) > 0 && !(whoopCounts.sleep || whoopCounts.recovery) && <p className="t-s c2">Sleep and recovery appear after Whoop processes your next sleep. Background sync keeps this current, so there is nothing to do here.</p>}
            {!(whoopCounts.recovery || 0) && <p className="t-s c2">Scored recovery fills in after your next sleep.</p>}
          </>
        ),
      }} />
      <ProviderCard onSync={onSync} {...{
        id: "strava", name: "Strava", on: stravaOn, status: stravaStatus, lastSynced: stravaStatus?.lastSynced || stravaCounts?.lastSynced,
        about: "Opt-in. Brings your runs, rides, walks and hikes into the cardio log and training load. One tap on Today logs a Strava session as that day’s cardio. Strava data stays out of AI Coach.",
        extra: <p className="t-ss">Powered by Strava</p>,
        busyNow: stravaBusy, onConnect: handleStravaConnect, connectLabel: "Connect Strava", onDisconnect: handleStravaDisconnect,
        syncs: [["Sync now", 30], ["Sync last 90 days", 90]], message: stravaMsg,
        counts: stravaCounts && countRows([
          ["Activities", plural(stravaCounts.activities || 0, "session", "sessions")],
          ...(stravaCounts.latestDate ? [["Latest day", stravaCounts.latestDate]] : []),
          ["AI Coach", stravaStatus?.aiEligible ? "Included" : "Left out, as Strava’s policy requires"],
        ]),
      }} />
      {ouraOn && (
        <div style={column(6)}>
          <span id="set-hrv" className="lbl">HRV source for Oura</span>
          <Seg labelledBy="set-hrv" options={[{ value: "ourAlgorithm", label: "Our algorithm" }, { value: "ouraMapped", label: "Oura HRV Balance" }]} value={settings.hrvSource || "ourAlgorithm"} onChange={(value) => (onPatch ? onPatch({ hrvSource: value }) : onSave({ ...settings, hrvSource: value }))} />
        </div>
      )}
      {(ouraEvents.length > 0 || whoopEvents.length > 0 || stravaEvents.length > 0) && (
        <ul className="rows" style={{ borderTop: "1px solid var(--line)" }}>
          <FoldRow title="Diagnostics" sub="Sync timeline for each provider">
            {ouraEvents.length > 0 && <SyncTimeline events={ouraEvents} source="oura" title="Oura" />}
            {whoopEvents.length > 0 && <SyncTimeline events={whoopEvents} source="whoop" title="Whoop" showCounts />}
            {stravaEvents.length > 0 && <SyncTimeline events={stravaEvents} source="strava" title="Strava" />}
          </FoldRow>
        </ul>
      )}
      <p className="t-s c2">Each value in the app names its source, and the two wearables are never averaged.</p>
    </>
  );

  const accountPage = (
    <>
      <p className="t-b">Your recovery phrase is the only way to reset your password: there is no email on file. A new phrase replaces the old one at once, so write it down somewhere safe.</p>
      {[["phrase-new", "New recovery phrase", recPhrase, setRecPhrase, "At least 8 characters."], ["phrase-again", "Confirm the new phrase", recConfirm, setRecConfirm, null]].map(([id, label, value, setValue, hint]) => (
        <div key={id} className="field">
          <label className="lbl" htmlFor={id}>{label}</label>
          <input id={id} className="input" type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
          {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
        </div>
      ))}
      <button type="button" className="btn btn-s" onClick={fillSuggestedPhrase} style={{ alignSelf: "flex-start" }}>Suggest a strong phrase</button>
      {recErr && <p className="t-s err" role="alert">{recErr}</p>}
      {recMsg && <p className="t-s good" role="status">{recMsg}</p>}
      <button type="button" className="btn btn-p btn-b" aria-disabled={recBusy || undefined} onClick={() => !recBusy && submitRecoveryPhrase()}>{recBusy ? "Updating…" : "Update recovery phrase"}</button>
    </>
  );

  const aboutPage = (
    <>
      <p className="t-b">0VERTRAINED {APP_VERSION}, private beta.</p>
      <a className="btn btn-s btn-b" href={buildSupportMailto({ subject: "0VERTRAINED support" })}>Email support</a>
      <p className="t-s c2">{SUPPORT_EMAIL}</p>
      <hr className="hr" />
      <section aria-labelledby="set-feedback" style={column(8)}>
        <h2 id="set-feedback" className="t-h">Beta feedback</h2>
        <p className="t-s c2">Copies the app version, this screen, how many days you have logged, your setup goal and mode, and your browser. No entries and no account details.</p>
        <label className="field">
          <span className="lbl">What worked, what was confusing, what you would change</span>
          <textarea className="input area" rows={3} value={feedbackNote} aria-label="Beta feedback note" onChange={(event) => { setFeedbackNote(event.target.value); setFeedbackCopied(false); }} />
        </label>
        <button type="button" className="btn btn-s btn-b" onClick={copyBetaFeedback}>{feedbackCopied ? "Copied. Paste it into an email." : "Copy beta feedback note"}</button>
        {feedbackFallback && <textarea className="input area" readOnly rows={7} value={feedbackFallback} aria-label="Beta feedback note text" onFocus={(event) => event.target.select()} />}
      </section>
      <a className="t-s" href="#/demo" style={{ minHeight: 44, display: "inline-flex", alignItems: "center", textDecoration: "underline" }}>See or share the demo</a>
    </>
  );

  const body = { home, supps: suppsPage, diet: dietPage, integrations: integrationsPage, account: accountPage, about: aboutPage }[page] || home;
  const drafts = page === "home" || page === "supps" || page === "diet";
  return (
    <Flow label={titles[page] || "Settings"} onClose={onClose} data-testid="settings">
      {confirmDialog}
      <div ref={shellRef} className="shell" data-screen="settings" style={{ maxWidth: "var(--ovt-content-width)" }}>
        {page === "home"
          ? <TopBar title="Settings" close={backLabel ? null : "Close"} onClose={onClose} back={backLabel || null} onBack={onClose} />
          : <TopBar title={titles[page]} back="Settings" onBack={goHome} />}
        <div className="main" style={{ gap: 16 }}>
          {body}
        </div>
        {drafts && foot}
      </div>
    </Flow>
  );
}
