// src/errorReporting.js
// V9 · Beta error visibility. Captures uncaught errors, unhandled promise
// rejections, and ErrorBoundary catches, and reports them to
// /api/log-error (JWT-verified → service-role insert into client_errors).
//
// Privacy stance: we send the error itself (message/stack/component stack,
// hard-capped), the route path, app version, and user agent. NEVER entries,
// settings, biometrics, or request payloads — an error report must be safe
// to read next to the privacy policy.
//
// Abuse/noise stance: dedupe by message+source hash, hard cap per session,
// and pre-auth errors queue in memory and flush after login (the endpoint
// requires a JWT; an anonymous error sink is an abuse vector we don't want).

import { supabase } from "./supabaseClient";

export const MAX_REPORTS_PER_SESSION = 8;
import { APP_VERSION } from "./appMeta";

export { APP_VERSION };

const CAPS = { message: 500, stack: 4000, componentStack: 2000, path: 200 };

// ─── Pure helpers (unit-tested) ───────────────────────────────────────────────
export function normalizeError(err, context = {}) {
  const message = String(err?.message || err || "Unknown error").slice(0, CAPS.message);
  const stack = String(err?.stack || "").slice(0, CAPS.stack);
  return {
    message,
    stack,
    component_stack: String(context.componentStack || "").slice(0, CAPS.componentStack),
    source: String(context.source || "window").slice(0, 40),
    path: (typeof location !== "undefined" ? location.pathname + location.hash : "").slice(0, CAPS.path),
    app_version: APP_VERSION,
  };
}

export function errorKey(normalized) {
  // Cheap stable hash of message+source — enough to dedupe repeat loops.
  const s = `${normalized.source}|${normalized.message}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h);
}

export function createReporterState() {
  return { seen: new Set(), sent: 0, queue: [] };
}

// Decide whether a normalized error should be sent given current state.
// Mutates state (marks seen / increments) when it says yes.
export function shouldReport(state, normalized) {
  if (state.sent >= MAX_REPORTS_PER_SESSION) return false;
  const key = errorKey(normalized);
  if (state.seen.has(key)) return false;
  state.seen.add(key);
  state.sent += 1;
  return true;
}

// ─── Wiring (side-effectful) ──────────────────────────────────────────────────
const state = createReporterState();
let initialized = false;

async function send(normalized) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) {
      // Pre-auth: hold up to the session cap; flushed on SIGNED_IN.
      if (state.queue.length < MAX_REPORTS_PER_SESSION) state.queue.push(normalized);
      return;
    }
    await fetch("/api/log-error", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
      body: JSON.stringify(normalized),
    });
  } catch {
    // Reporting must never throw — a crashing error reporter is the one
    // failure mode strictly worse than no error reporter.
  }
}

export function reportError(err, context = {}) {
  try {
    const normalized = normalizeError(err, context);
    if (!shouldReport(state, normalized)) return;
    send(normalized);
  } catch {}
}

export function initErrorReporting() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("error", (event) => {
    reportError(event.error || event.message, { source: "window.onerror" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { source: "unhandledrejection" });
  });

  // Flush pre-auth queue once a session exists.
  try {
    supabase.auth.onAuthStateChange((eventName) => {
      if (eventName === "SIGNED_IN" && state.queue.length) {
        const pending = state.queue.splice(0, state.queue.length);
        pending.forEach(send);
      }
    });
  } catch {}
}
