// Glue for the reward sheet: today's Progress from useGame, a second fold
// over the same data without today for the "before" picture, and the
// takeover first when today promoted. While older history is still paging
// in, a skeleton sheet with no Done: the numbers would be wrong.
import { useMemo, useState } from "react";
import { metaFor, useGame } from "../../app/useGame";
import { localUtcOffsetMinutes } from "../../app/useTodayKey";
import { useAppData } from "../../data/useAppData";
import { Sheet } from "../../design/Sheet";
import { Skeleton } from "../../design/Skeleton";
import type { DateKey } from "../../domain/dates";
import { buildProgress } from "../../domain/game/progress";
import { clearSummary } from "./clearModel";
import { ClearSheet } from "./ClearSheet";
import { PromotionTakeover } from "./PromotionTakeover";

export interface ClearSheetContainerProps {
  todayKey: DateKey;
  /** Done on the sheet; the caller closes it. */
  onDone: () => void;
}

export function ClearSheetContainer({ todayKey, onDone }: ClearSheetContainerProps) {
  const { state } = useAppData();
  const { days, program, settings, historyComplete, rev } = state;
  const after = useGame(todayKey);
  const before = useMemo(() => {
    const { [todayKey]: _today, ...rest } = days;
    return buildProgress({ days: rest, program, settings: settings.game, todayKey, historyComplete, utcOffsetMinutes: localUtcOffsetMinutes(), units: settings.units, metaFor });
    // rev changes whenever days, program or settings change; it is the memo key (as in useGame).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, todayKey, historyComplete]);
  const summary = useMemo(
    () => clearSummary({ before, after, day: days[todayKey], todayKey, units: settings.units, metaFor }),
    [before, after, days, todayKey, settings.units],
  );
  const [takeoverDone, setTakeoverDone] = useState(false);

  if (!historyComplete) {
    return (
      <Sheet id="cleared" title="Quest cleared">
        <Skeleton lines={4} />
        <p className="ot-caption ot-ink-2">Totting up your history…</p>
      </Sheet>
    );
  }
  if (summary.promotion && !takeoverDone) {
    return <PromotionTakeover rank={summary.promotion.rank} title={summary.promotion.title} onDone={() => setTakeoverDone(true)} />;
  }
  return <ClearSheet summary={summary} units={settings.units} onDone={onDone} />;
}
