// The one place derivations run: buildProgress over the athlete's data,
// memoised on the data revision and the day, and the high-water marks it
// reports written back once so a promotion, a passed trial or an unlocked
// title is never lost to a later edit.
import { useEffect, useMemo, useRef } from "react";
import { useAppData } from "../data/useAppData";
import { buildProgress } from "../domain/game/progress";
import type { Progress } from "../domain/game/types";
import { metaFor as libraryMeta } from "../domain/program/library";
import type { ExerciseLog } from "../domain/day/schema";
import { localUtcOffsetMinutes } from "./useTodayKey";

export const metaFor = (log: ExerciseLog) => libraryMeta(log.libraryId ?? log.performedName ?? log.name);

export function useGame(todayKey: string): Progress {
  const { state, patchSettings } = useAppData();
  const { days, program, settings, historyComplete, rev } = state;

  const progress = useMemo(
    () => buildProgress({ days, program, settings: settings.game, todayKey, historyComplete, utcOffsetMinutes: localUtcOffsetMinutes(), units: settings.units, metaFor }),
    // rev changes whenever days, program or settings change; it is the memo key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rev, todayKey, historyComplete],
  );

  // Persist new high-water marks once per distinct result.
  const written = useRef<string>("");
  useEffect(() => {
    const highs = progress.newHighs;
    if (!historyComplete || Object.keys(highs).length === 0) return;
    const key = JSON.stringify(highs);
    if (written.current === key) return;
    written.current = key;
    patchSettings({ game: { high: { ...settings.game.high, ...highs } } });
  }, [progress, historyComplete, patchSettings, settings.game.high]);

  return progress;
}
