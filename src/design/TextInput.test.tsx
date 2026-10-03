import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { TextInput } from "./TextInput";

describe("TextInput", () => {
  it("labels the field, passes attributes through and reports typed values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const onKeyDown = vi.fn();
    render(<TextInput label="Username" placeholder="e.g. rami" autoComplete="username" name="user" onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown} />);
    const input = screen.getByRole("textbox", { name: "Username" });
    expect(input.getAttribute("placeholder")).toBe("e.g. rami");
    expect(input.getAttribute("autocomplete")).toBe("username");
    expect(input.getAttribute("name")).toBe("user");
    expect(input.getAttribute("type")).toBe("text");
    await user.type(input, "ra");
    expect(onChange.mock.calls).toEqual([["r"], ["ra"]]);
    expect(input).toHaveProperty("value", "ra");
    expect(onKeyDown).toHaveBeenCalledTimes(2);
    await user.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("keeps a controlled value and takes inputMode and type", () => {
    render(<TextInput label="Bodyweight" inputMode="decimal" type="tel" value="182" hint="Optional." />);
    const input = screen.getByRole("textbox", { name: "Bodyweight" });
    expect(input).toHaveProperty("value", "182");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.getAttribute("type")).toBe("tel");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByText("Optional.").id);
  });

  it("announces an error, marks the field invalid and describes it by the message", () => {
    render(<TextInput label="Recovery phrase" defaultValue="copper moss" hint="Three words." error="That phrase does not match. Check the word order." />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("That phrase does not match. Check the word order.");
    const input = screen.getByRole("textbox", { name: "Recovery phrase" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(screen.queryByText("Three words.")).toBeNull();
  });

  it("renders a textarea with a counter when multiline with maxLength", async () => {
    const user = userEvent.setup();
    const { container } = render(<TextInput label="Note" multiline maxLength={140} placeholder="e.g. left knee felt tight" disabled={false} />);
    const area = screen.getByRole("textbox", { name: "Note" });
    expect(area.tagName).toBe("TEXTAREA");
    expect(area.getAttribute("maxlength")).toBe("140");
    expect(screen.getByText("0/140")).toBeTruthy();
    await user.type(area, "abc");
    expect(screen.getByText("3/140")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("can be disabled", () => {
    render(<TextInput label="Email" disabled />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveProperty("disabled", true);
  });
});
