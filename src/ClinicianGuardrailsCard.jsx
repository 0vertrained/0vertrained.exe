import { useState } from "react";
import { useTheme } from "./theme";
import { readClinicianGuardrails, withClinicianGuardrails } from "./clinicianGuardrails";

const FIELDS = [
  ["exerciseHeartRateGuidance", "Exercise heart-rate guidance"],
  ["stopRules", "Symptom-based stop rules"],
  ["medicationNotes", "Medication notes"],
  ["trainingRestrictions", "Training restrictions"],
  ["emergencyInstructions", "Emergency instructions"],
];

export function ClinicianGuardrailsCard({ settings, onSaveCoachingSettings, showToast }) {
  const { C, S } = useTheme();
  const [open, setOpen] = useState(false);
  const [guardrails, setGuardrails] = useState(() => readClinicianGuardrails(settings));
  const field = { width: "100%", boxSizing: "border-box", marginTop: 4, background: C.bg, color: C.text, border: `1px solid ${C.lineBright}`, padding: "8px 9px", fontFamily: C.fontFamily, fontSize: 11 };
  const save = () => {
    onSaveCoachingSettings?.(withClinicianGuardrails(settings, guardrails));
    showToast?.("Clinician guardrails saved");
  };
  return (
    <section style={S.block}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Clinician guardrails</span>
        <span style={S.blockStat}>{guardrails.enabled ? "On" : "Off"}</span>
      </div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ ...S.smallBtn, width: "100%" }}>
        {open ? "Hide guardrails" : "Edit guardrails"}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", fontSize: 11.5, color: C.text }}>
            <input type="checkbox" checked={guardrails.enabled === true} onChange={(e) => setGuardrails({ ...guardrails, enabled: e.target.checked })} />
            Enforce clinician-defined constraints
          </label>
          {FIELDS.map(([key, label]) => (
            <label key={key} style={{ display: "block", fontSize: 9.5, color: C.textFaint, marginTop: 8 }}>
              {label}
              <textarea value={guardrails[key] || ""} onChange={(e) => setGuardrails({ ...guardrails, [key]: e.target.value })} rows={key === "stopRules" ? 3 : 2} style={field} />
            </label>
          ))}
          <label style={{ display: "block", fontSize: 9.5, color: C.textFaint, marginTop: 8 }}>
            Clinician review date
            <input type="date" value={guardrails.clinicianReviewDate || ""} onChange={(e) => setGuardrails({ ...guardrails, clinicianReviewDate: e.target.value })} style={{ ...field, display: "block" }} />
          </label>
          <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5, marginTop: 9 }}>These are hard constraints for Session Mode and the coach. They do not replace medical care or emergency services.</div>
          <button type="button" onClick={save} style={{ ...S.smallBtn, width: "100%", marginTop: 10 }}>Save guardrails</button>
        </div>
      )}
    </section>
  );
}

export default ClinicianGuardrailsCard;
