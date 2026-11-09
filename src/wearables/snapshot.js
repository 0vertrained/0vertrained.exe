// src/wearables/snapshot.js
// Client helpers for the DB-first wearable snapshot slice.
//
// Recovery hydrates from the fastest available source in this order:
//   session cache → localStorage snapshot → SERVER snapshot (here) → live data.
//
// These helpers talk to /api/wearable/* with the current Supabase session token.
// Ownership is ALWAYS derived server-side from that Bearer JWT — we never send a
// user_id in the query or body. Responses are treated as untrusted and run back
// through the same defensive secret-stripper the writer uses, so a token-like
// field can never reach the UI even if the server regressed.
//
// Demo mode returns a synthetic, empty, display-safe shape (no network).

import { supabase } from "../supabaseClient";
import { isDemoMode } from "../demoData";
import {
  toDisplaySafeSnapshot,
  summarizeSnapshotStatus,
  emptySnapshotResult,
} from "./snapshotSanitize";

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

function normalizeServerResult(data) {
  // The server already sanitizes, but re-strip defensively before the UI sees it.
  const snapshot = data && data.snapshot ? toDisplaySafeSnapshot(data.snapshot) : null;
  const source = typeof data?.source === "string" && data.source ? data.source : null;
  const updatedAt = data?.updatedAt || null;
  const summary = summarizeSnapshotStatus({ snapshot, updatedAt, source });
  return {
    snapshot: summary.hasSnapshot ? snapshot : null,
    source,
    updatedAt,
    // Trust the server's status if it sent a valid one, else derive locally.
    status: ["fresh", "stale", "empty"].includes(data?.status) ? data.status : summary.status,
    hasSnapshot: summary.hasSnapshot,
  };
}

/**
 * Fetch the current user's display-safe server snapshot.
 * Returns { snapshot, source, updatedAt, status, hasSnapshot }. Never throws;
 * on any failure (unauthenticated, network, non-OK) returns the empty shape so
 * callers can fall through to a live provider refresh without branching on null.
 */
export async function fetchServerSnapshot() {
  if (isDemoMode()) return emptySnapshotResult();
  try {
    const token = await getAccessToken();
    if (!token) return emptySnapshotResult();
    const r = await fetch("/api/wearable/snapshot", {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return emptySnapshotResult();
    const data = await r.json().catch(() => null);
    if (!data) return emptySnapshotResult();
    return normalizeServerResult(data);
  } catch (e) {
    console.error("fetchServerSnapshot error:", e);
    return emptySnapshotResult();
  }
}

/**
 * Lightweight freshness check without pulling the full snapshot body.
 * Returns { hasSnapshot, status, updatedAt, source }. Never throws.
 */
export async function fetchServerSnapshotStatus() {
  if (isDemoMode()) {
    const empty = emptySnapshotResult();
    return { hasSnapshot: false, status: empty.status, updatedAt: null, source: null };
  }
  try {
    const token = await getAccessToken();
    if (!token) return { hasSnapshot: false, status: "empty", updatedAt: null, source: null };
    const r = await fetch("/api/wearable/status", {
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
      },
    });
    if (!r.ok) return { hasSnapshot: false, status: "empty", updatedAt: null, source: null };
    const data = await r.json().catch(() => ({}));
    return {
      hasSnapshot: Boolean(data?.hasSnapshot),
      status: ["fresh", "stale", "empty"].includes(data?.status) ? data.status : "empty",
      updatedAt: data?.updatedAt || null,
      source: typeof data?.source === "string" && data.source ? data.source : null,
    };
  } catch (e) {
    console.error("fetchServerSnapshotStatus error:", e);
    return { hasSnapshot: false, status: "empty", updatedAt: null, source: null };
  }
}

/**
 * Best-effort upsert of the caller's latest display-safe snapshot after a live
 * Recovery load. Ownership is server-derived from the Bearer token — we never
 * send a user_id. Token-like fields are stripped client-side before sending as
 * defence-in-depth (the server strips again). Fire-and-forget: returns
 * { ok } / { skipped } / { error } and never throws so it can't break a render.
 *
 * @param {object} snapshot - already-rendered display-safe dashboard values
 * @param {{ source?: string }} [opts]
 */
export async function postServerSnapshot(snapshot, { source = null } = {}) {
  if (isDemoMode()) return { ok: true, demo: true };
  if (!snapshot || typeof snapshot !== "object") return { skipped: true };
  try {
    const token = await getAccessToken();
    if (!token) return { skipped: true };
    const safe = toDisplaySafeSnapshot(snapshot);
    const r = await fetch("/api/wearable/snapshot", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
      },
      // Body carries the snapshot + advisory source only — never a user_id.
      body: JSON.stringify({ snapshot: safe, source: typeof source === "string" ? source : null }),
    });
    if (!r.ok) return { error: `status ${r.status}` };
    return { ok: true };
  } catch (e) {
    console.error("postServerSnapshot error:", e);
    return { error: e.message };
  }
}
