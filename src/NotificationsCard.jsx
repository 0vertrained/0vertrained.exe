// src/NotificationsCard.jsx
// Notifications, under Profile. In a browser, three honest states: this
// browser cannot send them (with the reason, and the iPhone Home Screen step
// when that is it), they are off, or they are on with a switch for each
// kind; everything goes through src/push.js to /api/push-subscribe. In the
// iPhone app, which push doesn't reach, the phone schedules the fixed-time
// reminders itself (src/reminders/localReminders.js).

import { useEffect, useState } from "react";
import { pushSupportState, getExistingSubscription, enablePush, disablePush, setPushPrefs } from "./push";
import { LOCAL_REMINDERS, applyReminderPrefs, hasLocalReminders, readReminderPrefs, reminderNote, writeReminderPrefs } from "./reminders/localReminders";
import { timeLabel } from "./reminders/morningPlan";
import { Switch } from "./ui/ledger";

const KINDS = [
  { key: "edition_enabled", label: "The Morning Edition", note: "Your state and the day’s call, about 7 am, once your data has landed." },
  { key: "transitions_enabled", label: "State changes", note: "Only when the story changes, like Steady to Fresh. Never a number." },
];

const sentence = (text) => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}` : "");

export function NotificationsCard({ showToast }) {
  return hasLocalReminders() ? <LocalReminders showToast={showToast} /> : <WebPush showToast={showToast} />;
}

// Morning times in quarter hours, 4:30 to 11 am.
const MORNING_TIMES = Array.from({ length: 27 }, (_, index) => {
  const minutes = 4 * 60 + 30 + index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

const DENIED = "Notifications are off for 0VERTRAINED. Turn them on in the iPhone’s Settings app, then try again.";

function LocalReminders({ showToast }) {
  const [prefs, setPrefs] = useState(() => readReminderPrefs());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = async (reminder) => {
    if (busy) return;
    const next = { ...prefs, [reminder.id]: !prefs[reminder.id] };
    setBusy(true);
    setError("");
    setPrefs(next);
    try {
      const { allowed } = await applyReminderPrefs(next);
      if (!allowed) {
        const back = { ...next, [reminder.id]: false };
        setPrefs(back);
        writeReminderPrefs(back);
        setError(DENIED);
        return;
      }
      writeReminderPrefs(next);
      showToast?.(`${reminder.label} ${next[reminder.id] ? "on" : "off"}`);
    } catch {
      setPrefs(prefs);
      setError("Couldn’t change that reminder. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // The morning reminder's time. The phone gets the new time straight away.
  const changeTime = async (value) => {
    if (busy || !value || value === prefs.morningTime) return;
    const next = { ...prefs, morningTime: value };
    setBusy(true);
    setError("");
    setPrefs(next);
    try {
      await applyReminderPrefs(next);
      writeReminderPrefs(next);
    } catch {
      setPrefs(prefs);
      setError("Couldn’t change the time. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="notifications-title" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 id="notifications-title" className="t-h">Reminders on this iPhone</h2>
        <p className="t-b">This iPhone sends these itself, at the times below. Nothing is sent until you turn one on.</p>
        {error && <p className="t-s stop" role="alert">{error}</p>}
      </div>
      <div data-testid="local-reminders" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="rows">
          {LOCAL_REMINDERS.map((reminder) => (
            <div key={reminder.id} style={{ display: "flex", flexDirection: "column" }}>
              <div className="row" style={{ alignItems: "flex-start", padding: "8px 0" }}>
                <span className="kv grow"><span id={`remind-${reminder.id}`} className="t-bs">{reminder.label}</span><span className="t-s c2">{reminderNote(reminder, prefs)}</span></span>
                <Switch checked={prefs[reminder.id]} onChange={() => toggle(reminder)} labelledBy={`remind-${reminder.id}`} disabled={busy} />
              </div>
              {reminder.plan && prefs[reminder.id] && (
                <label className="row" style={{ padding: "0 0 8px" }}>
                  <span className="t-s c2 grow">Time</span>
                  <select className="input n" value={prefs.morningTime} onChange={(event) => changeTime(event.target.value)} disabled={busy} style={{ width: "auto" }}>
                    {MORNING_TIMES.map((time) => <option key={time} value={time}>{timeLabel(time)}</option>)}
                  </select>
                </label>
              )}
            </div>
          ))}
        </div>
        <p className="t-s c2">The Morning Edition and state changes wait on your data reaching the server, so they need push, which this app can’t receive. Add 0VERTRAINED to your Home Screen from Safari to get them.</p>
      </div>
    </section>
  );
}

function WebPush({ showToast }) {
  const [support] = useState(() => pushSupportState());
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Per-kind switches. Optimistic here; the server applies them on all of
  // this account's devices. Both start on, as the server's columns do.
  const [prefs, setPrefs] = useState({ edition_enabled: true, transitions_enabled: true });
  const [prefBusy, setPrefBusy] = useState("");

  useEffect(() => {
    let alive = true;
    getExistingSubscription().then((sub) => { if (alive) setEnabled(Boolean(sub)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        showToast?.("Notifications off");
      } else {
        await enablePush();
        setEnabled(true);
        showToast?.("Notifications on");
      }
    } catch (e) {
      setError(e?.message || "Could not update notifications");
    } finally {
      setBusy(false);
    }
  };

  const togglePref = async (key) => {
    if (prefBusy) return;
    const next = !prefs[key];
    setPrefBusy(key);
    setPrefs((current) => ({ ...current, [key]: next }));
    try {
      await setPushPrefs({ [key]: next });
    } catch {
      setPrefs((current) => ({ ...current, [key]: !next }));
      showToast?.("Couldn't save that preference");
    } finally {
      setPrefBusy("");
    }
  };

  return (
    <section aria-labelledby="notifications-title" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 id="notifications-title" className="t-h">Notifications are {!support.supported ? "unavailable here" : enabled ? "on" : "off"}</h2>
        {!support.supported && <p className="t-b">{sentence(support.reason)}</p>}
        {support.supported && !enabled && (
          <>
            <p className="t-b">Nothing is sent until you turn them on. There are two kinds, the Morning Edition and state changes, and you choose between them once they are on.</p>
            <button type="button" className="btn btn-p btn-b" aria-disabled={busy || undefined} onClick={toggle}>{busy ? "Turning on…" : "Turn on notifications"}</button>
            <p className="t-s c2">Your browser will ask you to confirm. You can turn them off here at any time.</p>
          </>
        )}
        {support.supported && enabled && (
          <>
            <p className="t-b">Choose what you get below. The choice applies on every device signed in to this account.</p>
            <button type="button" className="btn btn-s btn-b" aria-disabled={busy || undefined} onClick={toggle}>{busy ? "Turning off…" : "Turn off notifications"}</button>
          </>
        )}
        {error && <p className="t-s stop" role="alert">{error}</p>}
      </div>

      {support.supported && enabled && (
        <div data-testid="courier-prefs" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="t-h">Choose what you get</h3>
          <div className="rows">
            {KINDS.map((kind) => (
              <div key={kind.key} className="row" style={{ alignItems: "flex-start", padding: "8px 0" }}>
                <span className="kv grow"><span id={`notify-${kind.key}`} className="t-bs">{kind.label}</span><span className="t-s c2">{kind.note}</span></span>
                <Switch checked={prefs[kind.key]} onChange={() => togglePref(kind.key)} labelledBy={`notify-${kind.key}`} disabled={prefBusy === kind.key} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
