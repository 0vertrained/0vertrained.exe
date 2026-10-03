// The two ways in, end to end through the real providers on a memory-backed
// browser: the demo character, and a fresh start through onboarding to an
// issued Daily Quest.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "#/");
  });

  it("Try the demo opens the Quest tab on the seeded character", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Try the demo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Quest" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Tier: Reduced" })).toBeInTheDocument();
    expect(screen.getByText(/^Lv 1\d$/)).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(window.localStorage.getItem("ovt-v20-guest")).toContain('"days"');
  });

  it("Start fresh runs onboarding and lands on a quest that asks for a check-in", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Start fresh" }));
    expect(await screen.findByRole("dialog", { name: "What are you training for?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(within(screen.getByRole("list", { name: "Program preview" })).getAllByRole("listitem")).toHaveLength(7);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Quest" })).toBeInTheDocument();
    expect(screen.getByText("Lv 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check in" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/quest");
  });
});
