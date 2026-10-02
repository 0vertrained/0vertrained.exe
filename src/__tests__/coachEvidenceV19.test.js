import { describe, expect, it } from "vitest";
import { buildCoachEvidencePacket, classifyCoachQuestion } from "../coachEvidence";

describe("V19 coach evidence packets", () => {
  const todayKey = "2026-07-20";
  const settings = {
    goals: { calories: 2350, protein: 200, steps: 9000 },
    coachingSystem: {
      activePlan: {
        version: 4,
        label: "Cut Plan v4",
        effectiveDate: "2026-07-15",
        evaluationDue: "2026-07-29",
        recommendationKind: "activity",
        snapshot: {
          goals: { calories: 2350, protein: 200, steps: 10000 },
          trainingModifiers: { volumeMultiplier: 1 },
        },
      },
      clinicianGuardrails: {
        enabled: true,
        exerciseHeartRateGuidance: "Stay within clinician-approved limits.",
        stopRules: "Stop for chest symptoms, faintness, or unusual shortness of breath.",
        trainingRestrictions: "No maximal-effort conditioning.",
        emergencyInstructions: "Call emergency services for severe or persistent symptoms.",
        clinicianReviewDate: "2026-08-01",
      },
    },
  };
  const data = {
    "2026-07-20": {
      nutrition: { calories: 1520, protein: 146 },
      activity: { steps: 6200 },
      body: { weight: 198.4, sleep: 7.6 },
      workout: {
        exercises: {
          "Incline Dumbbell Press": {
            sets: [
              { done: true, weight: 75, reps: 10, rir: 2, quality: "clean" },
              { done: true, weight: 75, reps: 9, rir: 1, quality: "clean" },
            ],
          },
        },
      },
    },
    "2026-07-19": { body: { weight: 198.8 }, nutrition: { calories: 2300, protein: 205 }, activity: { steps: 9200 } },
    "2026-07-18": { body: { weight: 199.0 }, nutrition: { calories: 2360, protein: 198 }, activity: { steps: 8800 } },
    "2026-07-17": { body: { weight: 199.2 }, nutrition: { calories: 2320, protein: 201 }, activity: { steps: 9500 } },
  };
  const program = {
    Sunday: { lifting: [{ name: "Incline Dumbbell Press" }] },
  };

  it("classifies fast, main, and deep questions without escalating a local exercise stall", () => {
    expect(classifyCoachQuestion("How much protein is left today?").routeHint).toBe("fast");
    expect(classifyCoachQuestion("Why is my incline press stalled?").routeHint).toBe("main");
    expect(classifyCoachQuestion("Analyze which intervention worked over the last 12 weeks.").routeHint).toBe("deep");
  });

  it("includes hard constraints, the active plan, today, weekly evidence, and missing-data honesty", () => {
    const packet = buildCoachEvidencePacket({
      question: "Should I reduce calories because my weight has not moved?",
      data,
      settings,
      program,
      todayKey,
      todayName: "Sunday",
      wearableSummary: "Oura and Whoop disagree; application confidence is low.",
      intelligenceSummary: { readiness: "hold", confidence: "medium", title: "Maintain", summary: "Do not stack changes." },
    });
    const types = packet.evidence.map((item) => item.type);
    expect(types).toContain("clinician_guardrails");
    expect(types).toContain("active_plan");
    expect(types).toContain("today");
    expect(types).toContain("weekly_comparison");
    expect(types).toContain("wearable_recovery");
    expect(packet.rules).toMatchObject({ deterministicAuthority: true, userApprovalRequiredForPlanChanges: true });
    expect(packet.evidence.length).toBeLessThanOrEqual(18);
    expect(packet.missing).toContain("No current-week waist measurement.");
  });

  it("adds bounded longitudinal windows only for deep questions", () => {
    const deep = buildCoachEvidencePacket({
      question: "Analyze the last 12 weeks and determine which intervention worked.",
      data,
      settings,
      program,
      todayKey,
      todayName: "Sunday",
    });
    const longitudinal = deep.evidence.find((item) => item.type === "longitudinal_windows");
    expect(longitudinal).toBeTruthy();
    expect(longitudinal.data.weeks.length).toBeLessThanOrEqual(12);
  });
});
