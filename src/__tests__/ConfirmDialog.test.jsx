// src/__tests__/ConfirmDialog.test.jsx
// Covers the styled confirm dialog that replaced window.confirm() for
// destructive/consequential actions: rendering, the confirm/cancel/backdrop/
// keyboard paths, the destructive tint, and the promise-based useConfirm bridge.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ThemeProvider, THEMES } from "../theme";
import { ConfirmDialog, useConfirm } from "../ui/ConfirmDialog";

afterEach(cleanup);

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("ConfirmDialog", () => {
  it("renders the title, message, and both action labels", () => {
    wrap(
      <ConfirmDialog
        title="Confirm"
        message="Disconnect Whoop? This removes stored Whoop data."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Disconnect Whoop\?/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("fires onConfirm and onCancel from their buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    wrap(<ConfirmDialog message="Sure?" confirmLabel="Yes" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on backdrop click but not on panel click", () => {
    const onCancel = vi.fn();
    wrap(<ConfirmDialog message="Sure?" onConfirm={() => {}} onCancel={onCancel} />);
    // Clicking the dialog panel itself must not dismiss.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
    // Clicking the backdrop (the presentation overlay) dismisses.
    const backdrop = screen.getByRole("dialog").parentElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("maps Escape to cancel and Enter to confirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    wrap(<ConfirmDialog message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("tints the confirm button with the signal ink only when destructive", () => {
    const { rerender } = wrap(
      <ConfirmDialog message="Sure?" confirmLabel="Go" destructive onConfirm={() => {}} onCancel={() => {}} />
    );
    const destructiveColor = screen.getByRole("button", { name: "Go" }).style.color;
    rerender(
      <ThemeProvider>
        <ConfirmDialog message="Sure?" confirmLabel="Go" onConfirm={() => {}} onCancel={() => {}} />
      </ThemeProvider>
    );
    const neutralColor = screen.getByRole("button", { name: "Go" }).style.color;
    expect(destructiveColor).not.toBe(neutralColor);
    // Destructive resolves to the theme's reserved red/signal ink.
    const C = THEMES.whitepaperLight;
    expect([C.red, "rgb(178, 58, 30)"]).toContain(destructiveColor);
  });
});

// Small harness that drives the promise-based hook the way real callers do.
function ConfirmHarness({ onResult }) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm({ message: "Overwrite program?", confirmLabel: "Overwrite" });
          onResult(ok);
        }}
      >
        trigger
      </button>
      {confirmDialog}
    </div>
  );
}

describe("useConfirm", () => {
  it("renders nothing until confirm() is called", () => {
    wrap(<ConfirmHarness onResult={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves true when confirmed and false when cancelled", async () => {
    const onResult = vi.fn();
    wrap(<ConfirmHarness onResult={onResult} />);

    // Open + confirm → resolves true, dialog unmounts.
    fireEvent.click(screen.getByText("trigger"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("dialog")).toBeNull();

    // Open again + cancel → resolves false.
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
