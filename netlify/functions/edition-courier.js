// netlify/functions/edition-courier.js
// The Courier — scheduled pushes that carry headlines, never numbers.
//
// Three sends, all idempotent per user+date+type via push_log, all gated on
// each subscription's LOCAL clock (per-device tz_offset_minutes, the
// push-reminders pattern):
//   · edition     — local 07:xx, only when TODAY's sleep row has landed:
//                   "The Morning Edition — Steady. Run the plan as written."
//   · transition  — same run, only when today's state differs from a state
//                   recorded YESTERDAY (consecutive days only; a stale state
//                   never manufactures news): "Steady → Fresh."
//   · sunday      — local Sunday 17:xx: "The Sunday Edition is out."
//
// Hard rules (tested):
//   · Send only when data exists — no sleep row for the user's local today →
//     skip silently. Never nag, never send "no data yet".
//   · Calibrating never pushes (a countdown is app copy, not a notification).
//   · Copy contains no digits anywhere — headlines and actions only.
//   · Runs are idempotent: push_log's UNIQUE(user_id, date, type) is claimed
//     with resolution=ignore-duplicates BEFORE sending; an empty
//     representation means another run already owns it.
//   · push_state records today's state whenever one is computed — even when
//     nothing is sent — so tomorrow's transition check has yesterday's truth.
//
// State classification: _recovery-mirror.js (slim mirror of the src trend
// classifier under loadZone/sleepDebt = null; parity pinned by
// src/__tests__/courierMirrorParity.test.js).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//               VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// Required tables: push_subscriptions (existing), push_state + push_log
//                  (migrations/V17_3_courier.sql).

import webpush from "web-push";
import { mirrorClassify } from "./_recovery-mirror.js";

const MORNING_LOCAL_HOUR = 7;
const SUNDAY_LOCAL_HOUR = 17;

const normalizeOffset = (tz) => {
  const missing = tz === null || tz === undefined || tz === "";
  return !missing && Number.isFinite(+tz) ? +tz : 360; // legacy rows → US Central
};

export function localParts(tzOffsetMinutes, nowUtcMs) {
  const local = new Date(nowUtcMs - normalizeOffset(tzOffsetMinutes) * 60_000);
  const key = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
  return { hour: local.getUTCHours(), day: local.getUTCDay(), dateKey: key };
}

export function isMorningDue(tzOffsetMinutes, nowUtcMs) {
  return localParts(tzOffsetMinutes, nowUtcMs).hour === MORNING_LOCAL_HOUR;
}

export function isSundayEveningDue(tzOffsetMinutes, nowUtcMs) {
  const p = localParts(tzOffsetMinutes, nowUtcMs);
  return p.day === 0 && p.hour === SUNDAY_LOCAL_HOUR;
}

export function yesterdayKey(dateKey) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Headline copy — no digits anywhere (tested). Action phrases echo the
// Morning Edition meanings in one clause.
export const ACTION_SNIPPETS = {
  fresh: "Good window to push.",
  steady: "Run the plan as written.",
  accumulating: "Favor the lower end of volume today.",
  deload: "Bank it — back off for a few days.",
};

export function editionPayload(state) {
  return {
    title: "The Morning Edition",
    body: `${state.stateName}. ${ACTION_SNIPPETS[state.stateKey] || ""}`.trim(),
    tag: "ovt-edition",
    url: "/?tab=Recovery",
  };
}

export function transitionPayload(prevName, state) {
  return {
    title: "Recovery state change",
    body: `${prevName} → ${state.stateName}.`,
    tag: "ovt-transition",
    url: "/?tab=Recovery",
  };
}

export const SUNDAY_PAYLOAD = {
  title: "The Sunday Edition is out",
  body: "Your week, one page — and the one change for the next.",
  tag: "ovt-sunday",
  url: "/?tab=Recovery",
};

/**
 * Decide the transition send. Consecutive days only: a prev state recorded
 * any earlier than yesterday is stale history, not news.
 */
export function detectTransition(prev, todayState, todayKeyLocal) {
  if (!prev || !prev.state_key || !prev.state_date) return null;
  if (prev.state_date !== yesterdayKey(todayKeyLocal)) return null;
  if (prev.state_key === todayState.stateKey) return null;
  if (todayState.stateKey === "calibrating" || prev.state_key === "calibrating") return null;
  const names = { fresh: "Fresh", steady: "Steady", accumulating: "Accumulating fatigue", deload: "Deload advised", absorbing: "Absorbing load" };
  return { from: names[prev.state_key] || prev.state_key, to: todayState.stateName };
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

  // Subscriptions with courier prefs; fall back if the migration hasn't run
  // (then both push types default to enabled, the push-reminders pattern).
  let listRes = await rest("push_subscriptions?select=user_id,endpoint,p256dh,auth,tz_offset_minutes,edition_enabled,transitions_enabled");
  if (!listRes.ok) {
    listRes = await rest("push_subscriptions?select=user_id,endpoint,p256dh,auth,tz_offset_minutes");
  }
  if (!listRes.ok) return new Response(JSON.stringify({ error: "Failed to load subscriptions" }), { status: 502 });
  const subs = (await listRes.json()).filter((s) => s.user_id);

  const nowMs = Date.now();
  // Group devices per user; a user is due when ANY of their devices is due
  // (per-device tz — a traveler's phone decides for itself at send time).
  const byUser = new Map();
  for (const s of subs) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id).push(s);
  }

  const send = async (sub, payload) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      return "sent";
    } catch (err) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" }).catch(() => {});
        return "pruned";
      }
      return "failed";
    }
  };

  // Claim an idempotency slot; true = this run owns the send.
  const claim = async (userId, dateKey, type, stateKey = null) => {
    const r = await rest("push_log?on_conflict=user_id,date,type", {
      method: "POST",
      headers: { "Prefer": "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ user_id: userId, date: dateKey, type, state_key: stateKey }),
    });
    if (!r.ok) return false; // table missing or error → do not send blind
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
  };

  const tally = { users: byUser.size, editions: 0, transitions: 0, sundays: 0, skippedNoData: 0, pruned: 0, failed: 0 };

  for (const [userId, devices] of byUser) {
    const morningDevices = devices.filter((d) => isMorningDue(d.tz_offset_minutes, nowMs));
    const sundayDevices = devices.filter((d) => isSundayEveningDue(d.tz_offset_minutes, nowMs));

    // ── Sunday evening announcement ─────────────────────────────────────────
    if (sundayDevices.length) {
      const { dateKey } = localParts(sundayDevices[0].tz_offset_minutes, nowMs);
      const targets = sundayDevices.filter((d) => d.edition_enabled !== false);
      if (targets.length && (await claim(userId, dateKey, "sunday"))) {
        for (const d of targets) {
          const r = await send(d, SUNDAY_PAYLOAD);
          if (r === "sent") tally.sundays++;
          else if (r === "pruned") tally.pruned++;
          else tally.failed++;
        }
      }
    }

    // ── Morning edition + transition ────────────────────────────────────────
    if (!morningDevices.length) continue;
    const wantsEdition = morningDevices.some((d) => d.edition_enabled !== false);
    const wantsTransition = morningDevices.some((d) => d.transitions_enabled !== false);
    if (!wantsEdition && !wantsTransition) continue;

    const { dateKey } = localParts(morningDevices[0].tz_offset_minutes, nowMs);

    // Fetch ~5 weeks of oura rows for the trend baseline.
    const since = new Date(nowMs - 40 * 86400000).toISOString().slice(0, 10);
    const rowsRes = await rest(`oura_data?user_id=eq.${userId}&date=gte.${since}&select=date,data_type,payload&order=date.desc&limit=400`);
    if (!rowsRes.ok) continue;
    const rows = await rowsRes.json();

    // Data-ready gate: TODAY's sleep row (their local today) must exist.
    const todaySleep = rows.some((r) => r.date === dateKey && r.data_type === "sleep");
    if (!todaySleep) { tally.skippedNoData++; continue; }

    const state = mirrorClassify(rows);
    if (state.stateKey === "calibrating") continue; // countdowns are app copy, not pushes

    // Yesterday's recorded state, for the transition check.
    const prevRes = await rest(`push_state?user_id=eq.${userId}&select=state_key,state_date`);
    const prev = prevRes.ok ? (await prevRes.json())[0] : null;
    const transition = detectTransition(prev, state, dateKey);

    // Record today's state regardless of sends — tomorrow needs the truth.
    await rest("push_state?on_conflict=user_id", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id: userId, state_key: state.stateKey, state_date: dateKey }),
    }).catch(() => {});

    if (wantsEdition && (await claim(userId, dateKey, "edition", state.stateKey))) {
      const payload = editionPayload(state);
      for (const d of morningDevices.filter((x) => x.edition_enabled !== false)) {
        const r = await send(d, payload);
        if (r === "sent") tally.editions++;
        else if (r === "pruned") tally.pruned++;
        else tally.failed++;
      }
    }
    if (wantsTransition && transition && (await claim(userId, dateKey, "transition", state.stateKey))) {
      const payload = transitionPayload(transition.from, state);
      for (const d of morningDevices.filter((x) => x.transitions_enabled !== false)) {
        const r = await send(d, payload);
        if (r === "sent") tally.transitions++;
        else if (r === "pruned") tally.pruned++;
        else tally.failed++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...tally }), { status: 200, headers: { "content-type": "application/json" } });
};

export const config = {
  // Hourly at :15 (offset from push-reminders' :30). Each run sends only to
  // users whose local clock is in the 07:xx morning window — or Sunday 17:xx
  // for the edition announcement.
  schedule: "15 * * * *",
};
