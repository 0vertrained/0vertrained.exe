import { describe, expect, it, vi, afterEach } from "vitest";
import { analyzeVideoWithHostedEngine, mapHostedResultToAnalysis } from "../formCheck/serverPoseClient";

const okResponse = {
  ok: true,
  status: "analyzed",
  movement: "benchpress-side-view",
  model: { pose: "mediapipe", complexity: 2, engineVersion: "v1" },
  video: { durationSec: 4, fpsAnalyzed: 10, framesAnalyzed: 40 },
  confidence: { score: 0.82, level: "high", reasons: [], framesWithPose: 38, avgVisibility: 0.8 },
  metrics: { minElbowAngleDeg: 72 },
  summary: { repCount: 2, overall: "Solid V1 estimate." },
  reps: [{ index: 1, startMs: 0, endMs: 2000, tempoSec: 2, confidence: 0.82, assessment: "estimated" }],
  cues: [{ id: "baseline", severity: "info", text: "No major V1 flags." }],
  privacy: { videoStored: false, retention: "deleted_after_processing", rawPoseReturned: false },
  disclaimer: "Educational estimate only.",
  // V1.2: Coaching-tier fields
  formScore: 82,
  metricConfidence: 0.85,
  captureQuality: { lighting: "good", framing: "excellent", motionBlur: "minimal", bodyVisibility: "clear", overallQuality: "high" },
  coaching: { nextSetCue: "Focus on full elbow extension at the top.", retakeRecommendation: null },
  enrichedRepNotes: ["Rep 1: solid lockout", "Rep 2: slight elbows flare"],
  // V1.3: derived evidence/progress fields
  evidence: {
    summary: "Bench evidence derived from visible elbow range.",
    keyMoments: [{ label: "bottom", timestampMs: 1200, confidence: 0.72, reason: "Minimum elbow angle." }],
    metricHighlights: [{ metric: "elbowRange", value: 72, unit: "degrees", observation: "Usable range marker." }],
    limitations: ["Single-angle estimate."],
  },
  progressSignals: {
    movement: "benchpress",
    repCount: 2,
    primaryFocus: "elbowRange",
    trendKey: 72,
    comparableMetrics: [{ name: "minElbowAngleDeg", value: 72, unit: "degrees" }],
    scoreComponents: [{ component: "range", score: 80 }],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hosted form check client", () => {
  it("posts video to the hosted analyze endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okResponse });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["video"], "clip.webm", { type: "video/webm" });

    const result = await analyzeVideoWithHostedEngine({
      file,
      movement: "benchpress-side-view",
      apiBase: "https://formcheck.example",
      apiKey: "test-key",
    });

    expect(result.movement).toBe("benchpress-side-view");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://formcheck.example/api/form-check/analyze");
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-FormCheck-Key"]).toBe("test-key");
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it("defaults to the same-origin proxy when no apiBase is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => okResponse });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["video"], "clip.webm", { type: "video/webm" });

    await analyzeVideoWithHostedEngine({ file, movement: "benchpress-side-view" });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/form-check/analyze");
    expect(opts.headers["X-FormCheck-Key"]).toBeUndefined();
  });

  it("rejects malformed hosted responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    const file = new File(["video"], "clip.webm", { type: "video/webm" });
    await expect(analyzeVideoWithHostedEngine({ file, movement: "squat-side-view" })).rejects.toThrow(/unexpected/i);
  });

  it("maps hosted result into the existing UI analysis shape without raw landmarks", () => {
    const mapped = mapHostedResultToAnalysis(okResponse, { protocol: { label: "Bench" } });
    expect(mapped.analyzer).toBe("hosted-formcheck-engine");
    expect(mapped.result.summary).toMatch(/Solid/);
    expect(mapped.segmentation.repCount).toBe(2);
    expect(mapped.privacy.videoStored).toBe(false);
    expect(JSON.stringify(mapped).toLowerCase()).not.toContain("landmarks");
  });

  // V1.2: Test mapping of new coaching-tier fields
  it("extracts and preserves V1.2 coaching fields (formScore, captureQuality, coaching)", () => {
    const mapped = mapHostedResultToAnalysis(okResponse, { protocol: { label: "Bench" } });
    expect(mapped.formScore?.score).toBe(82);
    expect(mapped.metricConfidence?.overall?.confidence).toBe(0.85);
    expect(mapped.captureQuality).toBeTruthy();
    expect(mapped.captureQuality.lighting).toBe("good");
    expect(mapped.captureQuality.framing).toBe("excellent");
    expect(mapped.coaching).toBeTruthy();
    expect(mapped.coaching.nextSetCue).toMatch(/elbow extension/i);
  });

  // V1.2: Test enriched rep notes mapping
  it("maps enrichedRepNotes into individual reps", () => {
    const mapped = mapHostedResultToAnalysis(okResponse, { protocol: { label: "Bench" } });
    expect(mapped.segmentation.reps.length).toBeGreaterThan(0);
    expect(mapped.segmentation.reps[0].repNote).toBeTruthy();
    expect(mapped.segmentation.reps[0].repNote).toMatch(/solid lockout/i);
  });

  it("extracts and preserves V1.3 evidence and progress signals", () => {
    const mapped = mapHostedResultToAnalysis(okResponse, { protocol: { label: "Bench" } });
    expect(mapped.evidence?.summary).toMatch(/bench evidence/i);
    expect(mapped.evidence?.keyMoments?.[0]?.label).toBe("bottom");
    expect(mapped.progressSignals?.primaryFocus).toBe("elbowRange");
    expect(mapped.progressSignals?.comparableMetrics?.[0]?.name).toBe("minElbowAngleDeg");
    expect(JSON.stringify(mapped)).not.toMatch(/base64|rawLandmarks|frameImageBase64|blob:https/i);
  });

  // V1.2: Test backward compatibility when new fields are missing
  it("preserves backward compatibility when V1.2 fields are absent", () => {
    const oldResponse = { ...okResponse };
    delete oldResponse.formScore;
    delete oldResponse.captureQuality;
    delete oldResponse.coaching;
    delete oldResponse.metricConfidence;
    delete oldResponse.enrichedRepNotes;
    delete oldResponse.evidence;
    delete oldResponse.progressSignals;
    
    const mapped = mapHostedResultToAnalysis(oldResponse, { protocol: { label: "Bench" } });
    expect(mapped.formScore).toBeNull();
    expect(mapped.captureQuality).toBeNull();
    expect(mapped.coaching).toBeNull();
    expect(mapped.metricConfidence).toBeNull();
    // Old reps should still work
    expect(mapped.segmentation.reps.length).toBeGreaterThan(0);
    expect(mapped.segmentation.reps[0].repNote).toBeNull();
  });
});
