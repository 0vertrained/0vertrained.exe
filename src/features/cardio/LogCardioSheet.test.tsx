import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CardioLog } from "../../domain/day/schema";
import { KM_PER_MI } from "../../domain/units";
import { expectNoA11yViolations } from "../../test/axe";
import { LogCardioSheet } from "./LogCardioSheet";

const firstLog = (fn: ReturnType<typeof vi.fn>): CardioLog => fn.mock.calls[0]?.[0] as CardioLog;

describe("LogCardioSheet", () => {
  it("keeps Save disabled until the minutes are a positive number, then builds a manual log", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { container } = render(<LogCardioSheet kind="Easy Run" units="metric" onSave={onSave} onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Log cardio" })).toBeInTheDocument();
    expect(screen.getByText("Easy Run")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);

    const minutes = screen.getByLabelText("Minutes");
    expect(minutes).toHaveAttribute("inputmode", "numeric");
    await user.type(minutes, "0");
    expect(save).toBeDisabled();
    await user.clear(minutes);
    await user.type(minutes, "abc");
    expect(save).toBeDisabled();
    await user.clear(minutes);
    await user.type(minutes, "45");
    expect(save).toBeEnabled();

    const distance = screen.getByLabelText("Distance (km), optional");
    expect(distance).toHaveAttribute("inputmode", "decimal");
    await user.type(distance, "5");
    await expectNoA11yViolations(container);
    await user.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    const log = firstLog(onSave);
    expect(log).toMatchObject({ kind: "Easy Run", minutes: 45, km: 5, source: "manual" });
    expect(log.id).toMatch(/^c[0-9a-z]+$/);
    expect(log.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("converts an imperial distance to km and accepts a m:ss duration", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<LogCardioSheet kind="Long Run" units="imperial" onSave={onSave} onClose={() => undefined} />);
    await user.type(screen.getByLabelText("Minutes"), "45:30");
    await user.type(screen.getByLabelText("Distance (mi), optional"), "3.1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const log = firstLog(onSave);
    expect(log.minutes).toBeCloseTo(45.5, 6);
    expect(log.km).toBeCloseTo(3.1 * KM_PER_MI, 3);
  });

  it("leaves km null without a distance and closes from the Close button", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<LogCardioSheet kind="Walk" units="metric" onSave={onSave} onClose={onClose} />);
    await user.type(screen.getByLabelText("Minutes"), "30");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(firstLog(onSave)).toMatchObject({ kind: "Walk", minutes: 30, km: null, source: "manual" });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
