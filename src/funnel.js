// src/funnel.js
// First-party funnel events for the beta go/no-go call.
//
// The validation plan is judged on visit→paid conversion — that number has to
// be queryable, and client-side perfMarks die with the session. This is the
// smallest honest telemetry that can answer it:
//   · First-party only. Event name + timestamp; the server derives the user
//     from the JWT (house doctrine per log-error: anonymous sinks are abuse
//     magnets, so this endpoint is JWT-verified like every other sink).
//   · No PII in the payload, no third-party analytics, no fingerprinting.
//   · Fire-and-forget with total silent failure: if the function or the
//     events table doesn't exist yet, the app never notices. Telemetry must
//     never cost a user a millisecond or an error.
//   · Once per event name per session (funnel steps, not counters).
//   · Disabled entirely in demo mode.
// Server side: netlify/functions/log-event.js → `events` table
// (migrations/V17_0_events.sql — run once; the endpoint no-ops until then).
import { supabase } from "./supabaseClient";
import { isDemoMode } from "./demoData";

const sent = new Set();

export async function logFunnelEvent(name) {
  try {
    if (!name || sent.has(name)) return;
    if (typeof isDemoMode === "function" && isDemoMode()) return;
    sent.add(name);
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return; // pre-auth surfaces have no funnel steps; drop, don't queue
    await fetch("/api/log-event", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
      body: JSON.stringify({ name: String(name).slice(0, 64), at: new Date().toISOString() }),
    });
  } catch { /* telemetry never throws */ }
}

export default { logFunnelEvent };
