// The day-detail sheet: one logged day read back, with "Edit in runner" for
// a day the runner can reopen and "Delete day" behind a Dialog that states
// the cost first (XP and streak, from a fold without the day). Deleting
// toasts "[QUEST] Day deleted." and closes the sheet. The sheet reads the
// app data and the engine itself; the caller owns the route.
import { useMemo, useState } from "react";
import { metaFor, useGame } from "../../app/useGame";
import { useHashRoute } from "../../app/useHashRoute";
import { useToast } from "../../app/ToastProvider";
import { localUtcOffsetMinutes } from "../../app/useTodayKey";
import { useAppData } from "../../data/useAppData";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { Sheet } from "../../design/Sheet";
import { TierBadge } from "../../design/TierBadge";
import { compareKeys, type DateKey } from "../../domain/dates";
import type { DayV2 } from "../../domain/day/schema";
import { plannedDay } from "../../domain/program/revisions";
import type { ProgramPayloadV2 } from "../../domain/program/types";
import { DayDetailBody } from "./DayDetailBody";
import styles from "./log.module.css";
import { dayDetail, deleteImpactText, shortDate, xpImpactOfDelete } from "./logView";

export interface DayDetailSheetProps {
  todayKey: DateKey;
  dateKey: DateKey;
  onClose: () => void;
}

/**
 * Whether the runner can open this day: a past day whose quest planned sets
 * (or, with no quest, whose program day planned lifts), or today's session
 * once it has started. Never a day after today, never a rest or cardio-only
 * day: the runner would only send the athlete straight back.
 */
export function canEditInRunner(dateKey: DateKey, todayKey: DateKey, day: DayV2 | undefined, program: ProgramPayloadV2 | null): boolean {
  if (compareKeys(dateKey, todayKey) > 0) return false;
  const quest = day?.quest;
  const runnable = quest ? quest.planned.exercises.length > 0 : program !== null && !plannedDay(program, dateKey).rest && plannedDay(program, dateKey).lifting.length > 0;
  if (!runnable) return false;
  return dateKey === todayKey ? Boolean(day?.workout.startedAt) : true;
}

export function DayDetailSheet({ todayKey, dateKey, onClose }: DayDetailSheetProps) {
  const { state, deleteDay, updateDay } = useAppData();
  const { navigate } = useHashRoute();
  const toast = useToast();
  const progress = useGame(todayKey);
  const { days, program, settings, historyComplete } = state;
  const day = days[dateKey];
  const detail = useMemo(() => dayDetail(progress, dateKey, day, settings.units, metaFor), [progress, dateKey, day, settings.units]);
  const [confirming, setConfirming] = useState(false);
  const impact = useMemo(
    () => (confirming
      ? xpImpactOfDelete({ days, program, settings: settings.game, todayKey, units: settings.units, metaFor, dateKey, utcOffsetMinutes: localUtcOffsetMinutes(), historyComplete })
      : null),
    [confirming, days, program, settings.game, settings.units, todayKey, dateKey, historyComplete],
  );
  const canEdit = canEditInRunner(dateKey, todayKey, day, program);

  /** The runner edits a stored entry, so a planned day with none gets an empty one first. */
  const edit = () => {
    if (!day) updateDay(dateKey, (d) => d);
    navigate(`/session/${dateKey}`);
  };

  const remove = () => {
    deleteDay(dateKey);
    setConfirming(false);
    toast.show({ tag: "QUEST", text: "Day deleted." });
    onClose();
  };

  if (!detail) {
    return (
      <Sheet id="day-detail" title={shortDate(dateKey)} onClose={onClose}>
        <p className="ot-body ot-ink-2 ot-m0">Nothing logged on this day.</p>
      </Sheet>
    );
  }

  const title = (
    <span className={styles.title}>
      <span>{detail.dateText}</span>
      {detail.tier ? <TierBadge tier={detail.tier} size="sm" /> : null}
    </span>
  );

  const footer = canEdit || detail.hasEntry ? (
    <>
      {canEdit ? <Button variant="secondary" full onClick={edit}>Edit in runner</Button> : null}
      {detail.hasEntry ? <Button variant="danger" full onClick={() => setConfirming(true)}>Delete day</Button> : null}
    </>
  ) : undefined;

  return (
    <>
      <Sheet id="day-detail" title={title} onClose={onClose} footer={footer}>
        <DayDetailBody detail={detail} />
      </Sheet>
      <Dialog
        open={confirming && impact !== null}
        title="Delete this day?"
        body={impact ? deleteImpactText(impact, detail.dateText) : ""}
        confirmLabel="Delete day"
        danger
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
