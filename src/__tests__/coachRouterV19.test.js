import { describe, expect, it, vi } from "vitest";
import {
  buildSafetyReply,
  detectImmediateSafetyQuestion,
  ensureGroundedFooter,
  extractEvidenceIds,
  resolveModelStack,
  runRoutedCoach,
  selectCoachRoute,
} from "../../netlify/functions/_coach-model-router.js";

describe("V19 coach model router", () => {
  it("routes simple daily retrieval to the fast model", () => {
    expect(selectCoachRoute("How much protein do I have left today?", { consequential: false }).route).toBe("fast");
  });

  it("keeps exercise-local progression questions on the main coach", () => {
    expect(selectCoachRoute("Why is my incline press stalled?", { routeHint: "main" }).route).toBe("main");
  });

  it("routes longitudinal outcome analysis to the deep model", () => {
    expect(selectCoachRoute("Analyze the last 12 weeks and tell me which intervention worked.", {}).route).toBe("deep");
  });

  it("supports routed defaults and the legacy single-model rollback", () => {
    const routed = resolveModelStack({});
    expect(routed.mode).toBe("routed");
    expect(routed.fast.model).toBe("gemma4:31b-cloud");
    expect(routed.main.model).toBe("qwen3.5:397b-cloud");
    expect(routed.deep.model).toBe("deepseek-v4-flash:cloud");
    expect(routed.fallback.model).toBe("gpt-oss:120b-cloud");

    const single = resolveModelStack({ COACH_ROUTING_MODE: "single", COACH_MODEL: "gpt-oss:120b-cloud" });
    expect(single.mode).toBe("single");
    expect(new Set([single.fast.model, single.main.model, single.deep.model, single.fallback.model])).toEqual(new Set(["gpt-oss:120b-cloud"]));
  });

  it("bypasses the model for acute chest tightness", () => {
    const safety = detectImmediateSafetyQuestion("My chest feels tight right now during my workout.");
    expect(safety).toMatchObject({ severity: "urgent" });
    const result = buildSafetyReply(safety, {
      evidence: [{ type: "clinician_guardrails", data: { stopRules: "Stop and follow the plan.", emergencyInstructions: "Call 911 for severe symptoms." } }],
    });
    expect(result.route).toBe("safety");
    expect(result.reply).toContain("Stop the workout");
    expect(result.reply).toContain("Call 911");
  });

  it("falls back when the selected model fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: { content: "Use the current target. [E1]" },
        prompt_eval_count: 12,
        eval_count: 8,
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await runRoutedCoach({
      apiKey: "test-key",
      question: "Why is my incline press stalled?",
      evidencePacket: { routeHint: "main", consequential: false },
      system: "System",
      userContent: "Question",
      fetchImpl,
      env: {},
      ollamaUrl: "https://example.test/api/chat",
    });

    expect(result.route).toBe("main");
    expect(result.fallbackUsed).toBe(true);
    expect(result.model).toBe("gpt-oss:120b-cloud");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("extracts valid evidence ids and adds a server-assisted footer when required", () => {
    const evidence = [
      { id: "E1", importance: "primary" },
      { id: "E2", importance: "supporting" },
    ];
    expect(extractEvidenceIds("Based on [E1] and invalid [E9].", evidence)).toEqual(["E1"]);
    const grounded = ensureGroundedFooter("Continue unchanged.", evidence, { required: true });
    expect(grounded.status).toBe("server_assisted");
    expect(grounded.reply).toContain("[E1]");
  });
});
