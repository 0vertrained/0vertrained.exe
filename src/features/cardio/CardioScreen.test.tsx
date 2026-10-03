import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../app/ToastProvider";
import { AppDataProvider } from "../../data/AppDataProvider";
import { createLocalSource } from "../../data/localSource";
import { useAppData } from "../../data/useAppData";
import { dateRange, weekdayName } from "../../domain/dates";
import type { CardioLog, QuestSnapshot } from "../../domain/day/schema";
import { MemoryStorage } from "../../test/memoryStorage";
import { firstProgram, ONBOARDING_DEFAULTS, previewWeek, type OnboardingAnswers } from "../onboarding/plan";
import { CardioScreen, useLogCardio } from "./CardioScreen";
import { clockStorageKey } from "./useCardioClock";

const ANSWERS: OnboardingAnswers = { ...ONBOARDING_DEFAULTS, goal: "endurance" };
const WEEK = previewWeek(ANSWERS);
/** A cardio day of the endurance week: the generator plans its runs by distance. */
const TODAY = dateRange("2026-10-05", "2026-10-11").find((k) => WEEK[weekdayName(k)].cardio) ?? "2026-10-09";
const PLANNED = WEEK[weekdayName(TODAY)].cardio;
const KIND = PLANNED?.kind ?? "Cardio";

function Harness({ children, quest }: { children: ReactNode; quest?: QuestSnapshot }) {
  const storage = useState(() => new MemoryStorage())[0];
  const source = useState(() => createLocalSource(storage))[0];
  return (
    <AppDataProvider source={source}>
      <ToastProvider>
        <Seeded {...(quest ? { quest } : {})}>{children}</Seeded>
      </ToastProvider>
    </AppDataProvider>
  );
}

function Seeded({ children, quest }: { children: ReactNode; quest?: QuestSnapshot }) {
  const { state, replaceProgram, patchSettings, updateDay } = useAppData();
  const [seeded, setSeeded] = useState(false);
  if (state.status !== "ready") return null;
  if (!seeded) {
    setSeeded(true);
    const { program, startedOn } = firstProgram(ANSWERS, TODAY);
    replaceProgram(program);
    patchSettings({ onboarded: true, game: { startedOn } });
    if (quest) updateDay(TODAY, (d) => ({ ...d, quest }));
    return null;
  }
  if (!state.settings.onboarded) return null;
  return <>{children}</>;
}

function Probe() {
  const { state } = useAppData();
  return <output data-testid="cardio-logs">{JSON.stringify(state.days[TODAY]?.workout.cardio ?? [])}</output>;
}

function ManualLogger() {
  const log = useLogCardio(TODAY);
  return <button type="button" onClick={() => log({ id: "m1", kind: "Walk", minutes: 30, km: null, source: "manual" })}>Log walk</button>;
}

const logs = (): CardioLog[] => JSON.parse(screen.getByTestId("cardio-logs").textContent ?? "[]") as CardioLog[];

function reducedQuest(cardioMinutes: number): QuestSnapshot {
  return {
    rulesVersion: 1,
    tier: "REDUCED",
    reason: "Slept poorly: Reduced quest.",
    issuedAt: "2026-10-09T06:00:00.000Z",
    engineIssued: true,
    planned: { exercises: [], plannedSets: 0, cardioMinutes, cardioKind: "Steady Run" },
  };
}

describe("CardioScreen", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/cardio");
  });

  it("runs today's planned cardio, appends the saved log to the day and lands on #/quest", async () => {
    const user = userEvent.setup();
    render(<Harness><CardioScreen todayKey={TODAY} /><Probe /></Harness>);
    expect(await screen.findByRole("heading", { level: 1, name: KIND })).toBeInTheDocument();
    expect(PLANNED?.km).toBeGreaterThan(0);
    expect(screen.getByText(`${PLANNED?.km} km zone 2`)).toBeInTheDocument();
    expect(logs()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(window.sessionStorage.getItem(clockStorageKey(TODAY))).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.type(screen.getByLabelText("Distance (km)"), "5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(logs()).toHaveLength(1));
    expect(logs()[0]).toMatchObject({ kind: KIND, km: 5, source: "runner" });
    expect(logs()[0]?.minutes).toBeGreaterThanOrEqual(0);
    expect(window.location.hash).toBe("#/quest");
    expect(window.sessionStorage.getItem(clockStorageKey(TODAY))).toBeNull();
    expect(screen.getByText(/^Cardio logged\. \d+ min\.$/)).toBeInTheDocument();
  });

  it("takes the issued quest's minutes and kind over the program's plan", async () => {
    render(<Harness quest={reducedQuest(20)}><CardioScreen todayKey={TODAY} /></Harness>);
    expect(await screen.findByRole("heading", { level: 1, name: "Steady Run" })).toBeInTheDocument();
    expect(screen.getByText("20 min zone 2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAccessibleName("Segment 1 of 1: Work");
  });

  it("exits to the quest without logging anything", async () => {
    const user = userEvent.setup();
    render(<Harness><CardioScreen todayKey={TODAY} /><Probe /></Harness>);
    await user.click(await screen.findByRole("button", { name: "Exit" }));
    expect(window.location.hash).toBe("#/quest");
    expect(logs()).toEqual([]);
  });

  it("useLogCardio appends a manual log to today's cardio", async () => {
    const user = userEvent.setup();
    render(<Harness><ManualLogger /><Probe /></Harness>);
    await user.click(await screen.findByRole("button", { name: "Log walk" }));
    await waitFor(() => expect(logs()).toEqual([{ id: "m1", kind: "Walk", minutes: 30, km: null, source: "manual" }]));
  });
});
