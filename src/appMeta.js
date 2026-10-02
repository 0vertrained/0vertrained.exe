// V13.5 · package.json is the single source of truth for the app version —
// __APP_VERSION__ is injected by the Vite/Vitest define (see vite.config.js).
// public/sw.js is stamped from the same source by scripts/sync-version.mjs,
// and versionSync.test.js fails the quality gate on any drift.
const RAW_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export const APP_VERSION = `V${RAW_VERSION}`;
export const SUPPORT_EMAIL = "0vertrained.exe@gmail.com";

export function buildSupportMailto({ subject = "0VERTRAINED support", body = "" } = {}) {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
}
