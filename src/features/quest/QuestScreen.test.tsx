import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../app/ToastProvider";
import { useGame } from "../../app/useGame";
import { AppDataProvider } from "../../data/AppDataProvider";
import { createLocalSource } from "../../data/localSource";
import { useAppData } from "../../data/useAppData";
import { expectNoA11yViolations } from "../../test/axe";
import { MemoryStorage } from "../../test/memoryStorage";
import { dateRange, weekdayName } from "../../domain/dates";
import { firstProgram, ONBOARDING_DEFAULTS, previewWeek } from "../onboarding/plan";
import { QuestScreen } from "./QuestScreen";

/** A training day of the default generated week (the demo rotates to any date). */
const TODAY = dateRange("2026-10-05", "2026-10-11").find((k) => !previewWeek(ONBOARDING_DEFAULTS)[weekdayName(k)].rest) ?? "2026-10-05";

function Harness({ children, demo }: { children: ReactNode; demo: boolean }) {
  const storage = useState(() => new MemoryStorage())[0];
  const source = useState(() => createLocalSource(storage))[0];
  return (
    <AppDataProvider source={source}>
      <ToastProvider>
        <Seeded demo={demo}>{children}</Seeded>
      </ToastProvider>
    </AppDataProvider>
  );
}

function Seeded({ children, demo }: { children: ReactNode; demo: boolean }) {
  const { state, seedDemo, replaceProgram, patchSettings } = useAppData();
  const [seeded, setSeeded] = useState(false);
  if (state.status !== "ready") return null;
  if (!seeded) {
    setSeeded(true);
    if (demo) void seedDemo(TODAY);
    else {
      const { program, startedOn } = firstProgram(ONBOARDING_DEFAULTS, TODAY);
      replaceProgram(program);
      patchSettings({ onboarded: true, game: { startedOn } });
    }
    return null;
  }
  if (!state.settings.onboarded) return null;
  return <>{children}</>;
}

function Screen() {
  const progress = useGame(TODAY);
  return <QuestScreen progress={progress} todayKey={TODAY} />;
}

describe("QuestScreen", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/quest");
  });

  it("shows the demo's reduced quest with its objectives and one primary action", async () => {
    const { container } = render(<Harness demo><Screen /></Harness>);
    await screen.findByRole("heading", { level: 1, name: "Quest" });
    expect(await screen.findByRole("img", { name: "Tier: Reduced" })).toBeInTheDocument();
    expect(screen.getByText(/^Slept poorly \+ very sore: Reduced quest/)).toBeInTheDocument();
    expect(screen.getByText("+100 XP today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Begin quest" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);
    expect(screen.getByRole("list", { name: "This week" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/\[RANK TRIAL\]/);
    await expectNoA11yViolations(container);
  });

  it("issues today's quest from the check-in sheet on a fresh character", async () => {
    render(<Harness demo={false}><Screen /></Harness>);
    const checkin = await screen.findByRole("button", { name: "Check in" });
    expect(screen.getByRole("img", { name: "Tier: Full" })).toBeInTheDocument();
    await userEvent.click(checkin);
    const sheet = await screen.findByRole("dialog", { name: "How do you feel today?" });
    await userEvent.click(screen.getByRole("radio", { name: "poorly" }));
    await userEvent.click(screen.getByRole("radio", { name: "very" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Stress" })).getByRole("radio", { name: "some" }));
    expect(sheet).toHaveTextContent("Reduced quest");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await act(async () => {
      window.history.replaceState({ sheets: [] }, "", "#/quest");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("img", { name: "Tier: Reduced" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Begin quest" })).toBeInTheDocument();
  });
});
