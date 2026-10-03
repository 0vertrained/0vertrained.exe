// The v20 app: providers, the hash router and the screens of this phase.
// Guest data only until the new backend lands; the entry is /next.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppDataProvider } from "../data/AppDataProvider";
import { createLocalSource } from "../data/localSource";
import { useAppData } from "../data/useAppData";
import { EmptyState } from "../design/EmptyState";
import { Skeleton } from "../design/Skeleton";
import { LandingScreen } from "../features/landing/LandingScreen";
import { OnboardingFlow } from "../features/onboarding/OnboardingFlow";
import { firstProgram, type OnboardingAnswers } from "../features/onboarding/plan";
import { QuestScreen } from "../features/quest/QuestScreen";
import { CardioScreen } from "../features/cardio/CardioScreen";

// Stats, the quest log and Profile load on demand: the Quest tab and the
// runners are the critical path.
const StatsScreen = lazy(() => import("../features/stats/StatsScreen").then((m) => ({ default: m.StatsScreen })));
const QuestLogPanel = lazy(() => import("../features/log/QuestLogPanel").then((m) => ({ default: m.QuestLogPanel })));
const QuestLogScreen = lazy(() => import("../features/log/QuestLogScreen").then((m) => ({ default: m.QuestLogScreen })));
const ProfileScreen = lazy(() => import("../features/profile/ProfileScreen").then((m) => ({ default: m.ProfileScreen })));
import { SessionScreen } from "../features/session/SessionScreen";
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
const FULL_SCREEN = ["session", "cardio"];

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
    if (first !== "" && first !== "onboarding" && !TABS.includes(first as Tab) && !FULL_SCREEN.includes(first)) navigate("/quest", { replace: true });
  }, [first, hasCharacter, navigate, state.status]);

  if (state.status === "booting") return <BootSkeleton />;
  if (state.status === "error") {
    return <EmptyState error tag="ERROR" title="Your data could not be loaded." body={state.error ?? "Nothing was changed."} action={{ label: "Reload", variant: "secondary", onClick: () => window.location.reload() }} />;
  }
  if (first === "") return <Landing todayKey={todayKey} onFresh={() => navigate("/onboarding")} />;
  if (first === "onboarding") return <Onboarding todayKey={todayKey} />;
  if (!hasCharacter) return <BootSkeleton />;
  if (first === "session") return <SessionScreen todayKey={todayKey} />;
  if (first === "cardio") return <CardioScreen todayKey={todayKey} />;
  return <Tabs tab={(TABS.includes(first as Tab) ? first : "quest") as Tab} sub={route.parts[1] ?? ""} todayKey={todayKey} />;
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
    // The STR stat reads the bodyweight from the game settings; the profile field edits both.
    patchSettings({ onboarded: true, units: answers.units, ...(answers.bodyweightKg ? { bodyweightKg: answers.bodyweightKg } : {}), game: { startedOn, ...(answers.bodyweightKg ? { bodyweightKg: answers.bodyweightKg } : {}) } });
    navigate("/quest", { replace: true });
  };
  return <OnboardingFlow onComplete={complete} onCancel={() => navigate("/", { replace: true })} />;
}

function Tabs({ tab, sub, todayKey }: { tab: Tab; sub: string; todayKey: string }) {
  const { state } = useAppData();
  const { navigate } = useHashRoute();
  const progress = useGame(todayKey);
  const sync = state.sync.state === "offline" ? { state: "offline" as const, count: state.sync.queued } : { state: state.sync.state };
  return (
    <Shell tab={tab} progress={progress} sync={sync} guest onTab={(t) => navigate(`/${t}`)}>
      <Suspense fallback={<BootSkeleton />}>
        {tab === "quest" ? <QuestScreen progress={progress} todayKey={todayKey} /> : null}
        {tab === "stats" && sub === "log" ? <QuestLogScreen todayKey={todayKey} /> : null}
        {tab === "stats" && sub !== "log" ? (
          <StatsScreen todayKey={todayKey} questLog={<QuestLogPanel todayKey={todayKey} onOpen={(d) => navigate(`/stats/log/${d}`)} onViewAll={() => navigate("/stats/log")} />} />
        ) : null}
        {tab === "profile" ? <ProfileScreen todayKey={todayKey} /> : null}
      </Suspense>
    </Shell>
  );
}
