// The #/session route: today's quest must be issued and started; otherwise
// it sends the athlete back to the Quest tab. Reads the app data, feeds the
// runner, and turns its outcomes into navigation.
import { useEffect, useMemo } from "react";
import { useAppData } from "../../data/useAppData";
import { metaFor, useGame } from "../../app/useGame";
import { useHashRoute } from "../../app/useHashRoute";
import { useToast } from "../../app/ToastProvider";
import { compareKeys, isDateKey, type DateKey } from "../../domain/dates";
import { synthesizeQuest } from "../../domain/game/quest";
import { plannedDay, revisionAt } from "../../domain/program/revisions";
import type { EquipmentMode } from "../../domain/program/types";
import { SessionRunner } from "./SessionRunner";
import { useRestTimer } from "./useRestTimer";

export function SessionScreen({ todayKey }: { todayKey: DateKey }) {
  const { state, updateDay } = useAppData();
  const { navigate, route } = useHashRoute();
  const requested = route.parts[1];
  const editing = requested !== undefined && isDateKey(requested) && requested !== todayKey && compareKeys(requested, todayKey) < 0;
  const dateKey = editing ? requested : todayKey;
  const progress = useGame(todayKey);
  const toast = useToast();
  const rest = useRestTimer({ sound: state.settings.session.sound, haptics: state.settings.session.haptics });
  const day = state.days[dateKey];
  const program = state.program;
  const planned = useMemo(() => (program ? plannedDay(program, dateKey) : null), [program, dateKey]);
  // A past day without an issued quest is edited against the plan that was live then.
  const quest = day?.quest ?? (editing && planned && !planned.rest ? synthesizeQuest(planned, dateKey) : undefined);
  const equipment: EquipmentMode = (program ? revisionAt(program, dateKey).builderInput?.equipment : undefined) ?? "full_gym";
  const trial = !editing && progress.trial && quest?.trial && progress.trial.exerciseId === quest.trial.exerciseId ? progress.trial : null;
  const ready = Boolean(day && quest && quest.planned.exercises.length > 0);
  const back = editing ? `/stats/log/${dateKey}` : "/quest";

  useEffect(() => {
    if (state.status === "ready" && !ready) navigate(editing ? "/stats/log" : "/quest", { replace: true });
  }, [state.status, ready, navigate, editing]);

  if (!day || !quest || !ready) return null;

  return (
    <SessionRunner
      todayKey={dateKey}
      editing={editing}
      day={day}
      quest={quest}
      planned={planned}
      days={state.days}
      units={state.settings.units}
      equipment={equipment}
      metaFor={metaFor}
      trial={trial}
      rest={rest}
      restSeconds={state.settings.session.restSeconds}
      haptics={state.settings.session.haptics}
      historyComplete={state.historyComplete}
      updateDay={(fn) => updateDay(dateKey, fn)}
      onExit={() => navigate(back)}
      onFinished={() => navigate(back, { replace: true })}
      onUnwell={() => {
        updateDay(dateKey, (d) => ({ ...d, checkin: { ...d.checkin, illness: true } }));
        rest.skip();
        toast.show({ tag: "REST", text: "Session ended. Today is protected; get well." });
        navigate("/quest", { replace: true });
      }}
    />
  );
}
