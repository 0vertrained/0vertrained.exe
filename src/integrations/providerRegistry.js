// src/integrations/providerRegistry.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared wearable/provider policy registry.
//
// This file is intentionally pure and browser-safe. It gives UI, source
// resolution, and Coach context code one place to answer provider questions:
//   • what a provider is best at
//   • whether its data is allowed into AI Coach context by default
//   • which normalized tables it should map into
//
// Server-side OAuth/token helpers live in netlify/functions/_provider-standard.js.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDERS = Object.freeze({
  OURA: "oura",
  WHOOP: "whoop",
  GOOGLE_HEALTH: "google_health",
  STRAVA: "strava",
  MANUAL: "manual",
  MIXED: "mixed",
});

export const AI_EXCLUSION_REASONS = Object.freeze({
  USER_OPT_OUT: "user_opt_out",
  STRAVA_API_TERMS: "strava_api_terms",
  SENSITIVE_SCOPE: "sensitive_scope",
  UNKNOWN_PROVIDER_POLICY: "unknown_provider_policy",
});

export const providerCapabilities = Object.freeze({
  [PROVIDERS.OURA]: Object.freeze({
    label: "Oura",
    role: "recovery",
    normalizedTables: ["health_daily_summaries"],
    supportsOAuth: true,
    supportsBackfill: true,
    supportsWebhooks: false,
    aiEligibleDefault: true,
    aiExclusionReason: null,
    metrics: Object.freeze({
      sleep: "primary",
      hrv: "primary",
      resting_hr: "primary",
      temperature: "primary",
      readiness: "primary",
      activity: "secondary",
      workouts: "none",
    }),
  }),
  [PROVIDERS.WHOOP]: Object.freeze({
    label: "Whoop",
    role: "recovery_and_load",
    normalizedTables: ["health_daily_summaries", "activities"],
    supportsOAuth: true,
    supportsBackfill: true,
    supportsWebhooks: false,
    aiEligibleDefault: true,
    aiExclusionReason: null,
    metrics: Object.freeze({
      sleep: "primary",
      hrv: "primary",
      resting_hr: "primary",
      respiratory_rate: "primary",
      strain: "primary",
      workouts: "secondary",
    }),
  }),
  [PROVIDERS.GOOGLE_HEALTH]: Object.freeze({
    label: "Fitbit by Google / Google Health",
    role: "recovery_and_activity",
    normalizedTables: ["health_daily_summaries", "activities"],
    supportsOAuth: true,
    supportsBackfill: true,
    supportsWebhooks: true,
    aiEligibleDefault: true,
    aiExclusionReason: null,
    metrics: Object.freeze({
      sleep: "primary",
      hrv: "primary",
      resting_hr: "primary",
      respiratory_rate: "primary",
      spo2: "primary",
      steps: "primary",
      active_minutes: "primary",
      workouts: "secondary",
    }),
  }),
  [PROVIDERS.STRAVA]: Object.freeze({
    label: "Strava",
    role: "activity",
    normalizedTables: ["activities", "activity_streams"],
    supportsOAuth: true,
    supportsBackfill: true,
    supportsWebhooks: true,
    aiEligibleDefault: false,
    aiExclusionReason: AI_EXCLUSION_REASONS.STRAVA_API_TERMS,
    metrics: Object.freeze({
      workouts: "primary",
      distance: "primary",
      pace: "primary",
      elevation: "primary",
      streams: "optional_lazy",
      sleep: "none",
      recovery: "none",
    }),
  }),
  [PROVIDERS.MANUAL]: Object.freeze({
    label: "Manual",
    role: "user_entered_truth",
    normalizedTables: ["activities", "health_daily_summaries"],
    supportsOAuth: false,
    supportsBackfill: false,
    supportsWebhooks: false,
    aiEligibleDefault: true,
    aiExclusionReason: null,
    metrics: Object.freeze({
      workout_notes: "primary",
      perceived_effort: "primary",
      weight: "primary",
      nutrition: "primary",
    }),
  }),
  [PROVIDERS.MIXED]: Object.freeze({
    label: "Mixed sources",
    role: "derived",
    normalizedTables: [],
    supportsOAuth: false,
    supportsBackfill: false,
    supportsWebhooks: false,
    aiEligibleDefault: true,
    aiExclusionReason: null,
    metrics: Object.freeze({}),
  }),
});

export function getProviderCapability(provider) {
  return providerCapabilities[provider] || null;
}

export function getProviderLabel(provider) {
  return getProviderCapability(provider)?.label || String(provider || "Unknown provider");
}

export function isProviderKnown(provider) {
  return Boolean(getProviderCapability(provider));
}

export function getAiPolicyForProvider(provider, { userOptedIn = true } = {}) {
  const capability = getProviderCapability(provider);
  if (!capability) {
    return {
      aiEligible: false,
      aiExclusionReason: AI_EXCLUSION_REASONS.UNKNOWN_PROVIDER_POLICY,
    };
  }
  if (!userOptedIn) {
    return {
      aiEligible: false,
      aiExclusionReason: AI_EXCLUSION_REASONS.USER_OPT_OUT,
    };
  }
  return {
    aiEligible: Boolean(capability.aiEligibleDefault),
    aiExclusionReason: capability.aiEligibleDefault ? null : capability.aiExclusionReason,
  };
}

export function isAiEligibleProvider(provider, options = {}) {
  return getAiPolicyForProvider(provider, options).aiEligible;
}

export function shouldExcludeProviderFromCoach(provider, options = {}) {
  return !isAiEligibleProvider(provider, options);
}

export function normalizeProviderName(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "fitbit" || value === "google_fitbit" || value === "fitbit_google") return PROVIDERS.GOOGLE_HEALTH;
  if (value === "manual_entry") return PROVIDERS.MANUAL;
  return value;
}

export default {
  PROVIDERS,
  AI_EXCLUSION_REASONS,
  providerCapabilities,
  getProviderCapability,
  getProviderLabel,
  getAiPolicyForProvider,
  isAiEligibleProvider,
  shouldExcludeProviderFromCoach,
  normalizeProviderName,
};
