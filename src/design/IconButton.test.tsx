import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("is a button named by its label around a decorative icon", async () => {
    const onClick = vi.fn();
    render(<IconButton name="close" label="Close" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(btn.querySelector("svg")?.getAttribute("width")).toBe("24");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(<IconButton name="more" label="More" disabled onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "More" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("rotates the chevron for back", () => {
    render(<IconButton name="chevron" label="Back" rotate={180} />);
    const svg = screen.getByRole("button", { name: "Back" }).querySelector("svg") as SVGElement;
    expect(svg.style.transform).toBe("rotate(180deg)");
  });

  it("has no axe violations plain, outlined and disabled", async () => {
    const { container } = render(
      <div>
        <IconButton name="exit" label="Exit" outlined />
        <IconButton name="close" label="Close" />
        <IconButton name="more" label="More" disabled />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
