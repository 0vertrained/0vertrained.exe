// src/wearables/snapshotSanitize.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure, browser-safe helpers for the DB-first wearable snapshot slice.
//
// These functions have NO side effects and touch NO browser/network APIs, so
// they are unit-testable in isolation and are the single source of truth for:
//   • stripping token-like / secret-bearing fields before a snapshot is sent to
//     or rendered from the server (defence-in-depth on top of RLS), and
//   • deriving a display-safe freshness / staleness marker from a timestamp.
//
// The secret-stripping reuses sanitizeSnapshot() from wearableSnapshotCache so
// the local-cache and server-snapshot paths can never drift apart on what
// counts as a secret. The server function mirrors the same rules inline (it is
// intentionally self-contained, like the other netlify functions).
// ─────────────────────────────────────────────────────────────────────────────

import { sanitizeSnapshot } from "../wearableSnapshotCache";

// A server snapshot older than this is labelled "stale" — still displayed, but
// the UI/response makes clear a live refresh is warranted. Six hours keeps an
// overnight snapshot "fresh" for a morning open while flagging day-old data.
export const SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Defensively strip any secret/token-bearing keys from a snapshot before it is
 * sent to the server or rendered from a server response. Returns a new object;
 * non-objects pass through unchanged. Never mutates its input.
 */
export function toDisplaySafeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  return sanitizeSnapshot(snapshot);
}

/**
 * Parse a timestamp (ISO string or epoch ms) to epoch ms, or null when absent /
 * unparseable. Kept permissive so a server row's `updated_at` string and a
 * client `savedAt` number both work.
 */
export function toEpochMs(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * Derive a display-safe freshness status for a snapshot.
 *   • "empty" — no snapshot present at all.
 *   • "stale" — present but older than SNAPSHOT_STALE_MS (or timestamp missing).
 *   • "fresh" — present and recent.
 * A future/negative age is treated as fresh (clock skew shouldn't hide data).
 *
 * @param {{ hasSnapshot?: boolean, updatedAt?: string|number, now?: number, staleMs?: number }} opts
 */
export function deriveSnapshotStatus({ hasSnapshot, updatedAt, now = Date.now(), staleMs = SNAPSHOT_STALE_MS } = {}) {
  if (!hasSnapshot) return "empty";
  const ts = toEpochMs(updatedAt);
  if (ts == null) return "stale"; // present but undatable → assume stale
  const ageMs = now - ts;
  if (ageMs < 0) return "fresh";
  return ageMs > staleMs ? "stale" : "fresh";
}

/**
 * Build a compact, display-safe status summary for the server snapshot. Pure —
 * used by both the client helper and (mirrored) the server function so status
 * copy stays consistent.
 *
 * @returns {{ hasSnapshot: boolean, status: "empty"|"fresh"|"stale", ageMs: number|null, source: string|null }}
 */
export function summarizeSnapshotStatus({ snapshot, updatedAt, source = null, now = Date.now(), staleMs = SNAPSHOT_STALE_MS } = {}) {
  const hasSnapshot = Boolean(snapshot && typeof snapshot === "object" && Object.keys(snapshot).length > 0);
  const ts = toEpochMs(updatedAt);
  return {
    hasSnapshot,
    status: deriveSnapshotStatus({ hasSnapshot, updatedAt, now, staleMs }),
    ageMs: ts == null ? null : Math.max(0, now - ts),
    source: typeof source === "string" && source ? source : null,
  };
}

// The empty/synthetic shape returned in demo mode or when nothing is stored.
// Kept display-safe and stable so callers never branch on null.
export function emptySnapshotResult() {
  return { snapshot: null, source: null, updatedAt: null, status: "empty", hasSnapshot: false };
}
