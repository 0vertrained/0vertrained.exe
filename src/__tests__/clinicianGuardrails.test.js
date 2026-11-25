import { describe, expect, it } from "vitest";
import { DEFAULT_CLINICIAN_GUARDRAILS, readClinicianGuardrails, withClinicianGuardrails } from "../clinicianGuardrails";

describe("clinician guardrails settings", () => {
  it("defaults to off with a symptom stop rule ready to enable", () => {
    const guardrails = readClinicianGuardrails({});
    expect(guardrails.enabled).toBe(false);
    expect(guardrails.stopRules).toBe(DEFAULT_CLINICIAN_GUARDRAILS.stopRules);
    expect(guardrails.stopRules).toMatch(/stop training/);
  });

  it("reads stored values over the defaults", () => {
    const settings = { coachingSystem: { clinicianGuardrails: { enabled: true, trainingRestrictions: "No max efforts." } } };
    const guardrails = readClinicianGuardrails(settings);
    expect(guardrails.enabled).toBe(true);
    expect(guardrails.trainingRestrictions).toBe("No max efforts.");
    expect(guardrails.emergencyInstructions).toBe("");
  });

  it("replaces only the guardrails when saving", () => {
    const settings = { goals: { protein: 200 }, coachingSystem: { phase: "recomposition", clinicianGuardrails: { enabled: false } } };
    const next = withClinicianGuardrails(settings, { enabled: true, stopRules: "Stop on chest pain." });
    expect(next.goals).toEqual({ protein: 200 });
    expect(next.coachingSystem.phase).toBe("recomposition");
    expect(next.coachingSystem.clinicianGuardrails.enabled).toBe(true);
    expect(next.coachingSystem.clinicianGuardrails.stopRules).toBe("Stop on chest pain.");
    expect(next.coachingSystem.clinicianGuardrails.medicationNotes).toBe("");
  });
});
