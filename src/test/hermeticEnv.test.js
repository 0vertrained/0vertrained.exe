// CI sets placeholder values for the app's variables (as a configured Netlify
// site does); none of them may reach a test.
import { describe, expect, it } from "vitest";

const APP_VARS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_DEMO_MODE", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "COACH_ALLOWED_USER_ID", "OLLAMA_API_KEY", "STRAVA_WEBHOOK_SUBSCRIPTION_ID", "TOKEN_ENCRYPTION_KEY"];

describe("hermetic test environment", () => {
  it("clears every app variable from process.env and import.meta.env", () => {
    for (const name of APP_VARS) {
      expect(process.env[name], name).toBeUndefined();
      expect(import.meta.env[name], name).toBeUndefined();
    }
  });

  it("keeps the runtime's own variables", () => {
    expect(process.env.PATH).toBeTruthy();
    expect(import.meta.env.MODE).toBe("test");
  });
});
