// src/__tests__/sheetDrag.test.jsx
// A sheet follows a downward drag that starts while its content is at the
// top. Let go far enough down, or with a flick, and it closes; otherwise it
// settles back. Scrolling the content and dragging up stay scrolling.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { useSheetDrag } from "../ui/sheetDrag";

function TestSheet({ onClose, handleHeight = null }) {
  const ref = useRef(null);
  useSheetDrag(ref, { onClose, handleHeight });
  return (
    <>
      <div className="scrim" data-testid="scrim" />
      <section ref={ref} className="sheet" data-testid="sheet"><p>Body</p></section>
    </>
  );
}

function touch(target, type, y, t) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: 100, clientY: y }] });
  Object.defineProperty(event, "timeStamp", { value: t });
  target.dispatchEvent(event);
  return event;
}

// [y, ms] pairs: the first starts the touch, the rest move it, then it lifts.
function drag(target, points) {
  const [[y0, t0], ...moves] = points;
  touch(target, "touchstart", y0, t0);
  const events = moves.map(([y, t]) => touch(target, "touchmove", y, t));
  const [, lastT] = points[points.length - 1];
  touch(target, "touchend", 0, lastT + 16);
  return events;
}

let reduceMotion = true;

beforeEach(() => {
  reduceMotion = true;
  window.matchMedia = vi.fn(() => ({ matches: reduceMotion }));
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function height() {
    return this.classList.contains("sheet") ? 400 : 0;
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => { fn(); return 0; });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete window.matchMedia;
});

describe("useSheetDrag", () => {
  it("closes after a drag past a third of the sheet", () => {
    const onClose = vi.fn();
    render(<TestSheet onClose={onClose} />);
    drag(screen.getByTestId("sheet"), [[100, 0], [150, 100], [300, 400]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes after a quick flick", () => {
    const onClose = vi.fn();
    render(<TestSheet onClose={onClose} />);
    drag(screen.getByTestId("sheet"), [[100, 0], [110, 10], [150, 40]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("settles back after a short, slow drag", () => {
    const onClose = vi.fn();
    render(<TestSheet onClose={onClose} />);
    const sheet = screen.getByTestId("sheet");
    drag(sheet, [[100, 0], [120, 200], [140, 400]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
  });

  it("follows the finger and fades the backdrop, holding the page still", () => {
    render(<TestSheet onClose={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    touch(sheet, "touchstart", 100, 0);
    const move = touch(sheet, "touchmove", 208, 200);
    expect(sheet.style.transform).toBe("translateY(100px)");
    expect(Number(screen.getByTestId("scrim").style.opacity)).toBeCloseTo(0.75);
    expect(move.defaultPrevented).toBe(true);
  });

  it("leaves a tap's small wobble alone", () => {
    render(<TestSheet onClose={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    touch(sheet, "touchstart", 100, 0);
    const move = touch(sheet, "touchmove", 104, 30);
    expect(move.defaultPrevented).toBe(false);
    expect(sheet.style.transform).toBe("");
  });

  it("lets content that is scrolled down keep scrolling", () => {
    const onClose = vi.fn();
    render(<TestSheet onClose={onClose} />);
    const sheet = screen.getByTestId("sheet");
    Object.defineProperty(sheet, "scrollTop", { configurable: true, value: 50 });
    const [move] = drag(sheet, [[100, 0], [300, 100]]);
    expect(move.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves an upward drag to scrolling", () => {
    const onClose = vi.fn();
    render(<TestSheet onClose={onClose} />);
    const moves = drag(screen.getByTestId("sheet"), [[300, 0], [250, 50], [100, 100]]);
    expect(moves.some((event) => event.defaultPrevented)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with a handle, only drags that start on it count", () => {
    const onClose = vi.fn();
    render(<TestSheet onClose={onClose} handleHeight={64} />);
    const sheet = screen.getByTestId("sheet");
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 300, bottom: 400, width: 300, height: 400 });
    drag(sheet, [[200, 0], [260, 100], [500, 400]]);
    expect(onClose).not.toHaveBeenCalled();
    drag(sheet, [[20, 1000], [80, 1100], [320, 1400]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("slides away before closing when motion is allowed", () => {
    reduceMotion = false;
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<TestSheet onClose={onClose} />);
    const sheet = screen.getByTestId("sheet");
    drag(sheet, [[100, 0], [150, 100], [300, 400]]);
    expect(sheet.style.transform).toBe("translateY(400px)");
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(220);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
