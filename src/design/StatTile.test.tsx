import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("is a plain tile without onClick, showing name, value and delta", () => {
    const { container } = render(<StatTile name="VIT" value={55} series={[58, 57, 57, 56, 55]} delta={{ kind: "down", text: "−3 in 4 weeks" }} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.tagName).toBe("DIV");
    expect(tile.getAttribute("data-delta")).toBe("down");
    expect(screen.getByText("VIT")).toBeTruthy();
    expect(screen.getByText("55")).toBeTruthy();
    expect(screen.getByText("−3 in 4 weeks")).toBeTruthy();
    expect(tile.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("becomes an Explain button when onClick is given", async () => {
    const onClick = vi.fn();
    render(<StatTile name="STR" value={43} series={[36, 38, 39, 41, 43]} delta={{ kind: "up", text: "+4 in 4 weeks" }} onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "STR 43, +4 in 4 weeks. Explain." });
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("data-delta")).toBe("up");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to a steady delta and an empty sparkline", () => {
    const { container } = render(<StatTile name="END" value={31} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "END 31, steady. Explain." }).getAttribute("data-delta")).toBe("steady");
    expect(container.querySelector("svg")?.children).toHaveLength(0);
  });

  it("has no axe violations as three tiles in a row", async () => {
    const { container } = render(
      <div>
        <StatTile name="STR" value={43} series={[36, 38, 39, 41, 43]} delta={{ kind: "up", text: "+4 in 4 weeks" }} onClick={() => {}} />
        <StatTile name="END" value={31} series={[31, 32, 31, 31, 31]} delta={{ kind: "steady", text: "steady" }} onClick={() => {}} />
        <StatTile name="VIT" value={55} series={[58, 57, 57, 56, 55]} delta={{ kind: "down", text: "−3 in 4 weeks" }} />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
