// src/ClinicianGuardrailsCard.jsx
// Rules from your clinician, entered by you. When they are on, the session
// runner and the coach treat them as hard limits. This card only edits and
// saves them; it does not judge them.

import { useState } from "react";
import { readClinicianGuardrails, withClinicianGuardrails } from "./clinicianGuardrails";
import { Icon, Switch } from "./ui/ledger";

const FIELDS = [
  ["stopRules", "Stop rules", 3],
  ["exerciseHeartRateGuidance", "Heart-rate guidance", 2],
  ["trainingRestrictions", "Training restrictions", 2],
  ["medicationNotes", "Medication notes", 2],
  ["emergencyInstructions", "Emergency instructions", 2],
];

export function ClinicianGuardrailsCard({ settings, onSaveCoachingSettings, showToast }) {
  const [open, setOpen] = useState(false);
  const [guardrails, setGuardrails] = useState(() => readClinicianGuardrails(settings));
  const set = (key, value) => setGuardrails((current) => ({ ...current, [key]: value }));
  const save = () => {
    onSaveCoachingSettings?.(withClinicianGuardrails(settings, guardrails));
    showToast?.("Clinician guardrails saved");
  };

  return (
    <section aria-labelledby="guardrails-title" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ borderTop: "1px solid var(--line)", borderBottom: open ? "none" : "1px solid var(--line)", minHeight: 60 }}>
        <span className="kv grow"><span id="guardrails-title" className="t-bs">Clinician guardrails</span><span className="t-s c2">Rules from your clinician, entered by you</span></span>
        <span className="tag tag-f">{guardrails.enabled ? "On" : "Off"}</span>
        <Icon name={open ? "up" : "down"} size="s" className="c2" />
      </button>
      {open && (
        <>
          <div className="row" style={{ minHeight: 48 }}>
            <span id="guardrails-enforce" className="t-bs grow">Enforce these rules</span>
            <Switch checked={guardrails.enabled === true} onChange={(value) => set("enabled", value)} labelledBy="guardrails-enforce" />
          </div>
          {FIELDS.map(([key, label, rows]) => (
            <label key={key} className="field">
              <span className="lbl">{label}</span>
              <textarea className="input area" rows={rows} value={guardrails[key] || ""} onChange={(event) => set(key, event.target.value)} />
            </label>
          ))}
          <label className="field">
            <span className="lbl">Clinician review date</span>
            <input className="input" type="date" value={guardrails.clinicianReviewDate || ""} onChange={(event) => set("clinicianReviewDate", event.target.value)} />
          </label>
          <p className="t-s c2">When these are on, the session runner and the coach treat them as hard limits. They do not replace medical care or emergency services.</p>
          <button type="button" className="btn btn-p btn-b" onClick={save}>Save guardrails</button>
        </>
      )}
    </section>
  );
}

export default ClinicianGuardrailsCard;
