// netlify/functions/_coach-model-router.js
// Deterministic task routing for Ollama Cloud coach models.
// Model selection is server-owned and environment-overridable. The browser
// cannot select an arbitrary model or bypass the fallback policy.

export const COACH_ROUTES = Object.freeze({
  FAST: "fast",
  MAIN: "main",
  DEEP: "deep",
});

const DEFAULT_MODELS = Object.freeze({
  fast: {
    alias: "fast",
    model: "gemma4:31b-cloud",
    maxOutputTokens: 700,
    timeoutMs: 14_000,
    think: false,
  },
  main: {
    alias: "main",
    model: "qwen3.5:397b-cloud",
    maxOutputTokens: 1_200,
    timeoutMs: 22_000,
    think: true,
  },
  deep: {
    alias: "deep",
    model: "deepseek-v4-flash:cloud",
    maxOutputTokens: 1_800,
    timeoutMs: 26_000,
    think: true,
  },
  fallback: {
    alias: "fallback",
    model: "gpt-oss:120b-cloud",
    maxOutputTokens: 1_200,
    timeoutMs: 22_000,
    think: "medium",
  },
});

const DEEP_PATTERNS = [
  /\b(8|10|12|16)\s*(week|weeks)\b/i,
  /\b(month|months|quarter|longitudinal|over time|history|historical)\b/i,
  /\b(intervention|outcome|effective|ineffective|compare blocks?|long[- ]term pattern)\b/i,
  /\b(weight|bodyweight|fat loss|waist)\b.*\b(plateau|stall|stalled)\b/i,
  /\b(analy[sz]e|investigate)\b.*\b(trend|progress|block|phase|months?|weeks?)\b/i,
  /\bwhy\b.*\b(weight|bodyweight|fat loss|waist)\b.*\b(not|isn'?t|aren'?t|stalled|plateau|declin)/i,
];

const FAST_PATTERNS = [
  /\b(how much|how many)\b.*\b(left|remaining|today)\b/i,
  /\b(next meal|what should i eat next|factor meal|protein left|calories left)\b/i,
  /\bwhat('?s| is) next\b/i,
  /\b(did i hit|am i at)\b.*\b(protein|calories|steps)\b/i,
  /\b(today'?s? target|today'?s? goal)\b/i,
];

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function safeModelName(value, fallback) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9._:/-]{2,120}$/.test(candidate) ? candidate : fallback;
}

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function resolveModelStack(env = process.env) {
  const legacyModel = safeModelName(env.COACH_MODEL, "");
  const explicitRoutes = Boolean(env.COACH_FAST_MODEL || env.COACH_MAIN_MODEL || env.COACH_DEEP_MODEL || env.COACH_FALLBACK_MODEL);
  const requestedMode = String(env.COACH_ROUTING_MODE || "").toLowerCase();
  const mode = requestedMode === "single" || (legacyModel && !explicitRoutes && requestedMode !== "routed") ? "single" : "routed";
  if (mode === "single") {
    const model = legacyModel || DEFAULT_MODELS.fallback.model;
    return {
      mode,
      fast: { ...DEFAULT_MODELS.fast, model, alias: "single" },
      main: { ...DEFAULT_MODELS.main, model, alias: "single" },
      deep: { ...DEFAULT_MODELS.deep, model, alias: "single" },
      fallback: { ...DEFAULT_MODELS.fallback, model, alias: "single" },
    };
  }
  return {
    mode,
    fast: {
      ...DEFAULT_MODELS.fast,
      model: safeModelName(env.COACH_FAST_MODEL, DEFAULT_MODELS.fast.model),
      timeoutMs: positiveInt(env.COACH_FAST_TIMEOUT_MS, DEFAULT_MODELS.fast.timeoutMs, 5_000, 30_000),
    },
    main: {
      ...DEFAULT_MODELS.main,
      model: safeModelName(env.COACH_MAIN_MODEL, DEFAULT_MODELS.main.model),
      timeoutMs: positiveInt(env.COACH_MAIN_TIMEOUT_MS, DEFAULT_MODELS.main.timeoutMs, 8_000, 35_000),
    },
    deep: {
      ...DEFAULT_MODELS.deep,
      model: safeModelName(env.COACH_DEEP_MODEL, DEFAULT_MODELS.deep.model),
      timeoutMs: positiveInt(env.COACH_DEEP_TIMEOUT_MS, DEFAULT_MODELS.deep.timeoutMs, 10_000, 45_000),
    },
    fallback: {
      ...DEFAULT_MODELS.fallback,
      model: safeModelName(env.COACH_FALLBACK_MODEL, DEFAULT_MODELS.fallback.model),
      timeoutMs: positiveInt(env.COACH_FALLBACK_TIMEOUT_MS, DEFAULT_MODELS.fallback.timeoutMs, 8_000, 35_000),
    },
  };
}

export function selectCoachRoute(question = "", evidencePacket = null) {
  const text = String(question || "").trim();
  if (hasAny(text, DEEP_PATTERNS)) {
    return { route: COACH_ROUTES.DEEP, reason: "longitudinal_or_multi-domain_analysis" };
  }
  if (hasAny(text, FAST_PATTERNS) && evidencePacket?.consequential !== true) {
    return { route: COACH_ROUTES.FAST, reason: "simple_retrieval_or_daily_action" };
  }
  const hint = evidencePacket?.routeHint;
  if (hint === COACH_ROUTES.DEEP) return { route: COACH_ROUTES.DEEP, reason: "evidence_packet_deep_hint" };
  if (hint === COACH_ROUTES.FAST && evidencePacket?.consequential !== true) return { route: COACH_ROUTES.FAST, reason: "evidence_packet_fast_hint" };
  return { route: COACH_ROUTES.MAIN, reason: "default_coaching_reasoning" };
}

export function detectImmediateSafetyQuestion(question = "") {
  const text = String(question || "").toLowerCase();
  const current = /\b(right now|currently|during (my|the) workout|i (have|feel|am feeling|just felt)|having)\b/.test(text);
  if (!current) return null;
  if (/\b(chest pain|chest pressure|chest discomfort|chest tight(?:ness)?|chest feels tight|fainting|fainted|passed out|severe shortness of breath)\b/.test(text)) {
    return { severity: "urgent", reason: "acute_cardiorespiratory_symptom" };
  }
  if (/\b(palpitations|heart racing|irregular heartbeat)\b/.test(text) && /\b(dizzy|lightheaded|faint|chest|shortness of breath)\b/.test(text)) {
    return { severity: "urgent", reason: "palpitations_with_concerning_symptom" };
  }
  return null;
}

export function buildSafetyReply(safety, evidencePacket = null) {
  const guardrail = (evidencePacket?.evidence || []).find((item) => item?.type === "clinician_guardrails")?.data || null;
  const lines = [
    "Stop the workout now and do not try to push through these symptoms.",
    guardrail?.stopRules || "Follow your clinician-approved stop plan.",
  ];
  if (guardrail?.emergencyInstructions) lines.push(guardrail.emergencyInstructions);
  else lines.push("For severe, worsening, or persistent symptoms—especially fainting, chest pressure, or significant breathing difficulty—call emergency services.");
  return {
    reply: lines.filter(Boolean).join(" "),
    route: "safety",
    reason: safety?.reason || "hard_safety_rule",
  };
}

export async function callOllamaModel({
  apiKey,
  modelSpec,
  system,
  userContent,
  ollamaUrl = "https://ollama.com/api/chat",
  fetchImpl = fetch,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), modelSpec.timeoutMs);
  const startedAt = Date.now();
  try {
    const body = {
      model: modelSpec.model,
      stream: false,
      options: { num_predict: modelSpec.maxOutputTokens },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    };
    if (modelSpec.think !== undefined) body.think = modelSpec.think;
    const response = await fetchImpl(ollamaUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error = new Error(`upstream_${response.status}`);
      error.status = response.status;
      error.safeDetail = detail.slice(0, 300);
      throw error;
    }
    const payload = await response.json();
    return {
      reply: payload?.message?.content?.trim() || "",
      latencyMs: Date.now() - startedAt,
      promptTokens: Number.isFinite(+payload?.prompt_eval_count) ? +payload.prompt_eval_count : null,
      outputTokens: Number.isFinite(+payload?.eval_count) ? +payload.eval_count : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runRoutedCoach({
  apiKey,
  question,
  evidencePacket,
  system,
  userContent,
  env = process.env,
  fetchImpl = fetch,
  ollamaUrl = "https://ollama.com/api/chat",
} = {}) {
  const stack = resolveModelStack(env);
  const selection = selectCoachRoute(question, evidencePacket);
  const primary = stack[selection.route] || stack.main;
  let result;
  let used = primary;
  let fallbackUsed = false;
  let primaryError = null;
  try {
    result = await callOllamaModel({ apiKey, modelSpec: primary, system, userContent, fetchImpl, ollamaUrl });
    if (!result.reply) throw new Error("empty_response");
  } catch (error) {
    primaryError = error;
    const sameModel = stack.fallback.model === primary.model;
    if (sameModel) throw error;
    fallbackUsed = true;
    used = stack.fallback;
    result = await callOllamaModel({ apiKey, modelSpec: stack.fallback, system, userContent, fetchImpl, ollamaUrl });
  }
  return {
    ...result,
    route: selection.route,
    routeReason: selection.reason,
    modelAlias: used.alias,
    model: used.model,
    fallbackUsed,
    primaryError,
    routingMode: stack.mode,
  };
}

export function extractEvidenceIds(reply = "", evidence = []) {
  const valid = new Set((evidence || []).map((item) => item?.id).filter(Boolean));
  const ids = [...String(reply).matchAll(/\[(E\d{1,2})\]/g)].map((match) => match[1]);
  return [...new Set(ids)].filter((id) => valid.has(id));
}

export function ensureGroundedFooter(reply = "", evidence = [], { required = false } = {}) {
  const ids = extractEvidenceIds(reply, evidence);
  if (ids.length || !required || !evidence?.length) {
    return { reply, ids, status: ids.length ? "model_cited" : "not_required" };
  }
  const preferred = evidence
    .filter((item) => ["hard_constraint", "authoritative", "primary"].includes(item?.importance))
    .slice(0, 3)
    .map((item) => item.id);
  const fallbackIds = preferred.length ? preferred : evidence.slice(0, 2).map((item) => item.id);
  const footer = fallbackIds.map((id) => `[${id}]`).join(" ");
  return {
    reply: `${reply.trim()}\n\nEvidence packet: ${footer}`,
    ids: fallbackIds,
    status: "server_assisted",
  };
}

export default {
  resolveModelStack,
  selectCoachRoute,
  detectImmediateSafetyQuestion,
  buildSafetyReply,
  callOllamaModel,
  runRoutedCoach,
  extractEvidenceIds,
  ensureGroundedFooter,
};
