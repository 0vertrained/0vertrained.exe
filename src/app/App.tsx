// The v20 app: providers, the hash router and the screens of this phase.
// Guest data only until the new backend lands; the entry is /next.
import { lazy, Suspense, useEffect, useState } from "react";
import { AuthProvider } from "../auth/AuthProvider";
import { useAuth } from "../auth/useAuth";
import { clearDemo, markDemo } from "../data/guestFlags";
import { useAppData } from "../data/useAppData";
import { EmptyState } from "../design/EmptyState";
import { LandingScreen } from "../features/landing/LandingScreen";
import { QuestScreen } from "../features/quest/QuestScreen";
// Stats, the quest log, Profile, onboarding and the cardio runner load on
// demand: the landing, the Quest tab, the session runner and the reward
// sheet are the critical path.
const CardioScreen = lazy(() => import("../features/cardio/CardioScreen").then((m) => ({ default: m.CardioScreen })));
const OnboardingRoute = lazy(() => import("../features/onboarding/OnboardingRoute").then((m) => ({ default: m.OnboardingRoute })));
const StatsScreen = lazy(() => import("../features/stats/StatsScreen").then((m) => ({ default: m.StatsScreen })));
const QuestLogPanel = lazy(() => import("../features/log/QuestLogPanel").then((m) => ({ default: m.QuestLogPanel })));
const QuestLogScreen = lazy(() => import("../features/log/QuestLogScreen").then((m) => ({ default: m.QuestLogScreen })));
const ProfileScreen = lazy(() => import("../features/profile/ProfileScreen").then((m) => ({ default: m.ProfileScreen })));
const AuthSheet = lazy(() => import("../features/auth/AuthSheet").then((m) => ({ default: m.AuthSheet })));
import { SessionScreen } from "../features/session/SessionScreen";
import { hasBackend } from "./config";
import { BootSkeleton, DataRoot, JUST_SIGNED_UP_KEY } from "./DataRoot";
import { ErrorBoundary } from "./ErrorBoundary";
import { installErrorReporting, reportError } from "./errorReporting";
import { Shell, type Tab } from "./Shell";
import { useGame } from "./useGame";
import { useHashRoute } from "./useHashRoute";
import { useTodayKey } from "./useTodayKey";

installErrorReporting();

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DataRoot>{(guest) => <Routes guest={guest} />}</DataRoot>
      </AuthProvider>
    </ErrorBoundary>
  );
}

const TABS: Tab[] = ["quest", "stats", "profile"];
const FULL_SCREEN = ["session", "cardio"];

function Routes({ guest }: { guest: boolean }) {
  const { state } = useAppData();
  const { route, navigate } = useHashRoute();
  const todayKey = useTodayKey();
  const first = route.parts[0] ?? "";
  const hasCharacter = state.status === "ready" && (state.settings.onboarded || Object.keys(state.days).length > 0);

  useEffect(() => {
    if (state.status !== "ready") return;
    if (first === "" && hasCharacter) navigate("/quest", { replace: true });
    // An account with nothing in it goes straight to onboarding; a guest sees the landing.
    if (!hasCharacter && first !== "onboarding" && (!guest || first !== "")) navigate(guest ? "/" : "/onboarding", { replace: true });
    if (first !== "" && first !== "onboarding" && !TABS.includes(first as Tab) && !FULL_SCREEN.includes(first)) navigate("/quest", { replace: true });
  }, [first, hasCharacter, navigate, state.status, guest]);

  if (state.status === "booting") return <BootSkeleton />;
  if (state.status === "error") {
    return <EmptyState error tag="ERROR" title="Your data could not be loaded." body={state.error ?? "Nothing was changed."} action={{ label: "Reload", variant: "secondary", onClick: () => window.location.reload() }} />;
  }
  if (first === "") return guest ? <Landing todayKey={todayKey} onFresh={() => { clearDemo(); navigate("/onboarding"); }} /> : <BootSkeleton />;
  if (first === "onboarding") return <Suspense fallback={<BootSkeleton />}><OnboardingRoute todayKey={todayKey} /></Suspense>;
  if (!hasCharacter) return <BootSkeleton />;
  if (first === "session") return <SessionScreen todayKey={todayKey} />;
  if (first === "cardio") return <Suspense fallback={<BootSkeleton />}><CardioScreen todayKey={todayKey} /></Suspense>;
  return <Tabs tab={(TABS.includes(first as Tab) ? first : "quest") as Tab} sub={route.parts[1] ?? ""} todayKey={todayKey} guest={guest} />;
}

function Landing({ todayKey, onFresh }: { todayKey: string; onFresh: () => void }) {
  const { seedDemo } = useAppData();
  const { navigate, sheet, openSheet, closeSheet } = useHashRoute();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const demo = async () => {
    setBusy(true);
    try {
      markDemo();
      await seedDemo(todayKey);
      navigate("/quest", { replace: true });
    } catch (error) {
      reportError(error, "manual", "seedDemo");
      setBusy(false);
    }
  };
  const canSignIn = hasBackend() && auth.status !== "unavailable";
  const onSignedIn = (mode: "signed-in" | "signed-up") => {
    if (mode === "signed-up") {
      try {
        window.sessionStorage.setItem(JUST_SIGNED_UP_KEY, "1");
      } catch {
        // nicety
      }
    }
    closeSheet();
  };
  return (
    <>
      <LandingScreen onDemo={() => void demo()} onFresh={onFresh} {...(canSignIn ? { onSignIn: () => openSheet("auth") } : {})} busy={busy} />
      {sheet === "auth" && canSignIn ? (
        <Suspense fallback={null}>
          <AuthSheet onClose={closeSheet} onSignedIn={onSignedIn} />
        </Suspense>
      ) : null}
    </>
  );
}

/** The auth sheet opened from Profile (guest) uses the same hand-over. */
export function ProfileAuthSheet() {
  const { sheet, closeSheet } = useHashRoute();
  const auth = useAuth();
  if (sheet !== "auth" || !hasBackend() || auth.status === "unavailable") return null;
  const onSignedIn = (mode: "signed-in" | "signed-up") => {
    if (mode === "signed-up") {
      try {
        window.sessionStorage.setItem(JUST_SIGNED_UP_KEY, "1");
      } catch {
        // nicety
      }
    }
    closeSheet();
  };
  return (
    <Suspense fallback={null}>
      <AuthSheet onClose={closeSheet} onSignedIn={onSignedIn} />
    </Suspense>
  );
}

function Tabs({ tab, sub, todayKey, guest }: { tab: Tab; sub: string; todayKey: string; guest: boolean }) {
  const { state } = useAppData();
  const { navigate } = useHashRoute();
  const progress = useGame(todayKey);
  const sync = state.sync.state === "offline" ? { state: "offline" as const, count: state.sync.queued } : { state: state.sync.state };
  return (
    <Shell tab={tab} progress={progress} sync={sync} guest={guest} onTab={(t) => navigate(`/${t}`)}>
      <Suspense fallback={<BootSkeleton />}>
        {tab === "quest" ? <QuestScreen progress={progress} todayKey={todayKey} /> : null}
        {tab === "stats" && sub === "log" ? <QuestLogScreen todayKey={todayKey} /> : null}
        {tab === "stats" && sub !== "log" ? (
          <StatsScreen todayKey={todayKey} questLog={<QuestLogPanel todayKey={todayKey} onOpen={(d) => navigate(`/stats/log/${d}`)} onViewAll={() => navigate("/stats/log")} />} />
        ) : null}
        {tab === "profile" ? <><ProfileScreen todayKey={todayKey} /><ProfileAuthSheet /></> : null}
      </Suspense>
    </Shell>
  );
}
