// Hosted Form Check Engine client.
//
// This is the ONLY frontend module that uploads a video. The hosted API returns
// derived form-analysis results only — not raw video, not frames, and not raw
// landmarks. Privacy invariant: the browser may save derived summaries only via
// formCheckHistory's allow-list.

function resolveApiBase(apiBase) {
  if (typeof apiBase === "string" && apiBase.length > 0) return apiBase.replace(/\/$/, "");
  // Default to the same-origin Netlify proxy. The hosted engine URL and optional
  // upstream key are server-side env vars only; Vite must not inline them into
  // the browser bundle.
  return "";
}

function joinUrl(base, path) {
  return `${base}${path}`;
}

function isValidEngineResult(data) {
  return !!data && data.ok === true && typeof data.movement === "string" && data.summary && data.confidence;
}

export function mapHostedResultToAnalysis(data, { protocol, metadata, validation } = {}) {
  const confidence = {
    level: data.confidence?.level || "low",
    score: data.confidence?.score ?? null,
    reasons: Array.isArray(data.confidence?.reasons) ? data.confidence.reasons : [],
  };
  const reps = Array.isArray(data.reps) ? data.reps : [];
  const cues = Array.isArray(data.cues) ? data.cues : [];
  
  // V1.1: Merge validation warnings and retakeTips with backend results
  const retakeTips = Array.isArray(data.retakeTips) ? data.retakeTips : [];
  if (Array.isArray(validation?.retakeTips)) {
    retakeTips.push(...validation.retakeTips);
  }
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];

  // V1.2: Extract coaching-tier and quality fields (preserve backward compatibility).
  // Backend V1.2 returns structured objects; early frontend mocks used flat numbers.
  // Keep both useful shapes so UI and history remain resilient.
  const rawFormScore = data.formScore ?? null;
  const formScore = typeof rawFormScore === "number"
    ? { score: rawFormScore, label: null, reasons: [] }
    : rawFormScore && typeof rawFormScore === "object"
      ? {
          score: Number.isFinite(rawFormScore.score) ? rawFormScore.score : null,
          label: rawFormScore.label || null,
          reasons: Array.isArray(rawFormScore.reasons) ? rawFormScore.reasons : [],
        }
      : null;
  // V1.5: Analyzability gate (capture quality + retake coach). Derived only.
  const analyzability = data.analyzability && typeof data.analyzability === "object"
    ? {
        level: typeof data.analyzability.level === "string" ? data.analyzability.level : null,
        score: Number.isFinite(data.analyzability.score) ? data.analyzability.score : null,
        blockingIssues: Array.isArray(data.analyzability.blockingIssues) ? data.analyzability.blockingIssues.slice(0, 6) : [],
        improvements: Array.isArray(data.analyzability.improvements) ? data.analyzability.improvements.slice(0, 6) : [],
        shouldShowFullCoaching: data.analyzability.shouldShowFullCoaching !== false,
      }
    : null;
  // V1.7: Movement-accuracy proxies. Map only derived scalar fields per metric.
  const movementMetrics = data.movementMetrics && typeof data.movementMetrics === "object" && !Array.isArray(data.movementMetrics)
    ? Object.fromEntries(
        Object.entries(data.movementMetrics)
          .filter(([, v]) => v && typeof v === "object")
          .map(([k, v]) => [k, {
            score: Number.isFinite(v.score) ? v.score : null,
            label: typeof v.label === "string" ? v.label : null,
            spread: Number.isFinite(v.spread) ? v.spread : null,
            note: typeof v.note === "string" ? v.note : null,
          }]),
      )
    : null;
  const captureQuality = data.captureQuality && typeof data.captureQuality === "object" ? data.captureQuality : null;
  const coaching = data.coaching && typeof data.coaching === "object" ? data.coaching : null;
  const metricConfidence = data.metricConfidence && typeof data.metricConfidence === "object"
    ? data.metricConfidence
    : typeof data.metricConfidence === "number"
      ? { overall: { confidence: data.metricConfidence } }
      : null;
  
  // V1.2: Map enriched rep notes into reps. Prefer backend rep.coachNote, then legacy
  // enrichedRepNotes[] array, then any existing repNote.
  const enrichedReps = reps.map((rep, idx) => {
    const enrichedNotes = Array.isArray(data.enrichedRepNotes) ? data.enrichedRepNotes[idx] : null;
    return {
      ...rep,
      repNote: rep.coachNote || enrichedNotes || rep.repNote || null,
    };
  });

  return {
    status: data.status || "analyzed",
    movement: data.movement,
    protocol,
    metadata: metadata || null,
    validation: validation || { valid: true, code: "ok" },
    analyzer: "hosted-formcheck-engine",
    stats: {
      framesAnalyzed: data.video?.framesAnalyzed ?? data.confidence?.framesAnalyzed ?? null,
      framesWithPose: data.confidence?.framesWithPose ?? data.confidence?.framesWithLandmarks ?? null,
      avgVisibility: data.confidence?.avgVisibility ?? null,
      processing: data.video?.processing || null,
    },
    metrics: data.metrics || {},
    confidence,
    result: {
      movement: data.movement,
      assessable: confidence.level !== "low",
      confidence,
      summary: data.summary?.overall || "Form check complete.",
      cues,
      disclaimer: data.disclaimer || "Computer-vision form checks are educational estimates only.",
    },
    segmentation: {
      reps: enrichedReps,
      repCount: Number.isFinite(data.summary?.repCount) ? data.summary.repCount : enrichedReps.length,
      timelineSummary: data.summary?.overall || null,
      confident: confidence.level !== "low",
      reason: confidence.level === "low" ? confidence.reasons.join(" ") : null,
    },
    barPath: data.barPath || null,
    privacy: data.privacy || { videoStored: false, retention: "deleted_after_processing" },
    engine: data.model || null,
    retakeTips,
    warnings,
    // V1.2/V1.3: Add coaching-tier and derived evidence fields
    formScore,
    analyzability,
    movementMetrics,
    captureQuality,
    coaching,
    metricConfidence,
    evidence: data.evidence && typeof data.evidence === "object" ? data.evidence : null,
    progressSignals: data.progressSignals && typeof data.progressSignals === "object" ? data.progressSignals : null,
  };
}

export async function analyzeVideoWithHostedEngine({ file, movement, apiBase, signal, apiKey } = {}) {
  if (!file) throw new Error("A video file is required.");
  if (typeof fetch !== "function" || typeof FormData === "undefined") {
    throw new Error("This environment can't upload video for form analysis.");
  }
  const form = new FormData();
  form.append("movement", movement || "");
  form.append("video", file, file.name || "form-check-clip.webm");

  const headers = {};
  if (apiKey) headers["X-FormCheck-Key"] = apiKey;

  // V13.5 — the same-origin Netlify proxy now requires the caller's Supabase
  // JWT (it attaches the paid engine key server-side and was previously open
  // to anonymous traffic). Attach the session token ONLY when talking to the
  // proxy (base === ""); an explicit apiBase points at a different origin and
  // must never receive the Supabase JWT.
  const base = resolveApiBase(apiBase);
  if (base === "") {
    try {
      const { supabase } = await import("../supabaseClient");
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // No session available — the proxy will answer 401 with a clear message.
    }
  }

  let res;
  try {
    res = await fetch(joinUrl(base, "/api/form-check/analyze"), {
      method: "POST",
      body: form,
      headers,
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new Error("Couldn't reach the hosted form check engine.", { cause: err });
  }

  if (!res.ok) {
    let message = `Form check engine returned ${res.status}.`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (body?.detail) message = body.detail;
    } catch {
      /* keep status message */
    }
    throw new Error(message);
  }

  const data = await res.json();
  if (!isValidEngineResult(data)) {
    throw new Error("The form check engine returned an unexpected response.");
  }
  return data;
}
