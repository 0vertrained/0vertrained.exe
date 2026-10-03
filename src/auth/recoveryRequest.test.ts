import { describe, expect, it, vi } from "vitest";
import { AUTH_COPY } from "./authErrors";
import { requestPasswordReset } from "./recoveryRequest";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const input = { username: "alex", recoveryPhrase: "amber cliff river stone wheat moss", newPassword: "hunter2!!" };

describe("requestPasswordReset", () => {
  it("posts the JSON body to the endpoint and succeeds on { ok: true }", async () => {
    const fetchImpl = reply(200, { ok: true });
    await expect(requestPasswordReset(input, "/api/next/account-recovery", fetchImpl)).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/next/account-recovery");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("includes the captcha token when given", async () => {
    const fetchImpl = reply(200, { ok: true });
    await requestPasswordReset({ ...input, captchaToken: "tok" }, "/x", fetchImpl);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ captchaToken: "tok" });
  });

  it("reports the lockout with the wait the server gives", async () => {
    await expect(requestPasswordReset(input, "/x", reply(429, { error: "locked", retryAfterSeconds: 30 }))).resolves.toEqual({ ok: false, error: "Too many attempts. Wait 30 seconds and try again." });
    await expect(requestPasswordReset(input, "/x", reply(429, { error: "locked", retryAfterSeconds: 600 }))).resolves.toEqual({ ok: false, error: "Too many attempts. Wait 10 minutes and try again." });
    await expect(requestPasswordReset(input, "/x", reply(429, { error: "locked" }))).resolves.toEqual({ ok: false, error: "Too many attempts. Wait a minute and try again." });
  });

  it("shows the mismatch copy for a refused reset and the server copy for a 5xx", async () => {
    await expect(requestPasswordReset(input, "/x", reply(403, { error: "Username or phrase did not match" }))).resolves.toEqual({ ok: false, error: AUTH_COPY.phraseMismatch });
    await expect(requestPasswordReset(input, "/x", reply(200, { error: "unexpected" }))).resolves.toEqual({ ok: false, error: AUTH_COPY.phraseMismatch });
    await expect(requestPasswordReset(input, "/x", reply(503, { error: "down" }))).resolves.toEqual({ ok: false, error: AUTH_COPY.generic });
  });

  it("reports a connection failure when the request never completes", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(requestPasswordReset(input, "/x", fetchImpl)).resolves.toEqual({ ok: false, error: AUTH_COPY.offline });
  });
});
