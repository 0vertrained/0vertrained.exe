// The one place supabase-js is imported, and only dynamically: a guest
// build never loads it, and the app checks hasStoredSession() before
// deciding to. The client is created once with session persistence under
// its own storage key, so the v19 app's session never bleeds in. Tests
// inject a fake with setAuthClientForTests and never touch the import.
import { backendConfig, hasBackend } from "../app/config";
import type { AuthClient } from "./authTypes";

/** The localStorage key supabase-js persists the session under. */
export const AUTH_STORAGE_KEY = "ovt-v20-auth";

let pending: Promise<AuthClient> | null = null;
let injected: AuthClient | null = null;

function defaultStorage(): Pick<Storage, "getItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** True when a session was persisted here before, so loading the client is worth it. */
export function hasStoredSession(storage: Pick<Storage, "getItem"> | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(AUTH_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

/** The memoised client; rejects when no backend is configured. */
export function getAuthClient(): Promise<AuthClient> {
  if (injected) return Promise.resolve(injected);
  if (!hasBackend()) return Promise.reject(new Error("No backend is configured."));
  pending ??= import("@supabase/supabase-js")
    .then(({ createClient }) => {
      const client: AuthClient = createClient(backendConfig.supabaseUrl, backendConfig.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
      });
      return client;
    })
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}

/** Replaces the client for tests; pass null to restore the real one. */
export function setAuthClientForTests(client: AuthClient | null): void {
  injected = client;
  pending = null;
}
