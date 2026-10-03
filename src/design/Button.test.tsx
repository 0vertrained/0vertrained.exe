import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a type=button with its label and calls onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Begin quest</Button>);
    const btn = screen.getByRole("button", { name: "Begin quest" });
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("aria-busy")).toBeNull();
    expect(btn.getAttribute("data-primary")).toBeNull();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("marks the primary variant for the one-primary-per-screen test", () => {
    render(<Button variant="primary">Complete set 2 of 4</Button>);
    expect(screen.getByRole("button", { name: "Complete set 2 of 4" }).getAttribute("data-primary")).toBe("true");
  });

  it("stays readable but inert when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Quest cleared +130 XP</Button>);
    const btn = screen.getByRole("button", { name: "Quest cleared +130 XP" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is busy and disabled while loading, keeping its label in the tree", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Saving</Button>);
    const btn = screen.getByRole("button", { name: "Saving" }) as HTMLButtonElement;
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.disabled).toBe(true);
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("adds a decorative 20px icon before the label", () => {
    render(<Button icon="plus">Add set</Button>);
    const svg = screen.getByRole("button", { name: "Add set" }).querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("20");
  });

  it("passes native attributes through", () => {
    render(<Button type="submit" aria-describedby="hint">Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.getAttribute("type")).toBe("submit");
    expect(btn.getAttribute("aria-describedby")).toBe("hint");
  });

  it("has no axe violations across variants and states", async () => {
    const { container } = render(
      <div>
        <Button variant="primary" size="lg" full>Begin quest</Button>
        <Button variant="secondary" icon="swap">Swap</Button>
        <Button variant="ghost" size="sm">Skip</Button>
        <Button variant="danger">Delete account</Button>
        <Button disabled>Quest cleared +130 XP</Button>
        <Button loading>Saving</Button>
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
