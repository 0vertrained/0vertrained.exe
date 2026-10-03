// Focus management for the modal layers (Sheet, Dialog). On mount it moves
// focus inside the container, keeps Tab and Shift+Tab cycling within it,
// turns Escape into `onEscape`, and on unmount hands focus back to whatever
// had it before. Traps stack: with a Dialog above a Sheet only the topmost
// trap handles keys. The app layer marks the background inert; this hook does
// not touch aria-hidden.
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface FocusTrapOptions {
  /** Containers searched in order on mount: the first focusable element inside the first one that has any receives focus. */
  initialFocus?: RefObject<HTMLElement>[];
  /** Receives focus when no `initialFocus` container holds a focusable element (give it tabIndex={-1}). */
  fallback?: RefObject<HTMLElement>;
  onEscape?: () => void;
}

/** Tabbable elements inside `root`, in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getAttribute("aria-hidden") !== "true");
}

const stack: HTMLElement[] = [];

export function useFocusTrap(ref: RefObject<HTMLElement>, options: FocusTrapOptions = {}): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement;
    stack.push(node);

    const { initialFocus = [], fallback } = latest.current;
    let target: HTMLElement | undefined;
    for (const scope of initialFocus) {
      const first = scope.current ? focusableIn(scope.current)[0] : undefined;
      if (first) {
        target = first;
        break;
      }
    }
    (target ?? fallback?.current ?? focusableIn(node)[0] ?? node).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== node) return;
      if (e.key === "Escape") {
        const { onEscape } = latest.current;
        if (onEscape) {
          e.preventDefault();
          onEscape();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableIn(node);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && node.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const i = stack.lastIndexOf(node);
      if (i >= 0) stack.splice(i, 1);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [ref]);
}
