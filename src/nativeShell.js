// src/nativeShell.js
// What the page does differently inside the iPhone app, set up once at start.
//
// - html.native-app lets the stylesheets tell the app from a browser.
// - A swipe in from the left edge goes back, as in iOS apps: it presses the
//   screen's own Back button, so it does exactly what Back does. A round
//   arrow follows the finger and fills in once letting go will go back. It
//   never closes a full-screen flow or acts behind an open sheet.
// - The screens each tab opens are loaded early. The app loads the site over
//   the network, and without this the first visit to a tab waits on its code.

import { isNativeApp } from "./native";

const EDGE_PX = 24;
const START_PX = 12;
const BACK_PX = 72;
const CUE_PX = 40;

// The same modules the lazy screens load, so these fill the same chunks.
const SCREENS = [
  () => import("./TrainTab"),
  () => import("./FuelTab"),
  () => import("./ProgressTab"),
  () => import("./RecoveryDashboard"),
  () => import("./ProfileScreen"),
  () => import("./SettingsScreen"),
  () => import("./Coach"),
  () => import("./SessionMode"),
  () => import("./CardioSession.jsx"),
  () => import("./BlockScreen"),
  () => import("./ProgressHistory"),
];

export function prefetchScreens(importers = SCREENS) {
  for (const load of importers) {
    try { Promise.resolve(load()).catch(() => {}); } catch { /* loaded on first visit instead */ }
  }
}

function shown(element) {
  return element.getClientRects().length > 0;
}

// The Back button a swipe would press, or none: not while a sheet is open,
// and not when a full-screen flow without its own Back is up.
export function swipeBackTarget(doc = document) {
  if (doc.querySelector(".sheet")) return null;
  const buttons = Array.from(doc.querySelectorAll('[data-nav="back"]')).filter(shown);
  const button = buttons[buttons.length - 1] || null;
  if (!button) return null;
  const flows = doc.querySelectorAll(".flow-screen");
  const flow = flows[flows.length - 1];
  if (flow && !flow.contains(button)) return null;
  return button;
}

function makeCue(doc) {
  const cue = doc.createElement("div");
  cue.setAttribute("aria-hidden", "true");
  cue.dataset.edgeBack = "";
  Object.assign(cue.style, {
    position: "fixed", left: "0", top: "0", width: `${CUE_PX}px`, height: `${CUE_PX}px`,
    borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line)",
    boxShadow: "var(--sh-toast)", zIndex: "60", pointerEvents: "none",
  });
  cue.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';
  doc.body.appendChild(cue);
  return cue;
}

function drawCue(cue, y, dx) {
  const armed = dx >= BACK_PX;
  const x = Math.min(dx, BACK_PX) * 0.6 - CUE_PX + 8;
  cue.style.transform = `translate(${x}px, ${y - CUE_PX / 2}px)`;
  cue.style.opacity = String(Math.min(1, dx / BACK_PX + 0.2));
  cue.style.background = armed ? "var(--ink)" : "var(--surface)";
  cue.style.color = armed ? "var(--bg)" : "var(--ink)";
}

export function installEdgeSwipeBack(doc = document) {
  const onStart = (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (touch.clientX > EDGE_PX) return;
    const target = swipeBackTarget(doc);
    if (!target) return;
    const start = { x: touch.clientX, y: touch.clientY };
    let tracking = false;
    let dx = 0;
    let cue = null;

    const cleanup = () => {
      doc.removeEventListener("touchmove", onMove);
      doc.removeEventListener("touchend", onEnd);
      doc.removeEventListener("touchcancel", cleanup);
      cue?.remove();
      cue = null;
    };
    const onMove = (moveEvent) => {
      const point = moveEvent.touches[0];
      dx = point.clientX - start.x;
      const dy = point.clientY - start.y;
      if (!tracking) {
        // A scroll that started at the edge stays a scroll.
        if (Math.abs(dy) > START_PX && Math.abs(dy) >= dx) { cleanup(); return; }
        if (dx < START_PX) return;
        tracking = true;
        cue = makeCue(doc);
      }
      if (moveEvent.cancelable) moveEvent.preventDefault();
      drawCue(cue, point.clientY, dx);
    };
    const onEnd = () => {
      const goBack = tracking && dx >= BACK_PX && target.isConnected;
      cleanup();
      if (goBack) target.click();
    };

    doc.addEventListener("touchmove", onMove, { passive: false });
    doc.addEventListener("touchend", onEnd);
    doc.addEventListener("touchcancel", cleanup);
  };

  doc.addEventListener("touchstart", onStart, { passive: true });
  return () => doc.removeEventListener("touchstart", onStart);
}

// Called once from main.jsx. Does nothing in a browser.
export function startNativeShell({ doc = document, win = window } = {}) {
  if (!isNativeApp()) return false;
  doc.documentElement.classList.add("native-app");
  installEdgeSwipeBack(doc);
  win.setTimeout(() => prefetchScreens(), 1500);
  return true;
}

export default startNativeShell;
