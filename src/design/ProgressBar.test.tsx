import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("is a labelled progressbar with the value as a percentage", () => {
    render(<ProgressBar value={0.58} label="Training progress" />);
    const bar = screen.getByRole("progressbar", { name: "Training progress" });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("58");
    expect(bar.getAttribute("data-kind")).toBe("objective");
  });

  it("clamps aria-valuenow to 0–100 and treats NaN as empty", () => {
    render(
      <>
        <ProgressBar value={1.7} label="Over" />
        <ProgressBar value={-0.4} label="Under" />
        <ProgressBar value={Number.NaN} label="Nan" />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Over" }).getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByRole("progressbar", { name: "Under" }).getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByRole("progressbar", { name: "Nan" }).getAttribute("aria-valuenow")).toBe("0");
  });

  it("drives the fill through the --ot-value custom property", () => {
    render(<ProgressBar kind="xp" value={0.25} label="XP 50 of 200" />);
    const bar = screen.getByRole("progressbar", { name: "XP 50 of 200" });
    expect(bar.getAttribute("data-kind")).toBe("xp");
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.getPropertyValue("--ot-value")).toBe("0.25");
  });

  it("has no axe violations for the three kinds and sizes", async () => {
    const { container } = render(
      <div>
        <ProgressBar kind="xp" size="thin" value={0.3} label="XP" />
        <ProgressBar kind="objective" value={0.5} label="Run progress" />
        <ProgressBar kind="timer" size="lg" value={1} label="Rest remaining" />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
