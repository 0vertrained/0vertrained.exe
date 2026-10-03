// The #/onboarding route: runs the flow and, on Start, writes the first
// program revision and the game's start date. Loaded on demand so the
// generator and the presets stay out of the initial bundle.
import { useAppData } from "../../data/useAppData";
import { useHashRoute } from "../../app/useHashRoute";
import type { DateKey } from "../../domain/dates";
import { OnboardingFlow } from "./OnboardingFlow";
import { firstProgram, type OnboardingAnswers } from "./plan";

export function OnboardingRoute({ todayKey }: { todayKey: DateKey }) {
  const { replaceProgram, patchSettings } = useAppData();
  const { navigate } = useHashRoute();
  const complete = (answers: OnboardingAnswers) => {
    const { program, startedOn } = firstProgram(answers, todayKey);
    replaceProgram(program);
    // The STR stat reads the bodyweight from the game settings; the profile field edits both.
    patchSettings({ onboarded: true, units: answers.units, ...(answers.bodyweightKg ? { bodyweightKg: answers.bodyweightKg } : {}), game: { startedOn, ...(answers.bodyweightKg ? { bodyweightKg: answers.bodyweightKg } : {}) } });
    navigate("/quest", { replace: true });
  };
  return <OnboardingFlow onComplete={complete} onCancel={() => navigate("/", { replace: true })} />;
}
