// src/NotificationsCard.jsx
// V7 · Push notification opt-in for the Profile → App section. Handles the
// three honest states: unsupported (with the actionable iOS Home-Screen
// explanation), supported-but-off, and enabled. All server interaction goes
// through src/push.js → /api/push-subscribe.

import { useEffect, useState } from "react";
import { useTheme } from "./theme";
import { pushSupportState, getExistingSubscription, enablePush, disablePush, setPushPrefs } from "./push";

export function NotificationsCard({ showToast }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const [support] = useState(() => pushSupportState());
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // V17.3 · Courier per-type prefs. Local optimistic state; the server applies
  // across all the user's devices. Defaults mirror the columns (true).
  const [prefs, setPrefs] = useState({ edition_enabled: true, transitions_enabled: true });
  const [prefBusy, setPrefBusy] = useState("");

  const togglePref = async (key) => {
    const next = !prefs[key];
    setPrefBusy(key);
    setPrefs((p) => ({ ...p, [key]: next })); // optimistic
    try {
      await setPushPrefs({ [key]: next });
    } catch {
      setPrefs((p) => ({ ...p, [key]: !next })); // revert honestly
      showToast?.("Couldn't save that preference");
    } finally {
      setPrefBusy("");
    }
  };

  useEffect(() => {
    let alive = true;
    getExistingSubscription().then(sub => { if (alive) setEnabled(!!sub); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const toggle = async () => {
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

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>Notifications</div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2, lineHeight: 1.45 }}>
            Morning edition · state changes · evening check-in
          </div>
        </div>
        {support.supported ? (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            aria-pressed={enabled}
            style={{ flexShrink: 0, border: `1px solid ${enabled ? C.text : C.lineBright}`, background: enabled ? C.text : "none", color: enabled ? C.bg : C.textDim, fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", padding: "7px 12px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "…" : enabled ? "On" : "Enable"}
          </button>
        ) : (
          <span style={{ flexShrink: 0, fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono }}>Unavailable</span>
        )}
      </div>
      {!support.supported && (
        <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.55, marginTop: 6 }}>{support.reason}</div>
      )}
      {/* V17.3 · Courier per-type switches — visible once notifications are on. */}
      {support.supported && enabled && (
        <div data-testid="courier-prefs" style={{ marginTop: 10 }}>
          {[
            { key: "edition_enabled", label: "The Morning Edition", note: "Your state and the day's call, when the data lands · ~7am" },
            { key: "transitions_enabled", label: "State changes", note: "Only when the story changes — Steady → Fresh, never a number" },
          ].map((row) => (
            <div key={row.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.text }}>{row.label}</div>
                <div style={{ fontSize: 10.5, color: C.textFaint, marginTop: 1, lineHeight: 1.4 }}>{row.note}</div>
              </div>
              <button
                type="button"
                onClick={() => togglePref(row.key)}
                disabled={prefBusy === row.key}
                aria-pressed={prefs[row.key]}
                style={{ flexShrink: 0, border: `1px solid ${prefs[row.key] ? C.text : C.lineBright}`, background: prefs[row.key] ? C.text : "none", color: prefs[row.key] ? C.bg : C.textDim, fontFamily: mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", padding: "5px 10px", cursor: prefBusy === row.key ? "default" : "pointer", opacity: prefBusy === row.key ? 0.6 : 1 }}
              >
                {prefs[row.key] ? "On" : "Off"}
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: C.red, lineHeight: 1.5, marginTop: 6 }}>{error}</div>
      )}
    </div>
  );
}
