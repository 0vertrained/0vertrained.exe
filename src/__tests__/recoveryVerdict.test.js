import { describe, expect, it } from "vitest";
import { buildRecoveryVerdict, formatDebtHours } from "../recovery/verdictResolver";

// The audit's P0 fixture: the dashboard used to say "PR attempts are allowed"
// in one block and "sleep debt should cap intensity" in another. The resolver
// must produce EXACTLY ONE instruction, with the limiter folded into it.

const pushRec = {
  label: "Push",
  prescription: "High-intensity work is reasonable. PR attempts are allowed if warm-ups move well.",
};

describe("buildRecoveryVerdict", () => {
  it("caps a push day when meaningful sleep debt is present (audit P0 fixture)", () => {
    const v = buildRecoveryVerdict({
      recommendation: pushRec,
      recovery: { score: 88, band: "very_good" },
      sleepDebt: { debtHours: 2.18, band: "elevated" },
    });
    expect(v.call).toBe("capped");
    expect(v.stamp).toBe("TRAIN — CAPPED");
    // The limiter is rendered inside the verdict, named after its cause.
    expect(v.limiter).toBeTruthy();
    expect(v.limiter.label.toLowerCase()).toContain("sleep debt");
    expect(v.limiter.label).toContain("2h 11m");
    // Exactly one instruction — the upstream PR line must not survive.
    expect(v.prescription).not.toMatch(/PR attempts are allowed/i);
    expect(v.prescription).toMatch(/do not add volume|skip added volume/i);
    expect(v.recommendation.prescription).toBe(v.prescription);
    expect(v.recommendation.label).toBe("Moderate Load");
  });

  it("keeps a clean push day intact, prescription and all", () => {
    const v = buildRecoveryVerdict({
      recommendation: pushRec,
      recovery: { score: 90, band: "very_good" },
      sleepDebt: { debtHours: 0.4 },
    });
    expect(v.call).toBe("push");
    expect(v.stamp).toBe("PUSH");
    expect(v.limiter).toBeNull();
    expect(v.prescription).toMatch(/PR attempts are allowed/i);
  });

  it("shows the sleep limiter on a normal day without demoting it", () => {
    const v = buildRecoveryVerdict({
      recommendation: { label: "Normal Load", prescription: "Proceed with planned strength/cardio." },
      recovery: { score: 74 },
      sleepDebt: { debtHours: 4.0 },
    });
    expect(v.call).toBe("train");
    expect(v.limiter?.label.toLowerCase()).toContain("sleep debt");
    // Not demoted, so the upstream instruction survives unchanged.
    expect(v.prescription).toMatch(/Proceed with planned/);
  });

  it("forces recovery on an illness warning regardless of score", () => {
    const v = buildRecoveryVerdict({
      recommendation: pushRec,
      recovery: { score: 86 },
      alerts: [{ type: "illness_warning", severity: "warning" }],
    });
    expect(v.call).toBe("recover");
    expect(v.stamp).toBe("RECOVER");
    expect(v.prescription).not.toMatch(/PR attempts/i);
    expect(v.limiter.label.toLowerCase()).toContain("illness");
  });

  it("holds acute-load high-risk days at the planned ceiling", () => {
    const v = buildRecoveryVerdict({
      recommendation: pushRec,
      recovery: { score: 87 },
      trainingLoad: { rolling: { zone: "high_risk" } },
    });
    expect(v.call).toBe("capped");
    expect(v.limiter.label.toLowerCase()).toContain("acute load");
  });

  it("demotes a push to train on low confidence and says so", () => {
    const v = buildRecoveryVerdict({
      recommendation: pushRec,
      recovery: { score: 88 },
      confidence: { level: "low" },
    });
    expect(v.call).toBe("train");
    expect(v.limiter.label.toLowerCase()).toContain("confidence");
    expect(v.prescription).toMatch(/confidence is low/i);
  });

  it("never upgrades a cautious call", () => {
    const v = buildRecoveryVerdict({
      recommendation: { label: "Pull Back", prescription: "Skip maximal sets." },
      recovery: { score: 45 },
      sleepDebt: { debtHours: 0 },
    });
    expect(v.call).toBe("easy");
    expect(v.stamp).toBe("EASY");
  });

  it("formats debt hours as h/m", () => {
    expect(formatDebtHours(2.18)).toBe("2h 11m");
    expect(formatDebtHours(0.5)).toBe("30m");
    expect(formatDebtHours(5)).toBe("5h 0m");
  });
});
