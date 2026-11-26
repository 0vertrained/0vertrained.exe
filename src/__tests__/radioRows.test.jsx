// src/__tests__/radioRows.test.jsx
// The kit's radio rows: the name is the option's name, the line under it is
// its description, one Tab stop, and the arrow keys move the choice.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { RadioRows } from "../ui/ledger";

afterEach(cleanup);

const OPTIONS = [
  { id: "full_gym", label: "Full gym", desc: "Barbells, dumbbells, machines and cables." },
  { id: "bodyweight", label: "Bodyweight", desc: "No equipment." },
  { id: "mixed", label: "Mixed" },
];

describe("RadioRows", () => {
  it("names each radio by its label and describes it by its line", () => {
    render(<RadioRows id="eq" label="Equipment" options={OPTIONS} value="bodyweight" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Equipment" });
    const radio = within(group).getByRole("radio", { name: "Full gym" });
    expect(radio.getAttribute("aria-checked")).toBe("false");
    expect(document.getElementById(radio.getAttribute("aria-describedby")).textContent).toBe("Barbells, dumbbells, machines and cables.");
    expect(within(group).getByRole("radio", { name: "Mixed" }).hasAttribute("aria-describedby")).toBe(false);
    expect(within(group).getAllByRole("radio").filter((r) => r.tabIndex === 0).map((r) => r.textContent)).toEqual(["BodyweightNo equipment."]);
  });

  it("moves the choice with the arrow keys", () => {
    const onChange = vi.fn();
    render(<RadioRows id="eq" label="Equipment" options={OPTIONS} value="bodyweight" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("mixed");
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("full_gym");
  });

  it("can take its name from a heading on the screen", () => {
    render(<><h2 id="q">What are you training for?</h2><RadioRows id="goal" labelledBy="q" options={OPTIONS} value={null} onChange={() => {}} /></>);
    expect(screen.getByRole("radiogroup", { name: "What are you training for?" })).toBeTruthy();
    expect(screen.getAllByRole("radio")[0].tabIndex).toBe(0);
  });
});
