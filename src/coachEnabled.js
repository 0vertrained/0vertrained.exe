// src/coachEnabled.js
// Coach visibility gate, extracted from Coach.jsx so the app shell can
// check it without importing the (now lazy-loaded) Coach chunk. This is a
// CONVENIENCE/visibility flag only — the real security gate is enforced
// server-side in netlify/functions/coach.js (legacy env allow OR the
// coach_access table, plus daily/monthly limits). Never rely on this client
// flag for security.
//
// Two modes:
//   · Default (VITE_COACH_OPEN unset): only the legacy env-matched user sees
//     the entry point — identical to pre-beta behavior.
//   · VITE_COACH_OPEN=true: every logged-in user sees it; accounts without a
//     coach_access grant get the server's friendly 403 in the chat itself.

const COACH_USER_ID = import.meta.env.VITE_COACH_USER_ID || "";
const COACH_OPEN = import.meta.env.VITE_COACH_OPEN === "true";

export function isCoachEnabled(userId) {
  if (!userId) return false;
  if (COACH_OPEN) return true;
  return Boolean(COACH_USER_ID) && userId === COACH_USER_ID;
}
