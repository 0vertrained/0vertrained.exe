// Providers and a seeded character for the log's component tests: the demo
// athlete, a fresh one on the default program, or a bare one with no
// program, so a test reads as the state it describes. A DayProbe exposes
// whether a day is still stored, for the delete test.
import { useState, type ReactNode } from "react";
import { ToastProvider } from "../../app/ToastProvider";
import { AppDataProvider } from "../../data/AppDataProvider";
import { createLocalSource } from "../../data/localSource";
import { useAppData } from "../../data/useAppData";
import type { DateKey } from "../../domain/dates";
import { MemoryStorage } from "../../test/memoryStorage";
import { firstProgram, ONBOARDING_DEFAULTS } from "../onboarding/plan";

export type Character = "demo" | "fresh" | "bare";

export interface HarnessProps {
  character: Character;
  todayKey: DateKey;
  children: ReactNode;
}

export function Harness({ character, todayKey, children }: HarnessProps) {
  const storage = useState(() => new MemoryStorage())[0];
  const source = useState(() => createLocalSource(storage))[0];
  return (
    <AppDataProvider source={source}>
      <ToastProvider>
        <Seeded character={character} todayKey={todayKey}>{children}</Seeded>
      </ToastProvider>
    </AppDataProvider>
  );
}

function Seeded({ character, todayKey, children }: HarnessProps) {
  const { state, seedDemo, replaceProgram, patchSettings } = useAppData();
  const [seeded, setSeeded] = useState(false);
  if (state.status !== "ready") return null;
  if (!seeded) {
    setSeeded(true);
    if (character === "demo") void seedDemo(todayKey);
    else if (character === "fresh") {
      const { program, startedOn } = firstProgram(ONBOARDING_DEFAULTS, todayKey);
      replaceProgram(program);
      patchSettings({ onboarded: true, game: { startedOn } });
    } else {
      patchSettings({ onboarded: true, game: { startedOn: todayKey } });
    }
    return null;
  }
  if (!state.settings.onboarded) return null;
  return <>{children}</>;
}

/** "yes" while `dateKey` has a stored entry, "no" once it is gone. */
export function DayProbe({ dateKey }: { dateKey: DateKey }) {
  const { state } = useAppData();
  return <span data-testid="has-day">{state.days[dateKey] ? "yes" : "no"}</span>;
}
