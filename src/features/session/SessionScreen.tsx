// The #/session route: today's quest must be issued and started; otherwise
// it sends the athlete back to the Quest tab. Reads the app data, feeds the
// runner, and turns its outcomes into navigation.
import { useEffect, useMemo } from "react";
import { useAppData } from "../../data/useAppData";
import { metaFor, useGame } from "../../app/useGame";
import { useHashRoute } from "../../app/useHashRoute";
import { useToast } from "../../app/ToastProvider";
import type { DateKey } from "../../domain/dates";
import { plannedDay, revisionAt } from "../../domain/program/revisions";
import type { EquipmentMode } from "../../domain/program/types";
import { SessionRunner } from "./SessionRunner";
import { useRestTimer } from "./useRestTimer";

export function SessionScreen({ todayKey }: { todayKey: DateKey }) {
  const { state, updateDay } = useAppData();
  const { navigate } = useHashRoute();
  const progress = useGame(todayKey);
  const toast = useToast();
  const rest = useRestTimer({ sound: state.settings.session.sound, haptics: state.settings.session.haptics });
  const day = state.days[todayKey];
  const quest = day?.quest;
  const program = state.program;
  const planned = useMemo(() => (program ? plannedDay(program, todayKey) : null), [program, todayKey]);
  const equipment: EquipmentMode = (program ? revisionAt(program, todayKey).builderInput?.equipment : undefined) ?? "full_gym";
  const trial = progress.trial && quest?.trial && progress.trial.exerciseId === quest.trial.exerciseId ? progress.trial : null;
  const ready = Boolean(day && quest && quest.planned.exercises.length > 0);

  useEffect(() => {
    if (state.status === "ready" && !ready) navigate("/quest", { replace: true });
  }, [state.status, ready, navigate]);

  if (!day || !quest || !ready) return null;

  return (
    <SessionRunner
      todayKey={todayKey}
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
      updateDay={(fn) => updateDay(todayKey, fn)}
      onExit={() => navigate("/quest")}
      onFinished={() => navigate("/quest", { replace: true })}
      onUnwell={() => {
        updateDay(todayKey, (d) => ({ ...d, checkin: { ...d.checkin, illness: true } }));
        rest.skip();
        toast.show({ tag: "REST", text: "Session ended. Today is protected; get well." });
        navigate("/quest", { replace: true });
      }}
    />
  );
}
