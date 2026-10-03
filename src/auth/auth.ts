// Pure account helpers: the username rules, the password rule, the
// synthesised email the auth server needs, and the recovery phrase. No
// network, no React, no storage; the provider composes these.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const PHRASE_MIN = 8;

export const PASSWORD_RULE = "Use 8 to 72 characters with at least one number or symbol.";
export const USERNAME_RULE = "Use lowercase letters, numbers, dots, dashes and underscores.";

/** Trim, lower-case and drop anything outside [a-z0-9._-]. */
export function sanitizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

/** The message to show, or null when the name is usable as given. */
export function validateUsername(name: string): string | null {
  if (name.length === 0) return "Enter a username.";
  if (name.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `Use ${USERNAME_MAX} characters or fewer.`;
  if (!/^[a-z0-9._-]+$/.test(name)) return USERNAME_RULE;
  return null;
}

/** The message to show, or null when the password meets the rule. */
export function validatePassword(pw: string): string | null {
  if (pw.length === 0) return "Enter a password.";
  if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) return PASSWORD_RULE;
  if (!/[^\p{L}]/u.test(pw)) return PASSWORD_RULE;
  return null;
}

/**
 * The internal address an account signs in with. It is never mailed; the
 * local part is the username exactly, which is what the server relies on.
 */
export function usernameToEmail(username: string, domain: string): string {
  return `${username.trim().toLowerCase()}@${domain.trim().toLowerCase()}`;
}

/** Trim, collapse runs of whitespace and lower-case, so typing variants match. */
export function normalizePhrase(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isValidPhrase(text: string): boolean {
  return normalizePhrase(text).length >= PHRASE_MIN;
}

/** Six words from the list, one random byte each, joined by single spaces. */

