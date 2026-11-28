// Browser subscriptions can come from clients or older stored registrations.
// Return the canonical HTTPS URL that web-push should receive.
export function trustedPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.pathname === "/") return null;

  const host = url.hostname;
  const permitted = host === "fcm.googleapis.com" ||
    ["push.apple.com", "push.services.mozilla.com", "notify.windows.com"].some(
      domain => host === domain || host.endsWith("." + domain)
    );
  return permitted ? url.href : null;
}
