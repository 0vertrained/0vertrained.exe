import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_RULE } from "./auth";
import { AUTH_COPY } from "./authErrors";
import { AuthProvider } from "./AuthProvider";
import { createFakeAuthClient, type FakeAuthClient } from "./fakeAuthClient";
import { deriveRecoveryHash } from "./recoveryKdf";
import { useAuth } from "./useAuth";

const EMAIL = "alex@users.0vertrained.app";
const PASSWORD = "hunter2!!";
const PHRASE = "amber cliff river stone wheat moss";

function setup(client?: FakeAuthClient, enabled?: boolean) {
  const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider client={client} enabled={enabled}>{children}</AuthProvider>;
  return renderHook(() => useAuth(), { wrapper });
}

async function ready(client: FakeAuthClient, status: "signed-in" | "signed-out" = "signed-out") {
  const hook = setup(client, true);
  await waitFor(() => expect(hook.result.current.status).toBe(status));
  return hook;
}

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("AuthProvider", () => {
  it("is unavailable without a backend and refuses every call", async () => {
    const { result } = setup();
    expect(result.current.status).toBe("unavailable");
    expect(result.current.client).toBeNull();
    await expect(result.current.signIn({ username: "alex", password: PASSWORD })).resolves.toEqual({ ok: false, error: AUTH_COPY.unavailable });
    await expect(result.current.isUsernameTaken("alex")).resolves.toBeNull();
    const off = setup(createFakeAuthClient(), false);
    expect(off.result.current.status).toBe("unavailable");
  });

  it("starts signed out with an empty client and exposes it", async () => {
    const client = createFakeAuthClient();
    const { result } = await ready(client);
    expect(result.current.user).toBeNull();
    expect(result.current.client).toBe(client);
  });

  it("restores a stored session and derives the username", async () => {
    const withMeta = createFakeAuthClient({ session: { user: { id: "u1", email: EMAIL, user_metadata: { username: "alex" } } } });
    const { result } = await ready(withMeta, "signed-in");
    expect(result.current.user).toEqual({ id: "u1", username: "alex" });
    const emailOnly = createFakeAuthClient({ session: { user: { id: "u2", email: "mia@users.0vertrained.app" } } });
    const second = await ready(emailOnly, "signed-in");
    expect(second.result.current.user).toEqual({ id: "u2", username: "mia" });
  });

  it("signs in with the synthesised email and reports a wrong password in plain copy", async () => {
    const client = createFakeAuthClient({ accounts: { alex: PASSWORD } });
    const { result } = await ready(client);
    let outcome = await act(() => result.current.signIn({ username: " Alex ", password: "nope1234!" }));
    expect(outcome).toEqual({ ok: false, error: AUTH_COPY.wrongCredentials });
    expect(result.current.status).toBe("signed-out");
    expect(result.current.error).toBe(AUTH_COPY.wrongCredentials);
    outcome = await act(() => result.current.signIn({ username: " Alex ", password: PASSWORD }));
    expect(outcome).toEqual({ ok: true });
    expect(client.calls.signIn[1]).toEqual({ email: EMAIL, password: PASSWORD });
    expect(result.current.status).toBe("signed-in");
    expect(result.current.user?.username).toBe("alex");
    expect(result.current.error).toBeUndefined();
  });

  it("asks for the missing field and maps a network failure", async () => {
    const { result } = await ready(createFakeAuthClient());
    await expect(result.current.signIn({ username: "", password: PASSWORD })).resolves.toEqual({ ok: false, error: AUTH_COPY.enterUsername });
    await expect(result.current.signIn({ username: "alex", password: "" })).resolves.toEqual({ ok: false, error: AUTH_COPY.enterPassword });
    const offline = await ready(createFakeAuthClient({ offline: true }));
    await expect(offline.result.current.signIn({ username: "alex", password: PASSWORD })).resolves.toEqual({ ok: false, error: AUTH_COPY.offline });
  });

  it("signs up: checks the username, calls signUp with the email and metadata, then stores the phrase hash", async () => {
    const client = createFakeAuthClient();
    const { result } = await ready(client);
    const outcome = await act(() => result.current.signUp({ username: " New.User ", password: PASSWORD, recoveryPhrase: "  Amber  Cliff river\nSTONE wheat moss " }));
    expect(outcome).toEqual({ ok: true });
    expect(client.calls.rpc[0]).toEqual({ fn: "username_taken", args: { p_username: "new.user" } });
    expect(client.calls.signUp).toEqual([{ email: "new.user@users.0vertrained.app", password: PASSWORD, options: { data: { username: "new.user" } } }]);
    const stored = client.calls.rpc[1];
    expect(stored?.fn).toBe("set_recovery_phrase");
    const args = stored?.args as { p_hash: string; p_salt: string; p_kdf: string };
    expect(args.p_kdf).toBe("pbkdf2-sha256-600k");
    expect(args.p_salt).toMatch(/^[0-9a-f]{32}$/);
    expect(args.p_hash).toBe((await deriveRecoveryHash(PHRASE, args.p_salt)).hash);
    expect(result.current.status).toBe("signed-in");
    expect(result.current.user?.username).toBe("new.user");
  });

  it("refuses a taken username before signUp, and maps the server's own taken message", async () => {
    const client = createFakeAuthClient({ accounts: { alex: PASSWORD } });
    const { result } = await ready(client);
    await expect(result.current.signUp({ username: "alex", password: PASSWORD, recoveryPhrase: PHRASE })).resolves.toEqual({ ok: false, error: AUTH_COPY.usernameTaken });
    expect(client.calls.signUp).toHaveLength(0);
    const racing = createFakeAuthClient();
    racing.auth.signUp = async () => ({ data: { user: null, session: null }, error: { message: "Database error: profiles_username_key", status: 500 } });
    const second = await ready(racing);
    await expect(second.result.current.signUp({ username: "mia", password: PASSWORD, recoveryPhrase: PHRASE })).resolves.toEqual({ ok: false, error: AUTH_COPY.usernameTaken });
  });

  it("validates locally before any request and forwards the captcha token", async () => {
    const client = createFakeAuthClient();
    const { result } = await ready(client);
    await expect(result.current.signUp({ username: "ab", password: PASSWORD, recoveryPhrase: PHRASE })).resolves.toEqual({ ok: false, error: "Use at least 3 characters." });
    await expect(result.current.signUp({ username: "mia", password: "letters", recoveryPhrase: PHRASE })).resolves.toEqual({ ok: false, error: PASSWORD_RULE });
    await expect(result.current.signUp({ username: "mia", password: PASSWORD, recoveryPhrase: "short" })).resolves.toEqual({ ok: false, error: AUTH_COPY.phraseTooShort });
    expect(client.calls.rpc).toHaveLength(0);
    await act(() => result.current.signUp({ username: "mia", password: PASSWORD, recoveryPhrase: PHRASE, captchaToken: "tok" }));
    expect(client.calls.signUp[0]?.options).toEqual({ data: { username: "mia" }, captchaToken: "tok" });
  });

  it("resets with the recovery phrase by posting to the endpoint, then signs in", async () => {
    const client = createFakeAuthClient({ accounts: { alex: "old-pass-1" } });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { newPassword: string };
      client.accounts.set("alex", { password: body.newPassword });
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await ready(client);
    const outcome = await act(() => result.current.resetWithRecovery({ username: "Alex", recoveryPhrase: " Amber cliff  river stone wheat moss", newPassword: PASSWORD }));
    expect(outcome).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/next/account-recovery");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ username: "alex", recoveryPhrase: PHRASE, newPassword: PASSWORD });
    expect(client.calls.signIn).toEqual([{ email: EMAIL, password: PASSWORD }]);
    expect(result.current.status).toBe("signed-in");
  });

  it("reports a refused or locked reset without signing in", async () => {
    const client = createFakeAuthClient({ accounts: { alex: PASSWORD } });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(403, { error: "no match" })));
    const { result } = await ready(client);
    await expect(result.current.resetWithRecovery({ username: "alex", recoveryPhrase: PHRASE, newPassword: PASSWORD })).resolves.toEqual({ ok: false, error: AUTH_COPY.phraseMismatch });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: "locked", retryAfterSeconds: 45 })));
    await expect(result.current.resetWithRecovery({ username: "alex", recoveryPhrase: PHRASE, newPassword: PASSWORD })).resolves.toEqual({ ok: false, error: "Too many attempts. Wait 45 seconds and try again." });
    await expect(result.current.resetWithRecovery({ username: "alex", recoveryPhrase: PHRASE, newPassword: "weak" })).resolves.toEqual({ ok: false, error: PASSWORD_RULE });
    expect(client.calls.signIn).toHaveLength(0);
  });

  it("signs out and follows the client's session events", async () => {
    const client = createFakeAuthClient({ session: { user: { id: "u1", email: EMAIL, user_metadata: { username: "alex" } } } });
    const { result } = await ready(client, "signed-in");
    await act(() => result.current.signOut());
    expect(client.calls.signOut).toBe(1);
    expect(result.current.status).toBe("signed-out");
    expect(result.current.user).toBeNull();
    act(() => client.emit("SIGNED_IN", { user: { id: "u1", email: EMAIL, user_metadata: { username: "alex" } } }));
    expect(result.current.status).toBe("signed-in");
    act(() => client.emit("SIGNED_OUT", null));
    expect(result.current.status).toBe("signed-out");
  });

  it("deletes the account through the RPC and signs out", async () => {
    const client = createFakeAuthClient({ accounts: { alex: PASSWORD }, session: { user: { id: "u1", email: EMAIL, user_metadata: { username: "alex" } } } });
    const { result } = await ready(client, "signed-in");
    await expect(act(() => result.current.deleteAccount())).resolves.toEqual({ ok: true });
    expect(client.calls.rpc).toEqual([{ fn: "delete_my_account", args: undefined }]);
    expect(client.accounts.has("alex")).toBe(false);
    expect(client.calls.signOut).toBe(1);
    expect(result.current.status).toBe("signed-out");
  });

  it("answers the live username check and sets a new recovery phrase", async () => {
    const client = createFakeAuthClient({ accounts: { alex: PASSWORD }, session: { user: { id: "u1", email: EMAIL, user_metadata: { username: "alex" } } } });
    const { result } = await ready(client, "signed-in");
    await expect(result.current.isUsernameTaken("Alex")).resolves.toBe(true);
    await expect(result.current.isUsernameTaken("free.name")).resolves.toBe(false);
    await expect(result.current.isUsernameTaken("x")).resolves.toBeNull();
    await expect(act(() => result.current.setRecoveryPhrase("Birch Candle Delta Falcon"))).resolves.toEqual({ ok: true });
    expect(client.accounts.get("alex")?.phrase?.kdf).toBe("pbkdf2-sha256-600k");
    await expect(result.current.setRecoveryPhrase("tiny")).resolves.toEqual({ ok: false, error: AUTH_COPY.phraseTooShort });
  });
});
