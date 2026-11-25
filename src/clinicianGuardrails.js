// src/clinicianGuardrails.js
// Clinician guardrails: hard constraints the athlete copies in from their
// clinician. Session Mode stops a session on a safety flag when they are
// enabled, and the coach treats them as constraints it cannot override.
// Stored under settings.coachingSystem.clinicianGuardrails.

export const DEFAULT_CLINICIAN_GUARDRAILS = {
  enabled: false,
  exerciseHeartRateGuidance: "",
  stopRules: "Chest discomfort, faintness, unusual shortness of breath, or concerning palpitations: stop training and follow the clinician-approved plan.",
  medicationNotes: "",
  trainingRestrictions: "",
  emergencyInstructions: "",
  clinicianReviewDate: "",
};

export function readClinicianGuardrails(settings = {}) {
  return { ...DEFAULT_CLINICIAN_GUARDRAILS, ...(settings?.coachingSystem?.clinicianGuardrails || {}) };
}

// Settings with the guardrails replaced; every other key, including the
// rest of coachingSystem, is kept as stored.
export function withClinicianGuardrails(settings = {}, guardrails = {}) {
  return {
    ...settings,
    coachingSystem: {
      ...(settings?.coachingSystem || {}),
      clinicianGuardrails: { ...DEFAULT_CLINICIAN_GUARDRAILS, ...guardrails },
    },
  };
}
