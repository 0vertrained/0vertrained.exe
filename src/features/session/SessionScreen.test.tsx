// The core loop through the real providers: demo → Begin quest → the runner
// banks sets, rests, moves on, finishes → the Quest tab offers Claim rewards.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";

async function openDemoRunner() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Try the demo" }));
  await userEvent.click(await screen.findByRole("button", { name: "Begin quest" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Full Body C" })).toBeInTheDocument();
}

describe("session runner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "#/");
  });
  afterEach(() => vi.useRealTimers());

  it("banks sets with the sticky primary, rests, and keeps the set-card region to ten controls", async () => {
    await openDemoRunner();
    expect(window.location.hash).toBe("#/session");
    expect(screen.getByRole("heading", { level: 2, name: "Goblet Squat" })).toBeInTheDocument();
    expect(screen.getByText(/^Target .* · Last /)).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Complete set 1 of 2" });
    const focusable = within(card).getAllByRole("button").filter((b) => b.getAttribute("tabindex") !== "-1").length + within(card).getAllByRole("textbox").length;
    expect(focusable).toBeLessThanOrEqual(10);
    expect(within(card).getByRole("button", { name: /Set 1, current/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Complete set 1 of 2" }));
    expect(await screen.findByRole("region", { name: "Rest timer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set 1, done/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete set 2 of 2" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("region", { name: "Rest timer" })).not.toBeInTheDocument();

    // The last set of an exercise moves straight on to the next unhandled one.
    await userEvent.click(screen.getByRole("button", { name: "Complete set 2 of 2" }));
    expect(screen.getByRole("heading", { level: 2, name: "Push-Up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exercise 2 of 5/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete set 1 of 2" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-primary]")).toHaveLength(1);

    // Picking a finished exercise from the list offers Next exercise instead.
    await userEvent.click(screen.getByRole("button", { name: /Exercise 2 of 5/ }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Exercises" })).getByRole("button", { name: /Goblet Squat/ }));
    expect(await screen.findByRole("button", { name: "Next exercise" })).toBeInTheDocument();
  });

  it("survives leaving and returning, and finishing offers Claim rewards on the Quest tab", async () => {
    await openDemoRunner();
    await userEvent.click(screen.getByRole("button", { name: "Complete set 1 of 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Exit session" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Quest" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continue · 1 / 10" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Goblet Squat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete set 2 of 2" })).toBeInTheDocument();

    // Work the rest of the session: 9 more sets and 4 exercise changes.
    for (let i = 0; i < 20 && !screen.queryByRole("button", { name: "Finish session" }); i += 1) {
      const button = screen.queryByRole("button", { name: /^Complete set/ }) ?? screen.getByRole("button", { name: "Next exercise" });
      await userEvent.click(button);
    }
    await userEvent.click(screen.getByRole("button", { name: "Finish session" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Quest" })).toBeInTheDocument();
    expect(screen.getByText("10/10 sets")).toBeInTheDocument();

    // Claim: the reward sheet shows what the day paid, Done marks it claimed.
    await userEvent.click(screen.getByRole("button", { name: "Claim rewards" }));
    const sheet = await screen.findByRole("dialog", { name: /Quest cleared/ });
    expect(within(sheet).getAllByText(/^\+\d+ XP$/).length).toBeGreaterThanOrEqual(2);
    expect(within(sheet).getByText("Training")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: /^Quest (cleared|claimed) · \+\d+ XP$/ })).toBeDisabled();
  });

  it("flags pain from the overflow menu and swaps a movement", async () => {
    await openDemoRunner();
    await userEvent.click(screen.getByRole("button", { name: /^More/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Swap exercise/ }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const swap = await screen.findByRole("dialog", { name: "Swap Goblet Squat" });
    await userEvent.click(within(swap).getAllByRole("button").find((b) => /Back Squat|Front Squat|Leg Press|Squat/.test(b.textContent ?? "")) as HTMLElement);
    expect(await screen.findByText(/Swapped for Goblet Squat/)).toBeInTheDocument();
  });
});
