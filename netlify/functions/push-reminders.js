// netlify/functions/push-reminders.js
// V7 · Scheduled evening check-in reminder.
// V12.1 · Timezone-aware: the cron now fires HOURLY at :30 and each run sends
// only to subscriptions whose LOCAL time is 7:30pm, using the per-device
// tz_offset_minutes captured at subscribe time (migration_v28). Rows that
// predate the migration default to 360 (US Central), which reproduces the old
// single-send behavior exactly. reminders_enabled=false opts a subscription
// out without touching its push registration.
//
// Netlify scheduled functions are not publicly routable in production — only
// the scheduler invokes this — so no auth gate is needed here.
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (npx web-push generate-vapid-keys)
//   VAPID_SUBJECT                        (mailto:you@example.com)

import webpush from "web-push";

// Target local send time: 19:30.
const TARGET_LOCAL_HOUR = 19;

// A subscription is due when its local clock reads 19:xx right now. The cron
// fires at :30 UTC; offsets are stored in minutes, and half-hour/quarter-hour
// zones (India +330, Nepal +345, …) land inside the 19:00–19:59 local window
// on whichever hourly run covers them, so nobody is skipped — they just get
// the nudge at their local :00/:15/:45 instead of exactly :30.
export function isDue(tzOffsetMinutes, nowUtcMs) {
  // Careful with coercion: +null === 0, which would silently treat a missing
  // offset as UTC. Missing/blank/garbage all mean "legacy row" → Central (360).
  const missing = tzOffsetMinutes === null || tzOffsetMinutes === undefined || tzOffsetMinutes === "";
  const offset = !missing && Number.isFinite(+tzOffsetMinutes) ? +tzOffsetMinutes : 360;
  const localMs = nowUtcMs - offset * 60_000; // getTimezoneOffset semantics: local = UTC - offset
  const localHour = new Date(localMs).getUTCHours();
  return localHour === TARGET_LOCAL_HOUR;
}

export default async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@0vertrained.app";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: "Push not configured" }), { status: 500 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const rest = (path, init) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        ...(init?.headers || {}),
      },
    });

  // Select the pref columns too; if migration_v28 hasn't run yet PostgREST
  // 400s on the unknown columns, so fall back to the legacy select (which
  // behaves as "all enabled, Central time").
  let listRes = await rest("push_subscriptions?select=endpoint,p256dh,auth,reminders_enabled,tz_offset_minutes");
  if (!listRes.ok) {
    listRes = await rest("push_subscriptions?select=endpoint,p256dh,auth");
  }
  if (!listRes.ok) return new Response(JSON.stringify({ error: "Failed to load subscriptions" }), { status: 502 });
  const subs = await listRes.json();

  const nowMs = Date.now();
  const due = subs.filter(s =>
    (s.reminders_enabled !== false) && isDue(s.tz_offset_minutes, nowMs)
  );

  const payload = JSON.stringify({
    title: "Evening check-in",
    body: "Log sleep, energy, and soreness — tomorrow's call depends on tonight's data.",
    tag: "ovt-checkin",
    url: "/",
  });

  let sent = 0, pruned = 0, failed = 0;
  for (const s of due) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
      sent++;
    } catch (err) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }).catch(() => {});
        pruned++;
      } else {
        failed++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, scanned: subs.length, due: due.length, sent, pruned, failed }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config = {
  // Hourly at :30 — each run sends only to subscribers whose local time is
  // 19:xx (see isDue). Was "30 0 * * *" (one global 7:30pm-Central send).
  schedule: "30 * * * *",
};
