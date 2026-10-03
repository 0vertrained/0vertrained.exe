import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { mmss } from "./time";
import { TimerDisplay } from "./TimerDisplay";

describe("mmss", () => {
  it("formats seconds as mm:ss without wrapping at an hour", () => {
    expect(mmss(0)).toBe("00:00");
    expect(mmss(90)).toBe("01:30");
    expect(mmss(3600)).toBe("60:00");
    expect(mmss(5)).toBe("00:05");
    expect(mmss(599)).toBe("09:59");
  });

  it("rounds to the second and never shows a negative or NaN clock", () => {
    expect(mmss(89.6)).toBe("01:30");
    expect(mmss(-4)).toBe("00:00");
    expect(mmss(Number.NaN)).toBe("00:00");
  });
});

describe("TimerDisplay", () => {
  it("is a silent timer named by its label", async () => {
    const { container } = render(
      <>
        <TimerDisplay seconds={90} label="Rest remaining" />
        <TimerDisplay seconds={1263} size="md" label="Elapsed" />
      </>,
    );
    const rest = screen.getByRole("timer", { name: "Rest remaining" });
    expect(rest.textContent).toBe("01:30");
    expect(rest.tagName).toBe("TIME");
    expect(rest.getAttribute("aria-live")).toBe("off");
    expect(screen.getByRole("timer", { name: "Elapsed" }).textContent).toBe("21:03");
    await expectNoA11yViolations(container);
  });

  it("updates as the seconds change", () => {
    const { rerender } = render(<TimerDisplay seconds={0} label="Elapsed" />);
    expect(screen.getByRole("timer").textContent).toBe("00:00");
    rerender(<TimerDisplay seconds={61} label="Elapsed" />);
    expect(screen.getByRole("timer").textContent).toBe("01:01");
  });
});
