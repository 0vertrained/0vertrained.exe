import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const netlifyConfig = readFileSync("netlify.toml", "utf8");

const expectedPublicCoachConfigKeys = [
  "COACH_ROUTING_MODE",
  "COACH_FAST_MODEL",
  "COACH_MAIN_MODEL",
  "COACH_DEEP_MODEL",
  "COACH_FALLBACK_MODEL",
];

describe("v19.0.1 Netlify secret scanner configuration", () => {
  it("safelists public coach routing configuration keys", () => {
    for (const key of expectedPublicCoachConfigKeys) {
      expect(netlifyConfig).toContain(key);
    }
  });

  it("keeps actual credential keys out of the safelist", () => {
    const omitLine = netlifyConfig
      .split("\n")
      .find((line) => line.includes("SECRETS_SCAN_OMIT_KEYS"));

    expect(omitLine).toBeTruthy();
    expect(omitLine).not.toContain("OLLAMA_API_KEY");
    expect(omitLine).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(omitLine).not.toContain("OURA_CLIENT_SECRET");
    expect(omitLine).not.toContain("WHOOP_CLIENT_SECRET");
  });
});
