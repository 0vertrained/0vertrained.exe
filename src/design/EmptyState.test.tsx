import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders tag, heading, body and one primary action", async () => {
    const onClick = vi.fn();
    render(<EmptyState tag="RECORDS" title="No records yet" body="Your first logged set becomes your first record." action={{ label: "Begin quest", onClick }} />);
    expect(screen.getByText("[RECORDS]")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "No records yet" })).toBeTruthy();
    expect(screen.getByText("Your first logged set becomes your first record.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    const btn = screen.getByRole("button", { name: "Begin quest" });
    expect(btn.getAttribute("data-primary")).toBe("true");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the error boundary as an alert with a secondary action", () => {
    render(<EmptyState error title="Something broke." body="Your data is safe." action={{ label: "Reload", variant: "secondary" }} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something broke.");
    expect(screen.getByRole("heading", { name: "Something broke." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" }).getAttribute("data-primary")).toBeNull();
    expect(screen.queryByText(/^\[/)).toBeNull();
  });

  it("omits the optional parts", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("paragraph")).toBeNull();
  });

  it("has no axe violations empty or broken", async () => {
    const { container } = render(
      <div>
        <EmptyState tag="RECORDS" title="No records yet" body="Your first logged set becomes your first record." action={{ label: "Begin quest" }} />
        <EmptyState error title="Something broke." body="Your data is safe." action={{ label: "Reload", variant: "secondary" }} />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
