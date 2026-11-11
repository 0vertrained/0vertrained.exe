// src/__tests__/authHumanCheck.test.js
// Sign-in and sign-up hand the human check's token to Supabase, which checks
// it with Cloudflare before it looks at the password (auth.js). Without a
// token the requests are exactly what they were, and a refusal over the token
// is said as that, never as a wrong password.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ signUp: null, signIn: null, inserted: [] }));

vi.mock("../supabaseClient", () => ({
  usernameToInternalId: (username) => `${username}@athlete.app`,
  supabase: {
    auth: {
      signUp: (request) => h.signUp(request),
      signInWithPassword: (request) => h.signIn(request),
    },
    // app_state says there is room, and the profile insert succeeds.
    from: (table) => (table === "app_state"
      ? { select: () => ({ eq: () => ({ single: async () => ({ data: { max_users: 5 }, error: null }) }) }) }
      : { insert: async (row) => { h.inserted.push(row); return { error: null }; } }),
    rpc: async () => ({ data: 1, error: null }),
  },
}));
vi.mock("../recoveryKdf", () => ({ deriveRecoveryHash: async () => ({ hash: "hash", salt: "salt", kdf: "pbkdf2-v1" }) }));

const USER = { id: "user-1" };
const ACCOUNT = { username: "Riley", password: "correct-horse-9" };
// What Supabase answers, with CAPTCHA protection on, to a token Cloudflare did not accept.
const CAPTCHA_FAILED = { code: "captcha_failed", status: 400, message: "captcha protection: request disallowed (invalid-input-response)" };
const REFUSED = /^The human check didn't go through\./;

let auth;
beforeEach(async () => {
  vi.resetModules();  // the sign-in limiter counts attempts in the module
  h.signUp = vi.fn(async () => ({ data: { user: USER }, error: null }));
  h.signIn = vi.fn(async () => ({ data: { user: USER }, error: null }));
  h.inserted = [];
  auth = await import("../auth");
});

describe("signing in", () => {
  it("sends the token with the password", async () => {
    expect(await auth.logIn({ ...ACCOUNT, captchaToken: "token-1" })).toEqual({ user: USER });
    expect(h.signIn).toHaveBeenCalledWith({ email: "riley@athlete.app", password: ACCOUNT.password, options: { captchaToken: "token-1" } });
  });

  it("sends what it always has where the check is off", async () => {
    await auth.logIn(ACCOUNT);
    expect(h.signIn).toHaveBeenCalledWith({ email: "riley@athlete.app", password: ACCOUNT.password });
  });

  it("says the human check was refused, not the password", async () => {
    h.signIn.mockResolvedValue({ data: null, error: CAPTCHA_FAILED });
    expect((await auth.logIn(ACCOUNT)).error).toMatch(REFUSED);
  });

  it("knows the refusal by its message too, whatever code comes with it", async () => {
    h.signIn.mockResolvedValue({ data: null, error: { code: "unexpected_failure", status: 500, message: "captcha verification process failed" } });
    expect((await auth.logIn(ACCOUNT)).error).toMatch(REFUSED);
  });

  it("does not count a refused check toward the wrong-password lock", async () => {
    h.signIn.mockResolvedValue({ data: null, error: CAPTCHA_FAILED });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await auth.logIn(ACCOUNT)).error).toMatch(REFUSED);
    }
    expect(h.signIn).toHaveBeenCalledTimes(8);
  });

  it("still says a wrong password is a wrong password, and still locks after too many", async () => {
    h.signIn.mockResolvedValue({ data: null, error: { code: "invalid_credentials", message: "Invalid login credentials" } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await auth.logIn({ ...ACCOUNT, captchaToken: "token" })).toEqual({ error: "Invalid username or password." });
    }
    expect((await auth.logIn({ ...ACCOUNT, captchaToken: "token" })).error).toMatch(/^Too many attempts\./);
    expect(h.signIn).toHaveBeenCalledTimes(5);
  });
});

describe("creating an account", () => {
  const NEW = { ...ACCOUNT, recoveryPhrase: "a phrase only I know" };

  it("sends the token with the new account", async () => {
    expect(await auth.signUp({ ...NEW, captchaToken: "token-1" })).toEqual({ user: USER });
    expect(h.signUp).toHaveBeenCalledWith({ email: "riley@athlete.app", password: NEW.password, options: { captchaToken: "token-1" } });
    expect(h.inserted).toHaveLength(1);
  });

  it("sends what it always has where the check is off", async () => {
    await auth.signUp(NEW);
    expect(h.signUp).toHaveBeenCalledWith({ email: "riley@athlete.app", password: NEW.password });
  });

  it("says the human check was refused, and makes no profile", async () => {
    h.signUp.mockResolvedValue({ data: null, error: CAPTCHA_FAILED });
    expect((await auth.signUp(NEW)).error).toMatch(REFUSED);
    expect(h.inserted).toHaveLength(0);
  });

  it("still says a taken username is taken", async () => {
    h.signUp.mockResolvedValue({ data: null, error: { code: "user_already_exists", message: "User already registered" } });
    expect((await auth.signUp(NEW)).error).toMatch(/^That username is taken\./);
  });
});
