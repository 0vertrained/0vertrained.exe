// src/integrationErrors.js
// User-facing copy for wearable (Oura/Whoop) integration failures.
//
// Server sync endpoints return terse, engineering-facing error strings
// ("Token refresh failed", "Sync failed", "Not authenticated", …). Those must
// never surface verbatim in the UI: some are jargon, and some ("Token refresh
// failed") imply a manual step that the self-healing `/status` path now handles
// automatically. Callers keep the raw string in `console` for debugging and show
// the mapped copy below to the user.

// Map a raw server sync error string to friendly, actionable user copy.
// `raw` is the server's `error` field; `provider` is an optional label ("Whoop"/"Oura").
export function friendlySyncError(raw, provider = "") {
  const s = String(raw || "").toLowerCase();
  const what = provider || "the connection";

  // Genuine refresh-token death — the self-heal couldn't renew it. Rare now that
  // `/status` refreshes proactively, so this really does mean "re-link".
  if (s.includes("refresh") || s.includes("not connected") || s.includes("reconnect")) {
    return `Reconnect needed — re-link ${what} above to resume syncing.`;
  }

  // Session expired on our side — not the wearable's fault.
  if (s.includes("not authenticated") || s.includes("unauthorized")) {
    return "Please sign in again, then retry.";
  }

  // Config/plumbing problems the user can't act on — don't alarm them.
  if (s.includes("not configured") || s.includes("server not")) {
    return "Sync is temporarily unavailable — it will retry shortly.";
  }

  // Everything else (generic "Sync failed", upstream 5xx, network) is transient.
  return "Sync will retry shortly — your data isn't lost.";
}
