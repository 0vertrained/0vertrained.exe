// The account copy and the mapping from server errors to it. Every message
// says what happened and what to do, in the coach's voice; nothing from the
// server is shown verbatim, so a stack trace or an internal code never
// reaches the sheet.
import type { AuthErrorLike } from "./authTypes";

export const AUTH_COPY = Object.freeze({
  usernameTaken: "Username is taken. Try another.",
  wrongCredentials: "Wrong username or password.",
  offline: "Could not reach the server. Check your connection.",
  phraseMismatch: "That phrase does not match. Check the word order.",
  unavailable: "Accounts are not available in this build.",
  generic: "The server could not complete that. Try again.",
  phraseNotSaved: "Your account was created, but the recovery phrase was not saved. Check your connection and set it again from Profile.",
  phraseTooShort: "Use a recovery phrase of at least 8 characters.",
  enterUsername: "Enter your username.",
  enterPassword: "Enter your password.",
  enterPhrase: "Enter your recovery phrase.",
});

/** "Too many attempts. Wait 30 seconds and try again." */
export function tooManyAttempts(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return "Too many attempts. Wait a minute and try again.";
  if (retryAfterSeconds < 90) return `Too many attempts. Wait ${Math.ceil(retryAfterSeconds)} seconds and try again.`;
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Too many attempts. Wait ${minutes} minutes and try again.`;
}

const NETWORK = /failed to fetch|fetch failed|networkerror|network request failed|load failed|econn|timed? ?out/i;

/** A thrown or returned error that means the request never reached the server. */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown; status?: unknown };
  if (e.name === "AuthRetryableFetchError") return true;
  if (e.name === "TypeError" && typeof e.message === "string" && NETWORK.test(e.message)) return true;
  return typeof e.message === "string" && NETWORK.test(e.message);
}

export type AuthErrorContext = "sign-in" | "sign-up" | "rpc";

/** Plain copy for a Supabase auth or RPC error, by where it came from. */
export function describeAuthError(error: AuthErrorLike, context: AuthErrorContext): string {
  if (isNetworkError(error)) return AUTH_COPY.offline;
  const message = error.message ?? "";
  if (error.status === 429 || /rate limit|too many/i.test(message)) return tooManyAttempts();
  if (context === "sign-in") return AUTH_COPY.wrongCredentials;
  if (context === "sign-up" && /username|already registered|already exists|user_already_exists/i.test(message)) return AUTH_COPY.usernameTaken;
  return AUTH_COPY.generic;
}

/** Plain copy for something a client call threw rather than returned. */
export function describeThrown(err: unknown): string {
  return isNetworkError(err) ? AUTH_COPY.offline : AUTH_COPY.generic;
}
