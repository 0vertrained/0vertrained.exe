import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("toggles aria-checked and reports the new state when uncontrolled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Rest-timer sound" defaultChecked onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Rest-timer sound" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await user.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(onChange).toHaveBeenLastCalledWith(false);
    await user.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("leaves a controlled switch to its parent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<Switch label="Haptics" checked={false} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Haptics" });
    await user.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    rerender(<Switch label="Haptics" checked onChange={onChange} />);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("is labelled by the row text including the sublabel, and can be disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <>
        <Switch label="Ill or injured" sublabel="9 of 14 pause days left this quarter" defaultChecked={false} />
        <Switch label="Haptics" disabled defaultChecked onChange={onChange} />
      </>,
    );
    // jsdom joins the two block spans without a space; the browser does not.
    const ill = screen.getByRole("switch", { name: /^Ill or injured.*9 of 14 pause days left this quarter$/ });
    expect(ill.getAttribute("aria-checked")).toBe("false");
    expect(ill.getAttribute("aria-labelledby")).toBe("ot-switch-ill-or-injured-label");
    const haptics = screen.getByRole("switch", { name: "Haptics" });
    expect(haptics).toHaveProperty("disabled", true);
    await user.click(haptics);
    expect(onChange).not.toHaveBeenCalled();
    await expectNoA11yViolations(container);
  });
});
