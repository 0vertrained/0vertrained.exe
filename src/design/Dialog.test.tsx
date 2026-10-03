import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Dialog } from "./Dialog";

const body = "Your log, records and titles are removed from this device and the server. There is no undo.";

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(<Dialog open={false} title="Hidden?" body="No." />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is an alertdialog named and described, focuses Cancel, repeats the verb and uses danger", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(<Dialog title="Delete account?" body={body} confirmLabel="Delete account" danger onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = screen.getByRole("alertdialog", { name: "Delete account?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBe(screen.getByText(body).id);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete account" });
    expect(document.activeElement).toBe(cancel);
    expect(confirm.dataset.primary).toBeUndefined();
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations(container);
  });

  it("makes the confirm primary when not danger, with Confirm/Cancel defaults", () => {
    render(<Dialog title="Switch preset?" body="Your current week stays until tomorrow." />);
    expect(screen.getByRole("button", { name: "Confirm" }).dataset.primary).toBe("true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" }).dataset.primary).toBeUndefined();
  });

  it("cancels on Escape, ignores the scrim and restores focus on close", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const Demo = ({ open }: { open: boolean }) => (
      <>
        <button type="button">Sign out</button>
        <Dialog open={open} title="Sign out while offline?" body="Three unsynced days stay on this device." confirmLabel="Sign out" onCancel={onCancel} />
      </>
    );
    const { rerender } = render(<Demo open={false} />);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    rerender(<Demo open />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    const scrim = screen.getByRole("alertdialog").previousElementSibling as HTMLElement;
    await user.click(scrim);
    expect(onCancel).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<Demo open={false} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sign out" }));
  });
});
