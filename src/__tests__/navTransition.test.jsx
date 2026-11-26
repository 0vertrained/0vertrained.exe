// src/__tests__/navTransition.test.jsx
// Screens move the way they do on iPhone: one level down slides in from the
// right, back slides in from the left, a screen with Close rises, tabs don't
// move, and nothing moves with reduced motion. A sliding screen never lets
// the page scroll sideways.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { NavMain, navDirection } from "../ui/navTransition";

describe("navDirection", () => {
  const screenAt = (key, depth, modal = false) => ({ key, depth, modal });

  it("pushes one level down and pops back", () => {
    expect(navDirection(screenAt("Today", 0), screenAt("Recovery", 1))).toBe("push");
    expect(navDirection(screenAt("Recovery", 1), screenAt("Today", 0))).toBe("pop");
  });

  it("raises a screen that opens with Close, and just closes it", () => {
    expect(navDirection(screenAt("Today", 0), screenAt("Profile", 1, true))).toBe("rise");
    expect(navDirection(screenAt("Profile", 1, true), screenAt("Today", 0))).toBeNull();
    expect(navDirection(screenAt("Profile", 1, true), screenAt("Notifications", 2))).toBe("push");
    expect(navDirection(screenAt("Notifications", 2), screenAt("Profile", 1, true))).toBe("pop");
  });

  it("leaves tab changes and the same screen alone", () => {
    expect(navDirection(screenAt("Today", 0), screenAt("Train", 0))).toBeNull();
    expect(navDirection(screenAt("Today", 0), screenAt("Today", 0))).toBeNull();
    expect(navDirection(null, screenAt("Today", 0))).toBeNull();
  });
});

describe("NavMain", () => {
  let reduce;
  let landings;
  beforeEach(() => {
    reduce = false;
    landings = [];
    window.matchMedia = vi.fn(() => ({ matches: reduce }));
    HTMLElement.prototype.animate = vi.fn(() => {
      let land;
      const finished = new Promise((resolve) => { land = resolve; });
      landings.push(land);
      return { finished, cancel: vi.fn() };
    });
  });
  afterEach(() => {
    cleanup();
    delete window.matchMedia;
    delete HTMLElement.prototype.animate;
  });

  const Screen = ({ navKey, depth, modal = false, enabled = true }) => (
    <div data-testid="frame">
      <NavMain navKey={navKey} depth={depth} modal={modal} enabled={enabled}>content</NavMain>
    </div>
  );
  const firstFrame = () => HTMLElement.prototype.animate.mock.calls.at(-1)[0][0].transform;

  it("slides a screen one level down in from the right, and back in from the left", () => {
    const { rerender } = render(<Screen navKey="Today" depth={0} />);
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
    rerender(<Screen navKey="Recovery" depth={1} />);
    expect(firstFrame()).toBe("translateX(24%)");
    rerender(<Screen navKey="Today" depth={0} />);
    expect(firstFrame()).toBe("translateX(-16%)");
  });

  it("clips a sliding screen to its frame until it lands", async () => {
    const { rerender, getByTestId } = render(<Screen navKey="Today" depth={0} />);
    const frame = getByTestId("frame");
    rerender(<Screen navKey="Recovery" depth={1} />);
    expect(frame.style.overflowX).toBe("clip");
    await act(async () => { landings.at(-1)(); });
    expect(frame.style.overflowX).toBe("");
  });

  it("keeps the clip when a second slide starts before the first lands", async () => {
    const { rerender, getByTestId } = render(<Screen navKey="Today" depth={0} />);
    const frame = getByTestId("frame");
    rerender(<Screen navKey="Recovery" depth={1} />);
    rerender(<Screen navKey="Today" depth={0} />);
    await act(async () => { landings[0](); });
    expect(frame.style.overflowX).toBe("clip");
    await act(async () => { landings[1](); });
    expect(frame.style.overflowX).toBe("");
  });

  it("doesn't move with reduced motion or when switched off", () => {
    reduce = true;
    const { rerender } = render(<Screen navKey="Today" depth={0} />);
    rerender(<Screen navKey="Recovery" depth={1} />);
    reduce = false;
    rerender(<Screen navKey="Today" depth={0} enabled={false} />);
    rerender(<Screen navKey="Recovery" depth={1} enabled={false} />);
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  });
});
