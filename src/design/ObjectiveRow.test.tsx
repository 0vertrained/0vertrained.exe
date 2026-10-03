import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { ObjectiveRow } from "./ObjectiveRow";

describe("ObjectiveRow", () => {
  it("renders a not-started row with a string progress and its XP", () => {
    const { container } = render(<ObjectiveRow label="Run" sublabel="Easy pace" progress="25 min" xp={60} />);
    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("not-started");
    expect(screen.getByText("Run")).toBeTruthy();
    expect(screen.getByText("Easy pace")).toBeTruthy();
    expect(screen.getByText("25 min")).toBeTruthy();
    expect(screen.getByText("+60 XP")).toBeTruthy();
    expect(screen.getByText("Not started.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders in-progress with a {done,total,unit} progress and a thin bar", () => {
    const { container } = render(<ObjectiveRow label="Training" state="in-progress" progress={{ done: 7, total: 12, unit: "sets" }} xp={120} />);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("in-progress");
    expect(screen.getByText("7/12 sets")).toBeTruthy();
    expect(screen.getByText("+120 XP")).toBeTruthy();
    expect(screen.getByText("In progress.")).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Training progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("58");
    expect(bar.getAttribute("data-kind")).toBe("objective");
  });

  it("renders done with a hidden check and the earned XP", () => {
    const { container } = render(<ObjectiveRow label="Status check" state="done" xp={10} />);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("done");
    expect(screen.getByText("Done.")).toBeTruthy();
    expect(screen.getByText("+10 XP")).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("omits progress and XP when neither is given", () => {
    render(<ObjectiveRow label="Recovery" />);
    expect(screen.queryByText(/XP/)).toBeNull();
    expect(screen.getByText("Recovery")).toBeTruthy();
  });

  it("becomes a button when onClick is given", async () => {
    const onClick = vi.fn();
    render(<ObjectiveRow label="Training" state="in-progress" progress={{ done: 7, total: 12 }} xp={120} onClick={onClick} />);
    const row = screen.getByRole("button", { name: /Training/ });
    expect(row.getAttribute("type")).toBe("button");
    expect(screen.getByText("7/12")).toBeTruthy();
    await userEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations across the three states and the button form", async () => {
    const { container } = render(
      <div>
        <ObjectiveRow label="Status check" state="done" xp={10} />
        <ObjectiveRow label="Training" state="in-progress" progress={{ done: 7, total: 12, unit: "sets" }} xp={120} />
        <ObjectiveRow label="Run" sublabel="Easy pace" progress="25 min" xp={60} />
        <ObjectiveRow label="Recovery" xp={20} onClick={() => {}} />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
