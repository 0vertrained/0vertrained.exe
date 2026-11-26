// src/ui/sheetDrag.js
// Drag a sheet down to close it, as sheets close on iPhone. While its content
// is at the top, the sheet follows the finger down; let go past a third of
// its height, or with a quick flick, and it closes, otherwise it settles back.
// A sheet whose content scrolls keeps scrolling: the drag only starts at the
// top. With reduced motion the sheet still follows the finger, but closes or
// settles without animating.
//
// `handleHeight` limits the drag to the top of the sheet (the grabber and
// title row), for a sheet whose body scrolls on its own, like the coach.

import { useEffect, useRef } from "react";

// Movement below this is a tap's wobble, not a drag.
const START_PX = 8;
const CLOSE_FRACTION = 0.3;
const FLICK_PX_PER_MS = 0.6;
// Touch events closer together than this say nothing reliable about speed.
const MIN_SAMPLE_MS = 8;
const SETTLE_MS = 220;
const EASE = "cubic-bezier(.32, .72, 0, 1)";

export function useSheetDrag(ref, { onClose, enabled = true, handleHeight = null } = {}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const sheet = ref.current;
    if (!enabled || !sheet) return undefined;
    const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    const scrim = () => {
      const before = sheet.previousElementSibling;
      return before?.classList?.contains("scrim") ? before : null;
    };

    const paint = (offset, animate) => {
      const duration = animate ? `${SETTLE_MS}ms` : "0ms";
      sheet.style.animation = "none";
      sheet.style.transition = `transform ${duration} ${EASE}`;
      sheet.style.transform = offset ? `translateY(${offset}px)` : "";
      const backdrop = scrim();
      if (backdrop) {
        backdrop.style.animation = "none";
        backdrop.style.transition = `opacity ${duration} ease`;
        const height = sheet.offsetHeight || 1;
        backdrop.style.opacity = offset ? String(Math.max(0, 1 - offset / height)) : "";
      }
    };

    let gesture = null;
    let closing = 0;

    const onStart = (event) => {
      gesture = null;
      if (closing || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (handleHeight != null && touch.clientY - sheet.getBoundingClientRect().top > handleHeight) return;
      if (handleHeight == null && sheet.scrollTop > 0) return;
      gesture = { x: touch.clientX, y: touch.clientY, lastY: touch.clientY, lastT: event.timeStamp, offset: 0, velocity: 0, dragging: false };
    };

    const onMove = (event) => {
      if (!gesture) return;
      if (event.touches.length !== 1) { settle(gesture); gesture = null; return; }
      const touch = event.touches[0];
      const dy = touch.clientY - gesture.y;
      const dx = touch.clientX - gesture.x;
      if (!gesture.dragging) {
        // Up, or sideways (a slider, say): not ours.
        if (dy < -START_PX || (Math.abs(dx) > START_PX && Math.abs(dx) > Math.abs(dy))) { gesture = null; return; }
        if (dy < START_PX) return;
        gesture.dragging = true;
      }
      // The listener is not passive, so this holds the page still while the
      // sheet moves.
      if (event.cancelable) event.preventDefault();
      gesture.offset = Math.max(0, dy - START_PX);
      const dt = event.timeStamp - gesture.lastT;
      if (dt >= MIN_SAMPLE_MS) {
        gesture.velocity = (touch.clientY - gesture.lastY) / dt;
        gesture.lastY = touch.clientY;
        gesture.lastT = event.timeStamp;
      }
      paint(gesture.offset, false);
    };

    const settle = (done) => { if (done?.dragging) paint(0, !reduced()); };

    const onEnd = (event) => {
      const done = gesture;
      gesture = null;
      if (!done?.dragging) return;
      const height = sheet.offsetHeight || 0;
      const close = event.type === "touchend" && (done.offset > height * CLOSE_FRACTION || done.velocity > FLICK_PX_PER_MS);
      if (!close) { settle(done); return; }
      const closeNow = () => {
        closing = 0;
        onCloseRef.current?.();
        // A parent that keeps the sheet open gets it back in place.
        requestAnimationFrame(() => { if (sheet.isConnected) paint(0, false); });
      };
      if (reduced()) { closeNow(); return; }
      paint(height, true);
      closing = window.setTimeout(closeNow, SETTLE_MS);
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    return () => {
      if (closing) window.clearTimeout(closing);
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, enabled, handleHeight]);
}

export default useSheetDrag;
