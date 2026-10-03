import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Notice, TONE_BY_TAG } from "./Notice";

const TAGS = Object.keys(TONE_BY_TAG) as Array<keyof typeof TONE_BY_TAG>;

describe("Notice", () => {
  it.each(TAGS)("derives the tone for [%s] from the tag", (tag) => {
    render(<Notice tag={tag}>One calm sentence.</Notice>);
    const tone = TONE_BY_TAG[tag];
    const notice = screen.getByRole(tone === "danger" ? "alert" : "status");
    expect(notice.getAttribute("data-tone")).toBe(tone);
    expect(screen.getByText(`[${tag}]`)).toBeTruthy();
    expect(screen.getByText("One calm sentence.")).toBeTruthy();
  });

  it("is role=status and chalk with no tag, or an unknown tag", () => {
    render(<Notice>Plain.</Notice>);
    expect(screen.getByRole("status").getAttribute("data-tone")).toBe("chalk");
    expect(screen.queryByText(/^\[/)).toBeNull();
    render(<Notice tag="NEW">Unknown tag.</Notice>);
    expect(screen.getByText("[NEW]").closest("[role=status]")?.getAttribute("data-tone")).toBe("chalk");
  });

  it("normalises a bracketed, lowercase tag", () => {
    render(<Notice tag="[record]">Bench Press est. max 221 lb (was 216).</Notice>);
    expect(screen.getByText("[RECORD]")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("data-tone")).toBe("brass");
  });

  it("lets tone override the tag", () => {
    render(<Notice tag="QUEST" tone="danger">Overridden.</Notice>);
    expect(screen.getByRole("alert").getAttribute("data-tone")).toBe("danger");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("adds one ghost action button that calls back", async () => {
    const onClick = vi.fn();
    render(<Notice tag="RANK TRIAL" action={{ label: "Begin", onClick }}>Available: Bench Press, 5 × 148 lb.</Notice>);
    const btn = screen.getByRole("button", { name: "Begin" });
    expect(btn.getAttribute("data-primary")).toBeNull();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations across tones, with an action and as an alert", async () => {
    const { container } = render(
      <div>
        <Notice tag="RANK TRIAL" action={{ label: "Begin" }}>Available: Bench Press, 5 × 148 lb on your next full day.</Notice>
        <Notice tag="SHIELD">Shield used on Wednesday. Streak kept: 23 days.</Notice>
        <Notice tag="REST">Rest day. Recovery done pays in full.</Notice>
        <Notice tag="ERROR">Something broke. Your data is safe.</Notice>
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
