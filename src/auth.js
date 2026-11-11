import { supabase, usernameToInternalId } from "./supabaseClient";
import { deriveRecoveryHash } from "./recoveryKdf";

// Client-side login rate limiter with exponential backoff.
// This is a UX-level safeguard — the real protection is Supabase's server-side
// rate limiting and RLS. This prevents rapid automated attempts from the browser
// and gives users clear feedback on how long to wait.
const loginAttempts = { count: 0, resetAt: 0, lockUntil: 0 };

function checkRateLimit() {
  const now = Date.now();

  // Hard lock (after repeated failures)
  if (now < loginAttempts.lockUntil) {
    const wait = Math.ceil((loginAttempts.lockUntil - now) / 1000);
    return `Too many failed attempts. Wait ${wait}s before trying again.`;
  }

  // Rolling window reset
  if (now > loginAttempts.resetAt) {
    loginAttempts.count = 0;
    loginAttempts.resetAt = now + 60_000;
  }

  loginAttempts.count++;

  // Exponential backoff: 5 attempts = 30s lock, 8 = 2min, 12 = 5min
  if (loginAttempts.count >= 12) {
    loginAttempts.lockUntil = now + 5 * 60_000;
    return "Account temporarily locked after repeated failures. Wait 5 minutes.";
  }
  if (loginAttempts.count >= 8) {
    loginAttempts.lockUntil = now + 2 * 60_000;
    return "Too many attempts. Wait 2 minutes before trying again.";
  }
  if (loginAttempts.count > 5) {
    loginAttempts.lockUntil = now + 30_000;
    return "Too many attempts. Wait 30 seconds before trying again.";
  }

  return null;
}

// With CAPTCHA protection on, Supabase checks the human check's token with
// Cloudflare before it looks at a password, and refuses a request whose token
// is missing, already used or not accepted (humanCheck.js, docs/human-check.md).
const HUMAN_CHECK_REFUSED = "The human check didn't go through. Try again; if it keeps happening, reload the page.";
const refusedByHumanCheck = (error) => error?.code === "captcha_failed" || /captcha/i.test(error?.message || "");
// The token rides along only when there is one, so nothing changes where the check is off.
const withHumanCheck = (captchaToken) => (captchaToken ? { options: { captchaToken } } : {});

// Sanitize username: lowercase, trim, only allow alphanumeric + dots + underscores
function sanitizeUsername(username) {
  return String(username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

// Recovery-phrase hashing moved to src/recoveryKdf.js (PBKDF2-SHA256).
// The former client-side single-round SHA-256 helpers (sha256/generateSalt/
// hashWithSalt) are gone; deriveRecoveryHash generates its own salt and stamps
// the KDF version so the server can verify and lazily upgrade legacy rows.

// Check how many users exist vs the cap.
// Returns { open: bool, current: n, max: n }
export async function getSignupStatus() {
  // Get the cap from app_state
  const { data: state, error: stateErr } = await supabase
    .from("app_state")
    .select("max_users")
    .eq("id", 1)
    .single();

  if (stateErr || !state) return { open: false, current: 0, max: 0 };

  // Call a security-definer RPC function that counts users server-side.
  // This bypasses RLS safely — it only returns a count, no user data.
  const { data: countData, error: countErr } = await supabase
    .rpc("get_user_count");

  const current = countErr ? 0 : (countData ?? 0);
  const max     = state.max_users ?? 5;
  const open    = current < max;

  return { open, current, max };
}

export async function isSignupOpen() {
  const { open } = await getSignupStatus();
  return open;
}

export async function signUp({ username, password, recoveryPhrase, captchaToken }) {
  // Re-check cap server-side before proceeding
  const { open, current, max } = await getSignupStatus();
  if (!open) {
    return { error: `This app is full (${current}/${max} users). Ask the admin to increase the limit.` };
  }

  const cleanUsername = sanitizeUsername(username);
  if (!cleanUsername) return { error: "Username is required (letters, numbers, dots, underscores only)." };
  if (password.length < 8)  return { error: "Password must be at least 8 characters." };
  if (password.length > 72) return { error: "Password too long (max 72 characters)." };
  // Encourage a minimum of complexity — at least one non-letter character
  if (!/[^a-zA-Z]/.test(password)) return { error: "Password must contain at least one number or symbol." };

  const internalId = usernameToInternalId(cleanUsername);

  const { data, error } = await supabase.auth.signUp({
    email: internalId,
    password,
    ...withHumanCheck(captchaToken),
  });
  if (error) {
    if (refusedByHumanCheck(error)) return { error: HUMAN_CHECK_REFUSED };
    // A "user already registered" here usually means a previous signup
    // created the auth user but the profile insert failed (network blip, cap
    // race). The username is reserved by that auth account, and logging in
    // triggers the self-heal below (ensureProfileExists) which finishes setup.
    if (/already registered/i.test(error.message || "")) {
      return { error: "That username is taken. If it's yours and a previous signup didn't finish, just log in — your account will complete setting up automatically." };
    }
    return { error: error.message };
  }

  const userId = data.user?.id;
  if (!userId) return { error: "Signup failed — no user id returned." };

  // PBKDF2-SHA256 recovery hash with a fresh per-user salt and a
  // stamped KDF version, so a profiles leak is dictionary-resistant and the
  // recovery function can tell new hashes from legacy ones.
  let recovery_hash = null;
  let recovery_salt = null;
  let recovery_kdf = null;
  if (recoveryPhrase) {
    const derived = await deriveRecoveryHash(recoveryPhrase);
    recovery_hash = derived.hash;
    recovery_salt = derived.salt;
    recovery_kdf = derived.kdf;
  }
  const { error: pErr } = await supabase.from("profiles").insert({
    id: userId,
    username: cleanUsername,
    recovery_hash,
    recovery_salt,
    recovery_kdf,
  });
  if (pErr) {
    // migration_v29 enforces the cap server-side with a BEFORE INSERT trigger
    // (the client-side getSignupStatus check above is advisory UX only, since
    // the anon key is public). Map its stable message tokens to friendly copy.
    const msg = pErr.message || "";
    if (msg.includes("SIGNUP_CAP_REACHED")) {
      return { error: "This app is at its user limit right now. Ask the admin to open more spots." };
    }
    if (msg.includes("SIGNUP_LOCKED")) {
      return { error: "Signups are currently closed." };
    }
    return { error: "Profile creation failed: " + msg };
  }

  return { user: data.user };
}

export async function logIn({ username, password, captchaToken }) {
  const rateLimitError = checkRateLimit();
  if (rateLimitError) return { error: rateLimitError };
  const cleanUsername = sanitizeUsername(username);
  if (!cleanUsername) return { error: "Invalid username." };
  const internalId = usernameToInternalId(cleanUsername);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: internalId,
    password,
    ...withHumanCheck(captchaToken),
  });
  // Not a wrong password, so it is not counted as one: Supabase never got as far as the password.
  if (error && refusedByHumanCheck(error)) {
    loginAttempts.count = Math.max(0, loginAttempts.count - 1);
    return { error: HUMAN_CHECK_REFUSED };
  }
  if (error) return { error: "Invalid username or password." };
  // Clear the rate limit counter on success
  loginAttempts.count = 0;
  loginAttempts.lockUntil = 0;
  return { user: data.user };
}

export async function logOut() {
  await supabase.auth.signOut();
}

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

// Change the recovery phrase for the currently signed-in user. Writes
// a fresh PBKDF2 hash+salt to the caller's own profiles row via RLS
// (profiles_update_own: auth.uid() = id), so no service role or server
// function is needed — the user is already authenticated. This closes the
// permanent-lockout gap: before, a phrase set at signup could never be
// changed, so forgetting both password and phrase meant an unrecoverable
// account with no email fallback.
export async function changeRecoveryPhrase({ newPhrase }) {
  const phrase = String(newPhrase ?? "").trim();
  if (phrase.length < 8) return { error: "Recovery phrase must be at least 8 characters." };

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return { error: "You must be signed in to change your recovery phrase." };

  const { hash, salt, kdf } = await deriveRecoveryHash(phrase);
  const { error } = await supabase
    .from("profiles")
    .update({ recovery_hash: hash, recovery_salt: salt, recovery_kdf: kdf })
    .eq("id", userId);
  if (error) return { error: "Couldn't update your recovery phrase. Try again." };
  return { ok: true };
}

// Self-heal the signup orphan path. If auth.signUp succeeded but the
// profiles insert failed (network blip, cap race), the user holds a valid
// session with no profile row: the app half-works and re-signup says "already
// registered". On boot, App.jsx calls this: if the signed-in user has no
// profile, insert one with the username derived from the synthetic auth email
// (the local part IS the username — that's the usernameToInternalId contract).
// Recovery fields stay null; the caller should nudge the user to set a phrase
// in Settings → Account. The insert passes through the v29 signup-cap trigger,
// so a full app still refuses (reason "cap"). `client` is injectable for tests.
export async function ensureProfileExists(client = supabase) {
  const { data } = await client.auth.getUser();
  const authUser = data?.user;
  if (!authUser?.id || !authUser?.email) return { ok: true, existed: true };

  const { data: rows, error: selErr } = await client
    .from("profiles").select("id").eq("id", authUser.id).limit(1);
  // Fail open on a lookup blip — never block boot on the healer itself.
  if (selErr) return { ok: true, existed: true };
  if (Array.isArray(rows) && rows.length > 0) return { ok: true, existed: true };

  const username = sanitizeUsername(String(authUser.email).split("@")[0]);
  if (!username) return { ok: false, reason: "bad_username" };

  const { error: insErr } = await client.from("profiles").insert({ id: authUser.id, username });
  if (insErr) {
    const msg = insErr.message || "";
    if (msg.includes("SIGNUP_CAP_REACHED") || msg.includes("SIGNUP_LOCKED")) {
      return { ok: false, reason: "cap" };
    }
    return { ok: false, reason: "insert_failed" };
  }
  return { ok: true, existed: false, needsRecoveryPhrase: true };
}

export async function resetPasswordWithRecovery({ username, recoveryPhrase, newPassword }) {
  try {
    const response = await fetch("/api/account-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, recoveryPhrase, newPassword }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { error: payload?.error || "Password reset failed. Try again later." };
    return { ok: true, message: payload?.message || "Password reset. You can sign in now." };
  } catch {
    return { error: "Could not reach account recovery. Check your connection and try again." };
  }
}

