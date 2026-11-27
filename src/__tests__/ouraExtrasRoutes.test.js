// /api/oura/extras and /api/oura/tags: Oura's daytime stress, resilience,
// bedtime window and tags, read live for the caller and shaped for display.
// Ownership comes from the Bearer token, nothing is stored, and a
// connection made before the tag permission is told to reconnect.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import handler from "../../netlify/functions/oura-auth.js";
import { encryptSecret } from "../../netlify/functions/_provider-standard.js";
import { shapeBedtime, shapeMornings, shapeResilience, shapeStress, shapeTags, tagLabel } from "../../netlify/functions/_oura-extras.js";

const SUPA = "https://supabase.test";
const ENC_ENV = { TOKEN_ENCRYPTION_KEY: "extras-test-encryption-key" };
const OURA = "https://api.ouraring.com/v2/usercollection/";

function res(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function accountRow() {
  return {
    user_id: "user-abc",
    provider: "oura",
    access_token_ciphertext: encryptSecret("live-access", ENC_ENV),
    refresh_token_ciphertext: encryptSecret("live-refresh", ENC_ENV),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    scopes_granted: ["personal", "daily", "heartrate", "spo2"],
  };
}

function installFetch(oura) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    calls.push({ url: String(url), method });
    if (String(url).includes("/auth/v1/user")) return res({ id: "user-abc" });
    if (String(url).includes("/rest/v1/connected_accounts")) return res([accountRow()]);
    if (String(url).startsWith(OURA)) {
      const endpoint = String(url).slice(OURA.length).split("?")[0];
      const answer = oura[endpoint];
      if (typeof answer === "number") return res({ detail: "no" }, { ok: false, status: answer });
      return res({ data: answer || [], next_token: null });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }));
  return calls;
}

const request = (path) => new Request(`https://app.test${path}`, { headers: { authorization: "Bearer supa-jwt" } });

describe("shaping Oura's documents", () => {
  test("daily stress in minutes, oldest first", () => {
    expect(shapeStress([
      { day: "2026-11-25", day_summary: "stressful", stress_high: 7800, recovery_high: 2100 },
      { day: "2026-11-24", day_summary: null, stress_high: null, recovery_high: 600 },
    ])).toEqual([
      { day: "2026-11-24", summary: null, stressMinutes: null, recoveryMinutes: 10 },
      { day: "2026-11-25", summary: "stressful", stressMinutes: 130, recoveryMinutes: 35 },
    ]);
  });

  test("resilience levels and contributors", () => {
    expect(shapeResilience([{ day: "2026-11-25", level: "solid", contributors: { sleep_recovery: 71.4, daytime_recovery: 40, stress: 55 } }, { day: "2026-11-24", level: "huh" }]))
      .toEqual([{ day: "2026-11-25", level: "solid", sleepRecovery: 71, daytimeRecovery: 40, stress: 55 }]);
  });

  test("the latest bedtime window Oura found", () => {
    expect(shapeBedtime([
      { day: "2026-11-24", status: "optimal_found", optimal_bedtime: { day_tz: -25200, start_offset: -3600, end_offset: 0 } },
      { day: "2026-11-25", status: "optimal_found", recommendation: "earlier_bedtime", optimal_bedtime: { day_tz: -25200, start_offset: -2700, end_offset: 900 } },
      { day: "2026-11-26", status: "not_enough_nights", optimal_bedtime: null },
    ])).toEqual({ day: "2026-11-25", startMinutes: -45, endMinutes: 15, recommendation: "earlier_bedtime" });
    expect(shapeBedtime([{ day: "2026-11-26", status: "bad_sleep_quality", optimal_bedtime: null }])).toBeNull();
  });

  test("tags by name, once a day", () => {
    expect(tagLabel({ tag_type_code: "tag_generic_sauna" })).toBe("Sauna");
    expect(tagLabel({ tag_type_code: "tag_generic_late_meal" })).toBe("Late meal");
    expect(tagLabel({ tag_type_code: "custom", custom_name: "Cold plunge" })).toBe("Cold plunge");
    expect(tagLabel({ tag_type_code: null, comment: "text only" })).toBeNull();
    expect(shapeTags([
      { start_day: "2026-11-20", tag_type_code: "tag_generic_sauna" },
      { start_day: "2026-11-20", tag_type_code: "tag_generic_sauna" },
      { start_day: "2026-11-18", tag_type_code: "custom", custom_name: "Cold plunge" },
    ])).toEqual([{ day: "2026-11-18", label: "Cold plunge" }, { day: "2026-11-20", label: "Sauna" }]);
  });

  test("each morning from the night's long sleep, not a nap", () => {
    expect(shapeMornings(
      [{ day: "2026-11-21", score: 82 }],
      [
        { day: "2026-11-21", type: "late_nap", average_hrv: 90, lowest_heart_rate: 60 },
        { day: "2026-11-21", type: "long_sleep", average_hrv: 61.6, lowest_heart_rate: 47, total_sleep_duration: 26000 },
        { day: "2026-11-22", type: "sleep", average_hrv: 50, lowest_heart_rate: 52, total_sleep_duration: 3000 },
      ],
    )).toEqual([
      { day: "2026-11-21", readiness: 82, hrv: 62, restingHr: 47 },
      { day: "2026-11-22", readiness: null, hrv: 50, restingHr: 52 },
    ]);
  });
});

describe("the routes", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = SUPA;
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.OURA_CLIENT_ID = "client-id";
    process.env.OURA_CLIENT_SECRET = "client-secret";
    process.env.TOKEN_ENCRYPTION_KEY = ENC_ENV.TOKEN_ENCRYPTION_KEY;
  });
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("/api/oura/extras reads stress, resilience and bedtime with the caller's token, storing nothing", async () => {
    const calls = installFetch({
      daily_stress: [{ day: "2026-11-25", day_summary: "normal", stress_high: 3600, recovery_high: 5400 }],
      daily_resilience: [{ day: "2026-11-25", level: "adequate", contributors: { sleep_recovery: 60, daytime_recovery: 30, stress: 50 } }],
      sleep_time: 403,
    });
    const response = await handler(request("/api/oura/extras?days=7"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stress).toEqual([{ day: "2026-11-25", summary: "normal", stressMinutes: 60, recoveryMinutes: 90 }]);
    expect(body.resilience[0].level).toBe("adequate");
    expect(body.bedtime).toBeNull();
    expect(body.unavailable).toEqual(["bedtime"]);
    expect(calls.some((call) => call.method !== "GET")).toBe(false);
    expect(JSON.stringify(body)).not.toContain("live-access");
  });

  test("/api/oura/tags asks a connection without the tag permission to reconnect", async () => {
    installFetch({ enhanced_tag: 401 });
    const body = await (await handler(request("/api/oura/tags"))).json();
    expect(body).toEqual({ needsReconnect: true, tags: [], mornings: [] });
  });

  test("/api/oura/tags returns tags and mornings", async () => {
    installFetch({
      enhanced_tag: [{ start_day: "2026-11-20", tag_type_code: "tag_generic_sauna" }],
      daily_readiness: [{ day: "2026-11-21", score: 85 }],
      sleep: [{ day: "2026-11-21", type: "long_sleep", average_hrv: 64, lowest_heart_rate: 46, total_sleep_duration: 27000 }],
    });
    const body = await (await handler(request("/api/oura/tags?days=30"))).json();
    expect(body).toEqual({
      needsReconnect: false,
      days: 30,
      tags: [{ day: "2026-11-20", label: "Sauna" }],
      mornings: [{ day: "2026-11-21", readiness: 85, hrv: 64, restingHr: 46 }],
    });
  });

  test("refuses a caller without a session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({}, { ok: false, status: 401 })));
    const response = await handler(new Request("https://app.test/api/oura/extras"));
    expect(response.status).toBe(401);
  });

  test("new connections ask Oura for tags", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), method: (options.method || "GET").toUpperCase() });
      if (String(url).includes("/auth/v1/user")) return res({ id: "user-abc" });
      return res(null, { status: 201 });
    }));
    const response = await handler(new Request("https://app.test/api/oura/auth", { headers: { authorization: "Bearer supa-jwt", accept: "application/json" } }));
    const { url } = await response.json();
    expect(new URL(url).searchParams.get("scope")).toBe("personal daily heartrate spo2 tag");
  });
});
