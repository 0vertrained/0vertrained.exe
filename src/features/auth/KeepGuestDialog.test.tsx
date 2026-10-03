import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../test/axe";
import { KEEP_GUEST_BODY, KeepGuestDialog } from "./KeepGuestDialog";

function open(props: { open?: boolean } = {}) {
  const onKeep = vi.fn();
  const onDiscard = vi.fn();
  const utils = render(<KeepGuestDialog onKeep={onKeep} onDiscard={onDiscard} {...props} />);
  return { onKeep, onDiscard, ...utils };
}

describe("KeepGuestDialog", () => {
  it("asks the question with Keep as the primary and states what is uploaded", async () => {
    const { container, onKeep } = open();
    const dialog = screen.getByRole("alertdialog", { name: "Keep guest progress?" });
    expect(dialog).toHaveAccessibleDescription(KEEP_GUEST_BODY);
    const keep = screen.getByRole("button", { name: "Keep" });
    expect(keep).toHaveAttribute("data-primary", "true");
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);
    await expectNoA11yViolations(container);
    await userEvent.click(keep);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("starts fresh from the secondary button and from Escape", async () => {
    const { onDiscard, onKeep } = open();
    await userEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onDiscard).toHaveBeenCalledTimes(2);
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    open({ open: false });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
