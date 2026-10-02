// @vitest-environment jsdom
// V14.1 · Signup-orphan self-heal. If auth.signUp succeeded but the profiles
// insert failed, the user holds a session with no profile row. On boot,
// ensureProfileExists finishes setup by inserting a profile whose username is
// derived from the synthetic auth email local part. These tests drive the
// function through an injected fake client — no module mocking needed.
import { describe, expect, it } from "vitest";
import { ensureProfileExists } from "../auth";

function fakeClient({ user, profileRows = [], insertError = null } = {}) {
  const inserted = [];
  return {
    inserted,
    auth: { getUser: async () => ({ data: { user } }) },
    from(table) {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ limit: async () => ({ data: profileRows, error: null }) }) }),
        insert: async (row) => {
          inserted.push(row);
          return { error: insertError };
        },
      };
    },
  };
}

describe("ensureProfileExists (signup orphan self-heal)", () => {
  it("does nothing without a session", async () => {
    const client = fakeClient({ user: null });
    const res = await ensureProfileExists(client);
    expect(res).toEqual({ ok: true, existed: true });
    expect(client.inserted).toHaveLength(0);
  });

  it("does nothing when the profile already exists", async () => {
    const client = fakeClient({
      user: { id: "u1", email: "rami@athlete.app" },
      profileRows: [{ id: "u1" }],
    });
    const res = await ensureProfileExists(client);
    expect(res).toEqual({ ok: true, existed: true });
    expect(client.inserted).toHaveLength(0);
  });

  it("inserts a profile with the username derived from the auth email", async () => {
    const client = fakeClient({ user: { id: "u1", email: "rami.h_92@athlete.app" } });
    const res = await ensureProfileExists(client);
    expect(res.ok).toBe(true);
    expect(res.existed).toBe(false);
    expect(res.needsRecoveryPhrase).toBe(true);
    expect(client.inserted).toEqual([{ id: "u1", username: "rami.h_92" }]);
  });

  it("maps the v29 cap trigger to reason 'cap' and inserts nothing extra", async () => {
    const client = fakeClient({
      user: { id: "u1", email: "rami@athlete.app" },
      insertError: { message: "SIGNUP_CAP_REACHED: this app is at its user limit" },
    });
    const res = await ensureProfileExists(client);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("cap");
  });

  it("reports other insert failures without throwing", async () => {
    const client = fakeClient({
      user: { id: "u1", email: "rami@athlete.app" },
      insertError: { message: "network unreachable" },
    });
    const res = await ensureProfileExists(client);
    expect(res).toEqual({ ok: false, reason: "insert_failed" });
  });

  it("fails open when the profile lookup errors (never blocks boot)", async () => {
    const client = {
      inserted: [],
      auth: { getUser: async () => ({ data: { user: { id: "u1", email: "rami@athlete.app" } } }) },
      from: () => ({
        select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }),
        insert: async () => { throw new Error("must not insert on lookup failure"); },
      }),
    };
    const res = await ensureProfileExists(client);
    expect(res).toEqual({ ok: true, existed: true });
  });
});
