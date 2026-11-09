// src/__tests__/oauthReturn.test.js
// Every provider callback's return URL (netlify/functions/*-auth.js)
// becomes one status line on Settings → Integrations, and the address is
// cleaned so a reload never replays it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readOAuthReturn, cleanOAuthReturnUrl } from "../oauthReturn";

const loc = (url) => {
  const u = new URL(url, "https://0vertrained.netlify.app");
  return { pathname: u.pathname, search: u.search, hash: u.hash };
};

describe("reading the return", () => {
  it.each([
    ["/settings?oura_connected=true", "oura", /^Oura connected\./],
    ["/?whoop=connected#/settings", "whoop", /^Whoop connected\./],
    ["/?strava=connected#/settings", "strava", /^Strava connected\. Tap Sync now/],
    ["/?google_health=connected#/settings", "google_health", /^Google Health connected\./],
  ])("%s → connected", (url, provider, text) => {
    const r = readOAuthReturn(loc(url));
    expect(r.section).toBe("integrations");
    expect(r.notice).toMatchObject({ provider, status: "connected", tone: "ok" });
    expect(r.notice.text).toMatch(text);
  });

  it("puts the callbacks' error codes into words", () => {
    expect(readOAuthReturn(loc("/settings?oura_error=access_denied")).notice).toMatchObject({
      provider: "oura", status: "error", tone: "error", text: "Oura didn't connect: access wasn't granted. You can try again below.",
    });
    expect(readOAuthReturn(loc("/settings?oura_error=token_exchange_failed_401")).notice.text).toMatch(/sign-in couldn't be completed/);
    expect(readOAuthReturn(loc("/?whoop_error=token_storage_unconfigured#/settings")).notice.text).toMatch(/server isn't set up to store connections/);
    expect(readOAuthReturn(loc("/?strava_error=token_store_failed#/settings")).notice.text).toMatch(/^Strava didn't connect: the connection couldn't be saved/);
  });

  it("reads Strava's and Google's pass-through exchange errors as a sign-in that didn't complete", () => {
    // strava-auth.js / google-health-auth.js forward the provider's own message or strava_token_<status>.
    for (const raw of ["Bad Request", "strava_token_401", "invalid_grant", "Unauthorized"]) {
      expect(readOAuthReturn(loc(`/?strava_error=${encodeURIComponent(raw)}#/settings`)).notice.text)
        .toBe("Strava didn't connect: the sign-in couldn't be completed. You can try again below.");
    }
    expect(readOAuthReturn(loc("/?google_health_error=server_error#/settings")).notice.text).toMatch(/temporary problem/);
  });

  it("shows an unknown code only as a short code, so a crafted link can't write the sentence", () => {
    const r = readOAuthReturn(loc(`/settings?oura_error=${encodeURIComponent("Call 555-0100 to verify your account!")}`));
    expect(r.notice.text).toBe("Oura didn't connect (call5550100toverifyyouraccount). You can try again below.");
  });

  it("an old /settings link opens Integrations with no status line", () => {
    expect(readOAuthReturn(loc("/settings"))).toEqual({ section: "integrations", notice: null });
    expect(readOAuthReturn(loc("/#/settings"))).toEqual({ section: "integrations", notice: null });
  });

  it("an ordinary launch is not a return", () => {
    expect(readOAuthReturn(loc("/"))).toBeNull();
    expect(readOAuthReturn(loc("/#/demo"))).toBeNull();
    expect(readOAuthReturn(loc("/?utm_source=x"))).toBeNull();
    expect(readOAuthReturn(undefined)).toBeNull();
  });
});

describe("cleaning the address", () => {
  it("drops the markers and keeps everything else", () => {
    expect(cleanOAuthReturnUrl(loc("/settings?oura_connected=true"))).toBe("/");
    expect(cleanOAuthReturnUrl(loc("/?whoop=connected#/settings"))).toBe("/");
    expect(cleanOAuthReturnUrl(loc("/?strava_error=x&ref=mail#/settings"))).toBe("/?ref=mail");
    expect(cleanOAuthReturnUrl(loc("/?google_health=connected#/demo"))).toBe("/#/demo");
  });
});

describe("in step with the callbacks", () => {
  // If a callback's redirect changes, this fails before users see a silent return.
  const fn = (name) => readFileSync(resolve(process.cwd(), "netlify/functions", name), "utf8");
  it.each([
    ["oura-auth.js", "/settings?oura_connected=true"],
    ["oura-auth.js", "/settings?oura_error="],
    ["whoop-auth.js", "/?whoop=connected#/settings"],
    ["whoop-auth.js", "/?whoop_error="],
    ["strava-auth.js", "/?strava=connected#/settings"],
    ["strava-auth.js", "/?strava_error="],
    ["google-health-auth.js", "/?google_health=connected#/settings"],
    ["google-health-auth.js", "/?google_health_error="],
  ])("%s redirects to %s…", (file, marker) => {
    expect(fn(file)).toContain(marker);
  });
});
