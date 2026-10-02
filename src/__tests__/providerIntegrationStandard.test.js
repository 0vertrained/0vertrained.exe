import { describe, expect, test } from "vitest";
import {
  PROVIDERS,
  getAiPolicyForProvider,
  isAiEligibleProvider,
  shouldExcludeProviderFromCoach,
  providerCapabilities,
} from "../integrations/providerRegistry";
import {
  encryptSecret,
  decryptSecret,
  buildConnectedAccountRecord,
  getAiPolicyForProvider as getServerAiPolicyForProvider,
} from "../../netlify/functions/_provider-standard.js";

describe("provider integration standard", () => {
  test("marks Strava as activity-only and excluded from AI Coach by default", () => {
    expect(providerCapabilities[PROVIDERS.STRAVA].role).toBe("activity");
    expect(isAiEligibleProvider(PROVIDERS.STRAVA)).toBe(false);
    expect(shouldExcludeProviderFromCoach(PROVIDERS.STRAVA)).toBe(true);
    expect(getAiPolicyForProvider(PROVIDERS.STRAVA)).toMatchObject({
      aiEligible: false,
      aiExclusionReason: "strava_api_terms",
    });
  });

  test("keeps Google Health/Fitbit as an AI-eligible recovery source when opted in", () => {
    expect(providerCapabilities[PROVIDERS.GOOGLE_HEALTH].supportsWebhooks).toBe(true);
    expect(getAiPolicyForProvider(PROVIDERS.GOOGLE_HEALTH, { userOptedIn: true })).toMatchObject({
      aiEligible: true,
      aiExclusionReason: null,
    });
    expect(getAiPolicyForProvider(PROVIDERS.GOOGLE_HEALTH, { userOptedIn: false })).toMatchObject({
      aiEligible: false,
      aiExclusionReason: "user_opt_out",
    });
  });

  test("encrypts provider tokens for connected_accounts mirror rows", () => {
    const env = { TOKEN_ENCRYPTION_KEY: "unit-test-token-encryption-key" };
    const encrypted = encryptSecret("refresh-token", env);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("refresh-token");
    expect(decryptSecret(encrypted, env)).toBe("refresh-token");

    const row = buildConnectedAccountRecord({
      userId: "user-1",
      provider: PROVIDERS.WHOOP,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2999-01-01T00:00:00.000Z",
      scopes: ["read:recovery", "offline"],
      env,
    });

    expect(row).toMatchObject({
      user_id: "user-1",
      provider: PROVIDERS.WHOOP,
      scopes_granted: ["read:recovery", "offline"],
      ai_eligible: true,
      ai_exclusion_reason: null,
    });
    expect(row.access_token_ciphertext).not.toContain("access-token");
    expect(row.refresh_token_ciphertext).not.toContain("refresh-token");
  });

  test("server and client policy agree on Strava AI exclusion", () => {
    expect(getServerAiPolicyForProvider(PROVIDERS.STRAVA)).toMatchObject(
      getAiPolicyForProvider(PROVIDERS.STRAVA)
    );
  });
});
