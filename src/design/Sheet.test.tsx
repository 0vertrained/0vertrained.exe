import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(<Sheet open={false} title="Hidden" onClose={() => {}}>body</Sheet>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog named by its title that focuses the first body control and traps Tab", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <Sheet title="How do you feel today?" onClose={onClose} footer={<button type="button">Done</button>}>
        <button type="button">Pick</button>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "How do you feel today?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pick" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations(container);
  });

  it("falls back to the footer, then the title, for initial focus", () => {
    const { unmount } = render(<Sheet title="Pick a day" footer={<button type="button">Save</button>}>Nothing to focus</Sheet>);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
    unmount();
    render(<Sheet title="Plain">Text only</Sheet>);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Plain" }));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("closes on Escape and on the scrim, and gives focus back on unmount", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const Demo = ({ open }: { open: boolean }) => (
      <>
        <button type="button">Open</button>
        <Sheet open={open} title="Day" onClose={onClose}><button type="button">Edit</button></Sheet>
      </>
    );
    const { rerender } = render(<Demo open={false} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    rerender(<Demo open />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    const scrim = screen.getByRole("dialog").previousElementSibling as HTMLElement;
    await user.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<Demo open={false} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open" }));
  });
});
