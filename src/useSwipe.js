import { useRef } from "react";

// ─── Swipe gesture hook ───────────────────────────────────────────────────
/**
 * Hook to detect left and right swipe gestures on touch events.
 * Returns touch handlers to spread on a target element.
 * 
 * @param {Function} onSwipeLeft - Callback when user swipes left (threshold pixels)
 * @param {Function} onSwipeRight - Callback when user swipes right (threshold pixels)
 * @param {number} threshold - Minimum pixels to register as a swipe (default: 50)
 * @returns {Object} Touch event handlers: { onTouchStart, onTouchMove, onTouchEnd }
 */
export function useSwipe(onSwipeLeft, onSwipeRight, threshold = 50) {
  const touchStart = useRef(null);
  const touchEnd   = useRef(null);

  const onTouchStart = (e) => {
    touchStart.current = e.targetTouches[0].clientX;
    touchEnd.current   = null;
  };
  const onTouchMove  = (e) => { touchEnd.current = e.targetTouches[0].clientX; };
  const onTouchEnd   = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const dist = touchStart.current - touchEnd.current;
    if (Math.abs(dist) < threshold) return;
    if (dist > 0) onSwipeLeft();
    else onSwipeRight();
  };
  return { onTouchStart, onTouchMove, onTouchEnd };
}
