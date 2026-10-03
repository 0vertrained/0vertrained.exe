import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Toast } from "./Toast";

describe("Toast", () => {
  it("floats a Notice in a layer, keeping the tag's tone and status role", () => {
    const { container } = render(<Toast tag="RECORD">Bench Press est. max 221 lb (was 216).</Toast>);
    const layer = container.firstElementChild as HTMLElement;
    const notice = screen.getByRole("status");
    expect(layer.contains(notice)).toBe(true);
    expect(layer.children).toHaveLength(1);
    expect(notice.getAttribute("data-tone")).toBe("brass");
    expect(screen.getByText("[RECORD]")).toBeTruthy();
    expect(screen.getByText("Bench Press est. max 221 lb (was 216).")).toBeTruthy();
  });

  it("is muted for OFFLINE and dismissable by its own action", async () => {
    const onClick = vi.fn();
    render(<Toast tag="OFFLINE" action={{ label: "Undo", onClick }}>Offline. 3 days will sync when you are back.</Toast>);
    expect(screen.getByRole("status").getAttribute("data-tone")).toBe("muted");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(<Toast tag="RECORD" action={{ label: "Undo" }}>Bench Press est. max 221 lb (was 216).</Toast>);
    await expectNoA11yViolations(container);
  });
});
