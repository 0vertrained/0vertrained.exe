import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { SegmentedControl } from "./SegmentedControl";

const units = [{ value: "lb", label: "lb · mi" }, { value: "kg", label: "kg · km" }];

describe("SegmentedControl", () => {
  it("is a labelled radiogroup whose click selects and reports", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Units" options={units} defaultValue="lb" onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Units" });
    const [lb, kg] = within(group).getAllByRole("radio");
    expect(lb?.getAttribute("aria-checked")).toBe("true");
    expect(kg?.getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByRole("radio", { name: "kg · km" }));
    expect(onChange).toHaveBeenCalledWith("kg");
    expect(kg?.getAttribute("aria-checked")).toBe("true");
    expect(lb?.getAttribute("aria-checked")).toBe("false");
  });

  it("moves the selection with the arrow keys, wrapping, and Home/End", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl inline label="Slept" options={["poorly", "fine", "well"]} defaultValue="fine" onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "fine" }));
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("well");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "well" }));
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("poorly");
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("well");
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith("fine");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("well");
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("poorly");
    expect(screen.getByRole("radio", { name: "poorly" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "poorly" }));
  });

  it("leaves a controlled value to its parent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Units" options={units} value="lb" onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "kg · km" }));
    expect(onChange).toHaveBeenCalledWith("kg");
    expect(screen.getByRole("radio", { name: "lb · mi" }).getAttribute("aria-checked")).toBe("true");
  });

  it("renders the inline label column, can be disabled and stays accessible", async () => {
    const { container } = render(
      <>
        <SegmentedControl label="Units" options={units} defaultValue="lb" />
        <SegmentedControl inline label="Sore" options={["no", "some", "very"]} defaultValue="very" />
        <SegmentedControl inline label="Energy" options={["low", "ok", "high"]} disabled />
      </>,
    );
    expect(screen.getByText("Sore")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Sore" })).toBeTruthy();
    for (const r of within(screen.getByRole("radiogroup", { name: "Energy" })).getAllByRole("radio")) {
      expect(r).toHaveProperty("disabled", true);
      expect(r.getAttribute("aria-checked")).toBe("false");
    }
    await expectNoA11yViolations(container);
  });
});
