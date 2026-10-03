// Owns the session. Without a backend the status is "unavailable" and
// supabase-js is never loaded. With one, the client loads only when a
// session was stored here before or when a method is first called, so a
// guest pays nothing for accounts. Every method validates first, maps the
// server's answer to plain copy and never logs a password or a phrase.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { backendConfig, hasBackend } from "../app/config";
import { isValidPhrase, normalizePhrase, sanitizeUsername, usernameToEmail, validatePassword, validateUsername } from "./auth";
import { AuthContext, type AuthContextValue, type AuthResult, type AuthStatus, type AuthUser, type ResetInput, type SignInInput, type SignUpInput } from "./authContext";
import { AUTH_COPY, describeAuthError, describeThrown } from "./authErrors";
import type { AuthClient, AuthSession, AuthSubscription, AuthUserRecord } from "./authTypes";
import { deriveRecoveryHash } from "./recoveryKdf";
import { requestPasswordReset } from "./recoveryRequest";
import { getAuthClient, hasStoredSession } from "./supabaseClient";

export interface AuthProviderProps {
  children: ReactNode;
  /** A ready client (tests); skips the dynamic import. */
  client?: AuthClient;
  /** Accounts on or off; defaults to whether the build has a backend. */
  enabled?: boolean;
}

/** The username from the metadata the sign-up stored, else the email's local part. */
export function userFromRecord(record: AuthUserRecord): AuthUser {
  const meta = record.user_metadata?.["username"];
  const fromEmail = (record.email ?? "").split("@")[0] ?? "";
  return { id: record.id, username: typeof meta === "string" && meta ? meta : fromEmail };
}

const ok = (): AuthResult => ({ ok: true });

export function AuthProvider({ children, client: injected, enabled = hasBackend() }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>(() => (!enabled ? "unavailable" : injected || hasStoredSession() ? "loading" : "signed-out"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [client, setClient] = useState<AuthClient | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const loading = useRef<Promise<AuthClient> | null>(null);
  const subscription = useRef<AuthSubscription | null>(null);

  const applySession = useCallback((session: AuthSession | null) => {
    setUser(session ? userFromRecord(session.user) : null);
    setStatus(session ? "signed-in" : "signed-out");
  }, []);

  /** Loads the client once and subscribes to its session events. */
  const ensureClient = useCallback((): Promise<AuthClient> => {
    if (!loading.current) {
      loading.current = (injected ? Promise.resolve(injected) : getAuthClient())
        .then((c) => {
          subscription.current = c.auth.onAuthStateChange((_event, session) => applySession(session)).data.subscription;
          setClient(c);
          return c;
        })
        .catch((err: unknown) => {
          loading.current = null;
          throw err;
        });
    }
    return loading.current;
  }, [injected, applySession]);

  useEffect(() => {
    if (!enabled || (!injected && !hasStoredSession())) return;
    let cancelled = false;
    ensureClient()
      .then(async (c) => {
        const { data } = await c.auth.getSession();
        if (!cancelled) applySession(data.session);
      })
      .catch(() => {
        if (!cancelled) setStatus("signed-out");
      });
    return () => {
      cancelled = true;
      subscription.current?.unsubscribe();
      subscription.current = null;
      loading.current = null;
    };
  }, [enabled, injected, ensureClient, applySession]);

  const value = useMemo<AuthContextValue>(() => {
    const domain = backendConfig.authEmailDomain;
    const fail = (message: string): AuthResult => {
      setError(message);
      return { ok: false, error: message };
    };
    const succeed = (): AuthResult => {
      setError(undefined);
      return ok();
    };
    const withClient = async (run: (c: AuthClient) => Promise<AuthResult>): Promise<AuthResult> => {
      if (!enabled) return fail(AUTH_COPY.unavailable);
      let c: AuthClient;
      try {
        c = await ensureClient();
      } catch {
        return fail(AUTH_COPY.offline);
      }
      try {
        return await run(c);
      } catch (err) {
        return fail(describeThrown(err));
      }
    };
    const signInWith = async (c: AuthClient, name: string, password: string): Promise<AuthResult> => {
      const { data, error: err } = await c.auth.signInWithPassword({ email: usernameToEmail(name, domain), password });
      if (err) return fail(describeAuthError(err, "sign-in"));
      applySession(data.session);
      return succeed();
    };
    const storePhrase = async (c: AuthClient, phrase: string): Promise<AuthResult> => {
      const derived = await deriveRecoveryHash(phrase);
      const { error: err } = await c.rpc("set_recovery_phrase", { p_hash: derived.hash, p_salt: derived.salt, p_kdf: derived.kdf });
      return err ? fail(AUTH_COPY.phraseNotSaved) : succeed();
    };

    const signIn = ({ username, password }: SignInInput) =>
      withClient(async (c) => {
        const name = sanitizeUsername(username);
        if (!name) return fail(AUTH_COPY.enterUsername);
        if (!password) return fail(AUTH_COPY.enterPassword);
        return signInWith(c, name, password);
      });

    const signUp = ({ username, password, recoveryPhrase, captchaToken }: SignUpInput) =>
      withClient(async (c) => {
        const name = sanitizeUsername(username);
        const nameError = validateUsername(name);
        if (nameError) return fail(nameError);
        const passwordError = validatePassword(password);
        if (passwordError) return fail(passwordError);
        const phrase = normalizePhrase(recoveryPhrase);
        if (!isValidPhrase(phrase)) return fail(AUTH_COPY.phraseTooShort);
        const taken = await c.rpc("username_taken", { p_username: name });
        if (taken.error) return fail(describeAuthError(taken.error, "rpc"));
        if (taken.data === true) return fail(AUTH_COPY.usernameTaken);
        const options = captchaToken ? { data: { username: name }, captchaToken } : { data: { username: name } };
        const { data, error: err } = await c.auth.signUp({ email: usernameToEmail(name, domain), password, options });
        if (err) return fail(describeAuthError(err, "sign-up"));
        if (data.session) applySession(data.session);
        else {
          const signedIn = await signInWith(c, name, password);
          if (!signedIn.ok) return signedIn;
        }
        return storePhrase(c, phrase);
      });

    const signOut = async (): Promise<void> => {
      if (!enabled) return;
      if (loading.current) {
        try {
          const c = await loading.current;
          await c.auth.signOut();
        } catch {
          // The local session is dropped either way.
        }
      }
      applySession(null);
    };

    const resetWithRecovery = ({ username, recoveryPhrase, newPassword, captchaToken }: ResetInput) =>
      withClient(async (c) => {
        const name = sanitizeUsername(username);
        if (!name) return fail(AUTH_COPY.enterUsername);
        const phrase = normalizePhrase(recoveryPhrase);
        if (!phrase) return fail(AUTH_COPY.enterPhrase);
        const passwordError = validatePassword(newPassword);
        if (passwordError) return fail(passwordError);
        const request = captchaToken ? { username: name, recoveryPhrase: phrase, newPassword, captchaToken } : { username: name, recoveryPhrase: phrase, newPassword };
        const reset = await requestPasswordReset(request);
        if (!reset.ok) return fail(reset.error);
        return signInWith(c, name, newPassword);
      });

    const deleteAccount = () =>
      withClient(async (c) => {
        const { error: err } = await c.rpc("delete_my_account");
        if (err) return fail(describeAuthError(err, "rpc"));
        await c.auth.signOut();
        applySession(null);
        return succeed();
      });

    const isUsernameTaken = async (username: string): Promise<boolean | null> => {
      if (!enabled) return null;
      const name = sanitizeUsername(username);
      if (validateUsername(name)) return null;
      try {
        const c = await ensureClient();
        const { data, error: err } = await c.rpc("username_taken", { p_username: name });
        return err ? null : data === true;
      } catch {
        return null;
      }
    };

    const setRecoveryPhrase = (phrase: string) =>
      withClient(async (c) => {
        const clean = normalizePhrase(phrase);
        if (!isValidPhrase(clean)) return fail(AUTH_COPY.phraseTooShort);
        return storePhrase(c, clean);
      });

    return { status, user, client, error, signIn, signUp, signOut, resetWithRecovery, deleteAccount, isUsernameTaken, setRecoveryPhrase };
  }, [status, user, client, error, enabled, ensureClient, applySession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
