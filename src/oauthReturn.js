// src/oauthReturn.js
// ─────────────────────────────────────────────────────────────────────────────
// V19.4 · Wearable connections finish in the app.
//
// Each provider's OAuth callback sends the browser back with the result in
// the URL, and until now nothing read it: a successful Oura connection landed
// on Today without a word, and a failed one said nothing at all.
//   Oura    /settings?oura_connected=true        /settings?oura_error=<code>
//   Whoop   /?whoop=connected#/settings          /?whoop_error=<code>#/settings
//   Strava  /?strava=connected#/settings         /?strava_error=<code>#/settings
//   Google  /?google_health=connected#/settings  /?google_health_error=<code>#/settings
// A bare /settings or #/settings (the links older builds rendered) opens
// Integrations too.
//
// readOAuthReturn() says where to land and what to say there; App opens
// Settings → Integrations with that line once the account has loaded, then
// replaces the address with cleanOAuthReturnUrl() so a reload or a shared
// link never replays it. Pure: callers pass a location-like object.
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDERS = [
  { id: "oura", label: "Oura", connected: (p) => p.get("oura_connected") === "true", errorKey: "oura_error" },
  { id: "whoop", label: "Whoop", connected: (p) => p.get("whoop") === "connected", errorKey: "whoop_error" },
  { id: "strava", label: "Strava", connected: (p) => p.get("strava") === "connected", errorKey: "strava_error" },
  { id: "google_health", label: "Google Health", connected: (p) => p.get("google_health") === "connected", errorKey: "google_health_error" },
];

const RETURN_KEYS = ["oura_connected", "oura_error", "whoop", "whoop_error", "strava", "strava_error", "google_health", "google_health_error"];
const SETTINGS_HASHES = ["#/settings", "#settings"];

// Oura and Whoop pull the last 14 days while connecting (before the
// redirect); Strava imports when you sync.
const CONNECTED_COPY = {
  oura: "Oura connected. Connecting also syncs your last 14 days; the result is below.",
  whoop: "Whoop connected. Connecting also syncs your last 14 days; the result is below.",
  strava: "Strava connected. Tap Sync now below to bring in your recent activities.",
  google_health: "Google Health connected. Sync status is below.",
};

// The codes the callbacks send (netlify/functions/*-auth.js), in words. Strava
// and Google pass the provider's own message when the token exchange fails
// ("Bad Request" arrives here as "badrequest"), and their own
// strava_token_<status>, so anything about tokens, grants or a rejected
// request reads as a sign-in that couldn't be completed.
function reasonFor(code) {
  if (code === "access_denied") return "access wasn't granted";
  if (code === "network_error") return "the provider couldn't be reached";
  if (code === "server_error" || code === "temporarily_unavailable") return "the provider had a temporary problem";
  if (code === "invalid_token_response") return "the provider sent back a response we couldn't read";
  if (code === "token_storage_unconfigured") return "the server isn't set up to store connections yet";
  if (code === "storage_failed" || code === "token_store_failed") return "the connection couldn't be saved";
  if (code.includes("token") || code.includes("grant") || code === "badrequest" || code === "unauthorized") return "the sign-in couldn't be completed";
  return null;
}

/**
 * @param {{ pathname?: string, search?: string, hash?: string }} loc
 * @returns {null | { section: "integrations", notice: null | { provider, status: "connected" | "error", tone: "ok" | "error", text } }}
 */
export function readOAuthReturn(loc) {
  const params = new URLSearchParams(typeof loc?.search === "string" ? loc.search : "");
  for (const p of PROVIDERS) {
    if (params.has(p.errorKey)) {
      // Shown as text only, and only our own short codes: a crafted link
      // can't put a sentence of its choosing on the screen.
      const code = String(params.get(p.errorKey) || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
      const reason = reasonFor(code);
      const detail = reason ? `: ${reason}` : code ? ` (${code})` : "";
      return {
        section: "integrations",
        notice: { provider: p.id, status: "error", tone: "error", text: `${p.label} didn't connect${detail}. You can try again below.` },
      };
    }
    if (p.connected(params)) {
      return { section: "integrations", notice: { provider: p.id, status: "connected", tone: "ok", text: CONNECTED_COPY[p.id] } };
    }
  }
  if (loc?.pathname === "/settings" || SETTINGS_HASHES.includes(loc?.hash)) {
    return { section: "integrations", notice: null };
  }
  return null;
}

/** The same address without the return markers (other query params and hashes survive). */
export function cleanOAuthReturnUrl(loc) {
  const params = new URLSearchParams(typeof loc?.search === "string" ? loc.search : "");
  for (const key of RETURN_KEYS) params.delete(key);
  const query = params.toString();
  const path = !loc?.pathname || loc.pathname === "/settings" ? "/" : loc.pathname;
  const hash = loc?.hash && !SETTINGS_HASHES.includes(loc.hash) ? loc.hash : "";
  return `${path}${query ? `?${query}` : ""}${hash}`;
}
