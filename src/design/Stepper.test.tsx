import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("steps by `step` and reports the new value when uncontrolled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stepper label="Reps" defaultValue={6} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Increase Reps" }));
    expect(onChange).toHaveBeenLastCalledWith(7);
    expect(screen.getByRole("textbox", { name: "Reps" })).toHaveProperty("value", "7");
    await user.click(screen.getByRole("button", { name: "Decrease Reps" }));
    expect(onChange).toHaveBeenLastCalledWith(6);
  });

  it("clamps to min and max, disabling the button at the edge", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stepper label="Reps" defaultValue={30} min={0} max={30} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Increase Reps" })).toHaveProperty("disabled", true);
    const input = screen.getByRole("textbox", { name: "Reps" });
    await user.clear(input);
    await user.type(input, "99");
    expect(onChange).toHaveBeenLastCalledWith(30);
    await user.tab();
    expect(input).toHaveProperty("value", "30");
  });

  it("takes typed decimals and leaves a controlled value to the parent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stepper label="Load" unit="lb" value={185} step={5} onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Load, lb" });
    expect(input.getAttribute("inputmode")).toBe("decimal");
    await user.click(screen.getByRole("button", { name: "Increase Load" }));
    expect(onChange).toHaveBeenLastCalledWith(190);
    expect(input).toHaveProperty("value", "185");
    await user.clear(input);
    await user.type(input, "12.5");
    expect(onChange).toHaveBeenLastCalledWith(12.5);
  });

  it("formats the display, derives ids from the label and stays accessible", async () => {
    const { container } = render(
      <>
        <Stepper label="Hold" unit="sec" defaultValue={45} step={5} format={(v) => `0:${v}`} />
        <Stepper label="Reps" defaultValue={0} min={0} />
        <Stepper id="load" label="Load" unit="lb" defaultValue={187.5} step={2.5} disabled />
      </>,
    );
    const hold = screen.getByRole("textbox", { name: "Hold, sec" });
    expect(hold).toHaveProperty("value", "0:45");
    expect(hold.id).toBe("ot-stepper-hold");
    expect(screen.getByRole("button", { name: "Decrease Reps" })).toHaveProperty("disabled", true);
    const load = screen.getByRole("textbox", { name: "Load, lb" });
    expect(load).toHaveProperty("value", "187.5");
    expect(load.id).toBe("load");
    expect(load).toHaveProperty("disabled", true);
    await expectNoA11yViolations(container);
  });
});
