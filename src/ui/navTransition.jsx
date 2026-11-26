// src/ui/navTransition.jsx
// Screens move the way they do on iPhone. A screen one level down slides in
// from the right; going back, the screen you return to slides in from the
// left. A screen that opens with Close rises into place, and closing it just
// shows what was under it. Tab changes don't move. With reduced motion,
// nothing moves.
//
// The screen being left is already gone by the time this runs, so only the
// arriving one moves, over a short distance with a fade. While it slides
// sideways it sticks out past the edge, so the element around it clips it
// until it lands; otherwise the page could scroll sideways for a moment.
import { useLayoutEffect, useRef } from "react";

const MOTION = {
  push: [{ transform: "translateX(24%)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }],
  pop: [{ transform: "translateX(-16%)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }],
  rise: [{ transform: "translateY(24px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
};
const TIMING = { duration: 320, easing: "cubic-bezier(.32, .72, 0, 1)" };

/**
 * How to move between two screens, each { key, depth, modal }: "push",
 * "pop", "rise" or null. Depth is how many levels down a screen is; modal
 * marks one that opens with Close.
 */
export function navDirection(previous, next) {
  if (!previous || !next || previous.key === next.key) return null;
  if (next.depth > previous.depth) return next.modal ? "rise" : "push";
  if (next.depth < previous.depth) return previous.modal ? null : "pop";
  return null;
}

/** A ref for the element that holds the screen, moved when the screen changes. */
export function useNavTransition({ key, depth = 0, modal = false, enabled = true, initial = null }) {
  const ref = useRef(null);
  const previous = useRef(null);
  const running = useRef(null);
  useLayoutEffect(() => {
    const before = previous.current;
    const next = { key, depth, modal };
    previous.current = next;
    const element = ref.current;
    if (!enabled || !element || typeof element.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const direction = before ? navDirection(before, next) : initial;
    if (!direction || !MOTION[direction]) return;
    running.current?.cancel?.();
    const frame = element.parentElement;
    if (frame && direction !== "rise") frame.style.overflowX = "clip";
    const animation = element.animate(MOTION[direction], TIMING);
    running.current = animation;
    const land = () => {
      if (frame && running.current === animation) frame.style.overflowX = "";
    };
    if (animation?.finished) animation.finished.then(land, land);
    else land();
  }, [key, depth, modal, enabled, initial]);
  return ref;
}

/** The app's <main>, moving as the screen inside it changes. */
export function NavMain({ navKey, depth, modal, enabled, children, ...rest }) {
  const ref = useNavTransition({ key: navKey, depth, modal, enabled });
  return <main ref={ref} {...rest}>{children}</main>;
}
