// The #/cardio route: today's planned cardio from the issued quest (whose
// minutes may be scaled) with the program's kind, distance, effort and notes
// behind it, driving the runner. Save appends the log to today's workout,
// clears the clock, toasts the minutes and returns to the quest. The same
// append is exported as useLogCardio for the manual sheet on the Quest tab.
import { useCallback } from "react";
import { useToast } from "../../app/ToastProvider";
import { useHashRoute } from "../../app/useHashRoute";
import { useAppData } from "../../data/useAppData";
import type { DateKey } from "../../domain/dates";
import type { CardioLog } from "../../domain/day/schema";
import { plannedCardioMinutes, plannedDay } from "../../domain/program/revisions";
import { CardioRunner } from "./CardioRunner";
import { useCardioClock } from "./useCardioClock";

export interface CardioScreenProps {
  todayKey: DateKey;
}

/** Appends a cardio log to `todayKey`'s workout; for the runner and the manual sheet alike. */
export function useLogCardio(todayKey: DateKey): (log: CardioLog) => void {
  const { updateDay } = useAppData();
  return useCallback((log: CardioLog) => {
    updateDay(todayKey, (d) => ({ ...d, workout: { ...d.workout, cardio: [...d.workout.cardio, log] } }));
  }, [todayKey, updateDay]);
}

export function CardioScreen({ todayKey }: CardioScreenProps) {
  const { state } = useAppData();
  const { navigate } = useHashRoute();
  const toast = useToast();
  const clock = useCardioClock(todayKey);
  const logCardio = useLogCardio(todayKey);

  const day = state.days[todayKey];
  const planned = state.program ? plannedDay(state.program, todayKey).cardio : null;
  const programMinutes = plannedCardioMinutes(planned);
  const questMinutes = day?.quest?.planned.cardioMinutes ?? null;
  const plannedMinutes = questMinutes ?? (programMinutes > 0 ? programMinutes : null);
  // A scaled quest is a time target; the program's distance no longer applies.
  const scaled = questMinutes !== null && questMinutes !== programMinutes;
  const plannedKm = !scaled && planned?.km && planned.km > 0 ? planned.km : null;
  const kind = day?.quest?.planned.cardioKind ?? planned?.kind ?? "Cardio";

  const onSave = (log: CardioLog) => {
    logCardio(log);
    clock.reset();
    toast.show({ tag: "QUEST", text: `Cardio logged. ${Math.round(log.minutes ?? 0)} min.` });
    navigate("/quest", { replace: true });
  };

  return (
    <CardioRunner
      kind={kind}
      plannedMinutes={plannedMinutes}
      plannedKm={plannedKm}
      effort={planned?.effort}
      notes={planned?.notes}
      units={state.settings.units}
      clock={clock}
      onSave={onSave}
      onExit={() => navigate("/quest")}
    />
  );
}
