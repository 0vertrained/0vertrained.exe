// The v20 app: providers, the hash router and the screens of this phase.
// Guest data only until the new backend lands; the entry is /next.
import { useEffect, useMemo, useState } from "react";
import { AppDataProvider } from "../data/AppDataProvider";
import { createLocalSource } from "../data/localSource";
import { useAppData } from "../data/useAppData";
import { EmptyState } from "../design/EmptyState";
import { Skeleton } from "../design/Skeleton";
import { LandingScreen } from "../features/landing/LandingScreen";
import { OnboardingFlow } from "../features/onboarding/OnboardingFlow";
import { firstProgram, type OnboardingAnswers } from "../features/onboarding/plan";
import { QuestScreen } from "../features/quest/QuestScreen";
import { ErrorBoundary } from "./ErrorBoundary";
import { installErrorReporting, reportError } from "./errorReporting";
import { Shell, type Tab } from "./Shell";
import { ToastProvider } from "./ToastProvider";
import { useGame } from "./useGame";
import { useHashRoute } from "./useHashRoute";
import { useTodayKey } from "./useTodayKey";

installErrorReporting();

export function App() {
  const source = useMemo(() => createLocalSource(), []);
  return (
    <ErrorBoundary>
      <AppDataProvider source={source}>
        <ToastProvider>
          <Routes />
        </ToastProvider>
      </AppDataProvider>
    </ErrorBoundary>
  );
}

const TABS: Tab[] = ["quest", "stats", "profile"];

function Routes() {
  const { state } = useAppData();
  const { route, navigate } = useHashRoute();
  const todayKey = useTodayKey();
  const first = route.parts[0] ?? "";
  const hasCharacter = state.status === "ready" && (state.settings.onboarded || Object.keys(state.days).length > 0);

  useEffect(() => {
    if (state.status !== "ready") return;
    if (first === "" && hasCharacter) navigate("/quest", { replace: true });
    if (first !== "" && first !== "onboarding" && !hasCharacter) navigate("/", { replace: true });
    if (first !== "" && first !== "onboarding" && !TABS.includes(first as Tab)) navigate("/quest", { replace: true });
  }, [first, hasCharacter, navigate, state.status]);

  if (state.status === "booting") return <BootSkeleton />;
  if (state.status === "error") {
    return <EmptyState error tag="ERROR" title="Your data could not be loaded." body={state.error ?? "Nothing was changed."} action={{ label: "Reload", variant: "secondary", onClick: () => window.location.reload() }} />;
  }
  if (first === "") return <Landing todayKey={todayKey} onFresh={() => navigate("/onboarding")} />;
  if (first === "onboarding") return <Onboarding todayKey={todayKey} />;
  if (!hasCharacter) return <BootSkeleton />;
  return <Tabs tab={(TABS.includes(first as Tab) ? first : "quest") as Tab} todayKey={todayKey} />;
}

function BootSkeleton() {
  return (
    <div className="ot-screen-body">
      <Skeleton height={40} />
      <Skeleton lines={3} />
      <Skeleton height={48} />
    </div>
  );
}

function Landing({ todayKey, onFresh }: { todayKey: string; onFresh: () => void }) {
  const { seedDemo } = useAppData();
  const { navigate } = useHashRoute();
  const [busy, setBusy] = useState(false);
  const demo = async () => {
    setBusy(true);
    try {
      await seedDemo(todayKey);
      navigate("/quest", { replace: true });
    } catch (error) {
      reportError(error, "manual", "seedDemo");
      setBusy(false);
    }
  };
  return <LandingScreen onDemo={() => void demo()} onFresh={onFresh} busy={busy} />;
}

function Onboarding({ todayKey }: { todayKey: string }) {
  const { replaceProgram, patchSettings } = useAppData();
  const { navigate } = useHashRoute();
  const complete = (answers: OnboardingAnswers) => {
    const { program, startedOn } = firstProgram(answers, todayKey);
    replaceProgram(program);
    patchSettings({ onboarded: true, units: answers.units, ...(answers.bodyweightKg ? { bodyweightKg: answers.bodyweightKg } : {}), game: { startedOn } });
    navigate("/quest", { replace: true });
  };
  return <OnboardingFlow onComplete={complete} onCancel={() => navigate("/", { replace: true })} />;
}

function Tabs({ tab, todayKey }: { tab: Tab; todayKey: string }) {
  const { state } = useAppData();
  const { navigate } = useHashRoute();
  const progress = useGame(todayKey);
  const sync = state.sync.state === "offline" ? { state: "offline" as const, count: state.sync.queued } : { state: state.sync.state };
  return (
    <Shell tab={tab} progress={progress} sync={sync} guest onTab={(t) => navigate(`/${t}`)}>
      {tab === "quest" ? <QuestScreen progress={progress} todayKey={todayKey} /> : null}
      {tab === "stats" ? <EmptyState tag="STATS" title="Stats arrive in a later phase." body="Your XP, rank and streak are already counting." action={{ label: "Back to quest", variant: "secondary", onClick: () => navigate("/quest") }} /> : null}
      {tab === "profile" ? <EmptyState tag="PROFILE" title="Profile arrives in a later phase." body="Program edits and settings come with it." action={{ label: "Back to quest", variant: "secondary", onClick: () => navigate("/quest") }} /> : null}
    </Shell>
  );
}
