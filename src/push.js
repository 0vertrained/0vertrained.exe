// src/push.js
// Web Push client. Registers the notification-only service worker,
// subscribes with the public VAPID key, and stores the subscription server-
// side via /api/push-subscribe (JWT-verified — see netlify/functions/
// push-subscribe.js). iOS note: Apple only delivers Web Push to apps ADDED
// TO THE HOME SCREEN on iOS 16.4+ — plain Safari tabs never get pushes.

import { supabase } from "./supabaseClient";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

export function pushSupportState() {
  if (typeof window === "undefined") return { supported: false, reason: "no window" };
  if (!("serviceWorker" in navigator)) return { supported: false, reason: "no service worker support" };
  if (!("PushManager" in window)) {
    // The usual cause on iPhone: running in a Safari tab instead of from the
    // Home Screen icon. Surface that specifically — it's actionable.
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
    if (iOS && !standalone) return { supported: false, reason: "On iPhone, notifications require adding the app to your Home Screen first (Share → Add to Home Screen), then enabling from the installed app." };
    return { supported: false, reason: "push not supported in this browser" };
  }
  if (!VAPID_PUBLIC_KEY) return { supported: false, reason: "Push reminders are not enabled in this beta build." };
  return { supported: true, reason: null };
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function authedFetch(path, body) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Not logged in");
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const out = await res.json().catch(() => ({}));
    throw new Error(out?.error || `Request failed (${res.status})`);
  }
  return res.json().catch(() => ({}));
}

export async function getExistingSubscription() {
  const state = pushSupportState();
  if (!state.supported) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function enablePush() {
  const state = pushSupportState();
  if (!state.supported) throw new Error(state.reason);

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted");

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  // Send the device's UTC offset so the reminder scheduler can hit
  // this subscriber's local evening instead of assuming everyone is Central.
  await authedFetch("/api/push-subscribe", {
    action: "subscribe",
    subscription: sub.toJSON(),
    tz_offset_minutes: new Date().getTimezoneOffset(),
  });
  return true;
}

// Re-register this device's existing subscription with the server.
// Before v19.4 the registration POST never reached push-subscribe (the
// endpoint wasn't routed), so a device that turned notifications on holds a
// subscription the server never stored: the card says "On" and nothing ever
// arrives. Once per page load, a device with permission granted and a
// subscription in hand sends it again. The function upserts on the endpoint,
// and preferences already stored are left alone (none are sent here).
let resyncStarted = false;
export async function resyncPushSubscription() {
  if (resyncStarted) return false;
  resyncStarted = true;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const sub = await getExistingSubscription();
  if (!sub) return false;
  await authedFetch("/api/push-subscribe", {
    action: "subscribe",
    subscription: sub.toJSON(),
    tz_offset_minutes: new Date().getTimezoneOffset(),
  });
  return true;
}

export async function disablePush() {
  const sub = await getExistingSubscription();
  if (sub) {
    try { await authedFetch("/api/push-subscribe", { action: "unsubscribe", subscription: sub.toJSON() }); } catch {}
    await sub.unsubscribe();
  }
  return true;
}

/**
 * Courier preferences — per-type push toggles, applied to all the
 * user's devices server-side. The endpoint is only needed to satisfy the
 * function's payload contract; the update keys off the JWT-verified user.
 * @param {{edition_enabled?: boolean, transitions_enabled?: boolean, reminders_enabled?: boolean}} prefs
 */
export async function setPushPrefs(prefs) {
  const sub = await getExistingSubscription();
  if (!sub) throw new Error("Enable notifications first");
  return authedFetch("/api/push-subscribe", { action: "prefs", subscription: sub.toJSON(), ...prefs });
}
