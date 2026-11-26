// src/ProfileScreen.jsx
// Profile: the account, and the doors to notifications, the coach's settings,
// app settings, integrations and your data. Three of those are screens of
// Profile itself (Notifications, Coach, Your data); Settings is its own
// screen and opens at the section a row names. The app owns which view is
// showing, so the top bar's Back and Close always match it.

import { useEffect, useState } from "react";
import { copyToClipboard } from "./clipboard";
import { DEFAULT_COACH_PREFERENCES, normalizeCoachPreferences, mergeCoachPreferences, buildCoachMemoryExport, summarizeRecentTrend } from "./coachMemory";
import { readClinicianGuardrails } from "./clinicianGuardrails";
import { pushSupportState, getExistingSubscription } from "./push";
import { APP_VERSION } from "./appMeta";
import { NotificationsCard } from "./NotificationsCard";
import { ClinicianGuardrailsCard } from "./ClinicianGuardrailsCard";
import { LinkRow, Seg, Switch } from "./ui/ledger";

const column = (gap) => ({ display: "flex", flexDirection: "column", gap });
const rowsTop = { borderTop: "1px solid var(--line)" };

// The coach's choices, in the words the screen uses for them.
const TONES = [["balanced", "Balanced"], ["direct", "Direct"], ["encouraging", "Encouraging"]];
const FOCUSES = [["hybrid", "Hybrid"], ["strength", "Strength"], ["endurance", "Endurance"], ["physique", "Physique"]];
const INTENSITIES = [["conservative", "Conservative"], ["moderate", "Moderate"], ["aggressive", "Aggressive"]];
const REST_BIASES = [["balanced", "Balanced"], ["more-rest", "More rest"], ["more-volume", "More volume"]];
const options = (list) => list.map(([value, label]) => ({ value, label }));

function Choice({ id, label, list, value, onChange }) {
  return (
    <div style={column(6)}>
      <span id={id} className="lbl">{label}</span>
      <Seg chips labelledBy={id} options={options(list)} value={value} onChange={onChange} />
    </div>
  );
}

// ── Coach: what the coach may use about you, and your clinician's rules ──────
function CoachSettings({ settings, allData, onSaveCoachPreferences, onSaveCoachingSettings, showToast }) {
  const [draft, setDraft] = useState(() => normalizeCoachPreferences(settings?.coachPreferences || DEFAULT_COACH_PREFERENCES));
  const [fallbackText, setFallbackText] = useState(null);
  useEffect(() => {
    setDraft(normalizeCoachPreferences(settings?.coachPreferences || DEFAULT_COACH_PREFERENCES));
  }, [settings?.coachPreferences]);
  const update = (key, value) => setDraft((current) => mergeCoachPreferences(current, { [key]: value }));
  const save = () => onSaveCoachPreferences?.(normalizeCoachPreferences(draft));
  const reset = () => {
    const next = { ...DEFAULT_COACH_PREFERENCES };
    setDraft(next);
    onSaveCoachPreferences?.(next);
  };
  const copyExport = async () => {
    const text = buildCoachMemoryExport({ preferences: draft, trend: summarizeRecentTrend(allData, Date.now()) });
    const ok = await copyToClipboard(text);
    if (ok) { setFallbackText(null); showToast?.("Coach memory copied"); }
    else { setFallbackText(text); showToast?.("Select all + copy"); }
  };

  return (
    <div className="shell" data-screen="profile-coach">
      <div className="main" style={{ gap: 16 }}>
        <section aria-labelledby="coach-memory" style={column(16)}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48 }}>
            <span className="kv grow"><span id="coach-memory" className="t-bs">Coach memory</span><span className="t-s c2">Let the coach use the preferences below</span></span>
            <Switch checked={draft.enabled === true} onChange={(value) => update("enabled", value)} labelledBy="coach-memory" />
          </div>
          <Choice id="coach-tone" label="Tone" list={TONES} value={draft.tone} onChange={(value) => update("tone", value)} />
          <Choice id="coach-focus" label="Focus" list={FOCUSES} value={draft.focus} onChange={(value) => update("focus", value)} />
          <Choice id="coach-intensity" label="Intensity" list={INTENSITIES} value={draft.intensity} onChange={(value) => update("intensity", value)} />
          <Choice id="coach-rest" label="When in doubt" list={REST_BIASES} value={draft.restBias} onChange={(value) => update("restBias", value)} />
          <div className="field">
            <label className="field">
              <span className="lbl">A note about you</span>
              <textarea className="input area" rows={2} maxLength={240} value={draft.note} onChange={(event) => update("note", event.target.value)} aria-describedby="coach-note-hint" />
            </label>
            <span id="coach-note-hint" className="hint">Optional, up to 240 characters. For example: knee rehab; keep deloads conservative.</span>
          </div>
          <button type="button" className="btn btn-p btn-b" onClick={save}>Save coach preferences</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-s btn-sm" onClick={copyExport}>Copy</button>
            <button type="button" className="btn btn-s btn-sm" onClick={reset}>Reset</button>
          </div>
          {fallbackText && <textarea className="input area" readOnly rows={7} value={fallbackText} onFocus={(event) => event.target.select()} aria-label="Coach memory, to copy" />}
          <p className="t-s c2">These change how the coach talks to you and what it weighs. They never change your program, your scores or what stays private. Copy puts the preferences and a short summary of recent training on your clipboard.</p>
        </section>
        <ClinicianGuardrailsCard settings={settings} onSaveCoachingSettings={onSaveCoachingSettings} showToast={showToast} />
      </div>
    </div>
  );
}

// ── Your data: a backup out, a backup in ─────────────────────────────────────
function YourData({ exportJSON, exportCSV, fileRef, onPasteImport }) {
  return (
    <div className="shell" data-screen="profile-data">
      <div className="main" style={{ gap: 16 }}>
        <p className="t-b">Your data syncs as you log. Export a copy when you want one of your own.</p>
        <section aria-labelledby="data-export" style={column(8)}>
          <h2 id="data-export" className="t-h">Export</h2>
          <button type="button" className="btn btn-s btn-b" onClick={exportJSON}>Export full backup (JSON)</button>
          <button type="button" className="btn btn-s btn-b" onClick={exportCSV}>Export stats (CSV)</button>
        </section>
        <section aria-labelledby="data-import" style={column(8)}>
          <h2 id="data-import" className="t-h">Import</h2>
          <button type="button" className="btn btn-s btn-b" onClick={() => fileRef?.current?.click()}>Import from a file (JSON)</button>
          <button type="button" className="btn btn-s btn-b" onClick={onPasteImport}>Import from pasted text</button>
        </section>
        <p className="t-s c2">Erase-my-data controls are not included in this beta. Export a backup before you delete app data.</p>
      </div>
    </div>
  );
}

// What the Notifications row says before it is opened.
function useNotificationsLine() {
  const [line, setLine] = useState(() => (pushSupportState().supported ? "Off" : "Not available here"));
  useEffect(() => {
    if (!pushSupportState().supported) return undefined;
    let alive = true;
    getExistingSubscription().then((sub) => { if (alive) setLine(sub ? "On" : "Off"); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return line;
}

export function ProfileScreen({ view = "home", onView, username = null, demoMode = false, settings, allData, showToast, onSettings, onLogout, exportJSON, exportCSV, fileRef, onPasteImport, onSaveCoachPreferences, onSaveCoachingSettings }) {
  const notifications = useNotificationsLine();

  if (view === "notifications") {
    return <div className="shell" data-screen="profile-notifications"><div className="main" style={{ gap: 16 }}><NotificationsCard showToast={showToast} /></div></div>;
  }
  if (view === "coach") {
    return <CoachSettings settings={settings} allData={allData} onSaveCoachPreferences={onSaveCoachPreferences} onSaveCoachingSettings={onSaveCoachingSettings} showToast={showToast} />;
  }
  if (view === "data") {
    return <YourData exportJSON={exportJSON} exportCSV={exportCSV} fileRef={fileRef} onPasteImport={onPasteImport} />;
  }

  const memoryOn = normalizeCoachPreferences(settings?.coachPreferences || DEFAULT_COACH_PREFERENCES).enabled === true;
  const guardrailsOn = readClinicianGuardrails(settings).enabled === true;
  return (
    <div className="shell" data-screen="profile">
      <div className="main" style={{ gap: 16 }}>
        <div className="kv" style={{ gap: 2 }}>
          <h2 className="t-title">{demoMode ? "Demo" : username || "Your account"}</h2>
          <p className="t-s c2">{demoMode ? "Sample data. Nothing you change here is saved." : "Beta build. Signed in on this device."}</p>
        </div>
        <ul className="rows" style={rowsTop}>
          <li><LinkRow label="Notifications" sub={notifications} onClick={() => onView?.("notifications")} /></li>
          <li><LinkRow label="Coach" sub={`Memory ${memoryOn ? "on" : "off"}, clinician guardrails ${guardrailsOn ? "on" : "off"}`} onClick={() => onView?.("coach")} /></li>
          <li><LinkRow label="Settings" sub="Targets, supplements, diet, training cues, theme, account" onClick={() => onSettings?.()} /></li>
          <li><LinkRow label="Integrations" sub="Oura, Whoop and Strava" onClick={() => onSettings?.("integrations")} /></li>
          <li><LinkRow label="Your data" sub="Export a backup or stats, or import" onClick={() => onView?.("data")} /></li>
          <li><LinkRow label="Help and about" sub="Version, support and beta feedback" onClick={() => onSettings?.("about")} /></li>
        </ul>
        <p className="t-s c2">Your training plan is in Train.</p>
        {typeof onLogout === "function" && (
          <div style={{ ...column(6), marginTop: "auto" }}>
            <button type="button" className="btn btn-s btn-b" onClick={onLogout}>Log out</button>
            <p className="t-s c2" style={{ textAlign: "center" }}>{demoMode ? "Leaves the demo." : "Ends this session on this device. Your data stays synced."}</p>
          </div>
        )}
        <p className="t-s c2" style={{ textAlign: "center" }}>Version {String(APP_VERSION).replace(/^V/, "")}</p>
      </div>
    </div>
  );
}

export default ProfileScreen;
