// src/App.jsx
// App shell only: auth/session, data load + cache, save paths,
// theme, header, nav, overlays, and modals. The four tabs live in their own
// files (TodayTab/ProgressTab/FuelTab/TrainTab). DemoPage is lazy: it isn't
// needed for first paint, so it loads on demand and stays out of the initial
// bundle.
import { recordClimb } from "./climb/ledger";
import { rehearsalAttempt } from "./rehearsal/attempts";
import { preserveRehearsal, validCourseDate } from "./rehearsal/course";
import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { ThemeProvider, useTheme } from "./theme";
import { DEFAULT_PROGRAM, defaultDay, getTodayKey, getDayName, presetProgram } from "./constants";
import { recoveryVerdictFromLoad } from "./sharedCall";
import { shiftDate } from "./coachWindows";
import { changeHybridRacePlan } from "./hybridRaceAlignment";
import { liveTrainingWeek, snapshotOnTrainingWrite } from "./customTrainingDay";
import { detectDayZero } from "./dayZero";
import { readOAuthReturn, cleanOAuthReturnUrl } from "./oauthReturn";
import { logFunnelEvent } from "./funnel";
import { logOut, ensureProfileExists } from "./auth";
import { useMediaQuery, useIsDesktop, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { CommandPalette } from "./ui/CommandPalette";
import { supabase } from "./supabaseClient";
import { loadAllEntries, loadAllEntriesChecked, loadRecentEntries, loadOlderEntries, entriesWindowCutoff, saveEntry, importEntries, loadProgramChecked, saveProgram, loadSettingsChecked, saveSettings, patchSettings, DEFAULT_SETTINGS, setCachedUserId, clearCachedUserId } from "./data";
import { readCache, writeCache, clearCache, getCacheStatus } from "./appDataCache";
import { readPendingSaves, writePendingSaves } from "./pendingSavesStore";
import { clearRecoveryDashboardCache } from "./recoveryDashboardSessionCache";
import AuthScreen from "./AuthScreen";
import { mergeOnboardingSettings, resolveOnboardingProgramPreset, buildOnboardingBuilderInput } from "./onboardingSetup";
import { buildProgramPlan, buildProgramBuilderSettingsPatch } from "./programBuilder";
import { loadOuraData, calcRecoveryScore as calcOuraRecovery, clearAlertHistory } from "./oura";
import { loadWhoopData } from "./whoop";
import { scoreForRecoveryDay } from "./recovery/verdictResolver";
import { readWearableSnapshot } from "./wearableSnapshotCache";
import { editionWindow } from "./editionWindow";
import { perfStart, perfMark } from "./perf";
import { isCoachEnabled } from "./coachEnabled";
import { DEMO_USER, DEMO_SETTINGS, buildDemoEntries, buildDemoOuraData, getDemoWhoopData, isDemoMode } from "./demoData";
import { Header } from "./AppHeader";
import { BottomNav, QuickActionSheet, QUICK_ACTIONS, COACH_ACTION, TABS_ORDER } from "./AppBottomNav";
import { Flow, Icon, Toast, TopBar } from "./ui/ledger";
import { NavMain } from "./ui/navTransition";
import { setUiHaptics } from "./native";
import { useAppIntegrationSync } from "./integrations/useAppIntegrationSync";
import { useHealthDaily } from "./health/useHealthDaily";
import { setWhoopBluetoothOwner } from "./whoop/bluetooth";
import { useHealthWrite } from "./health/useHealthWrite";
import { useWidgetCards } from "./widgets/useWidgetCards";
import { useMorningPlan } from "./reminders/useMorningPlan";
import { ShellProvider, useShellBar } from "./ui/shell";
import { LoadingShell, RefreshingBar } from "./ui/primitives";
import { getSkeletonPlan, resolveLoadState } from "./uiStability";
import { isFirstWeekUser, buildNewUserEmptyState, countLoggedDays } from "./firstWeekJourney";
import { ErrorBoundary } from "./ErrorBoundary";
import { TodayTab } from "./TodayTab";
import LiveLiftMirror from "./watch/LiveLiftMirror";
import { useWatchBridge } from "./watch/useWatchBridge";
import { useWatchRuns } from "./watch/useWatchRuns";

// Lazy chunks — DemoPage only loads on the #demo route.
// Everything not needed for first paint is now lazy. TodayTab stays
// eager (it IS first paint); the other three tabs, the Profile overlay,
// Settings, Tutorial, and Coach each load on demand. This cut the entry chunk
// from ~775 KB to roughly a third of that. Each lazy usage below sits inside
// a Suspense with a null/quiet fallback — these panels already render against
// loaded app state, so the flash-of-nothing is a single frame on a warm cache
// and a short beat on first visit.
const DemoPage = lazy(() => import("./DemoPage"));
const ProgressTab = lazy(() => import("./ProgressTab").then(m => ({ default: m.ProgressTab })));
const FuelTab = lazy(() => import("./FuelTab").then(m => ({ default: m.FuelTab })));
const ProfileScreen = lazy(() => import("./ProfileScreen").then(m => ({ default: m.ProfileScreen })));
// Profile's own screens, by the title each shows in the top bar.
const PROFILE_TITLES = { notifications: "Notifications", coach: "Coach", data: "Your data" };
const TrainTab = lazy(() => import("./TrainTab").then(m => ({ default: m.TrainTab })));
const RecoveryDashboard = lazy(() => import("./RecoveryDashboard").then(m => ({ default: m.RecoveryDashboard })));
const SettingsScreen = lazy(() => import("./SettingsScreen").then(m => ({ default: m.SettingsScreen })));
const Tutorial = lazy(() => import("./Tutorial").then(m => ({ default: m.Tutorial })));
const DayZeroSpecimen = lazy(() => import("./DayZeroSpecimen").then(m => ({ default: m.DayZeroSpecimen })));
const Coach = lazy(() => import("./Coach").then(m => ({ default: m.Coach })));

// The app's <main>. How deep the screen is decides how it moves in: tabs at
// the top, a screen with Back one level down, Profile's own pages one below
// Profile, which itself opens with Close.
function AppMain({ overlay, tab, profilePage, title, back, ...rest }) {
  const depth = overlay === "profile" ? (profilePage ? 2 : 1) : (overlay || back) ? 1 : 0;
  const modal = overlay === "profile" && !profilePage;
  return <NavMain navKey={`${overlay || tab}|${profilePage || ""}|${title}`} depth={depth} modal={modal} {...rest} />;
}

function AppInner({ onThemeChange }) {
  const { themeId } = useTheme();
  const demoMode = isDemoMode();
  const isDesktop = useIsDesktop();
  // A screen one level down names itself and its Back here (see ui/shell).
  const screenBar = useShellBar();
  const [user, setUser]           = useState(undefined);
  const [tab, setTab]             = useState("Today");
  const [appUpdateReady, setAppUpdateReady] = useState(false);
  const tabScrollPositions = useRef({ Today: 0 });
  // A screen shown in place of the tab: "profile" (account, settings, data)
  // or "recovery" (the detail behind the call). null means the tab shows.
  const [overlay, setOverlay]     = useState(null); // null | "profile" | "recovery"
  // Which of Profile's own screens is showing: home | notifications | coach | data.
  const [profileView, setProfileView] = useState("home");
  const openProfile = () => { setProfileView("home"); setOverlay("profile"); };
  const [sheetOpen, setSheetOpen] = useState(false); // the Log sheet
  // What Today should do when it next shows: start the session or open the
  // run log. The nonce makes the same request twice still count twice.
  const [todayIntent, setTodayIntent] = useState(null);
  // Today and Progress can open the training block directly.
  const [climbHistoryRequest, setClimbHistoryRequest] = useState(null);
  const [trainLanding, setTrainLanding] = useState(null);
  // Today and Progress can ask Recovery to open on the week's edition.
  const [editionAsked, setEditionAsked] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false); // Coach chat sheet — was a floating self-positioned
                                                      // button that overlapped the header; now a normal
                                                      // controlled overlay triggered from the quick-action sheet.
  // Wraps setTab so callers that still name the old "More" and "Recovery"
  // tabs land where those now live: Profile, and the detail behind the call.
  const navigateTo = (t) => {
    setSheetOpen(false);
    if (t === "More") { openProfile(); return; }
    if (t === "Recovery") {
      tabScrollPositions.current[tab] = window.scrollY;
      setOverlay("recovery");
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
      return;
    }
    setOverlay(null);
    if (t === tab) return;
    tabScrollPositions.current[tab] = window.scrollY;
    setTab(t);
    const nextTop = tabScrollPositions.current[t] ?? 0;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: nextTop, left: 0, behavior: "auto" })));
  };
  const [data, setData]           = useState({});
  const [program, setProgram]     = useState(null); // null = not loaded yet
  const [myUsername, setMyUsername]   = useState(null);
  const [settings, setSettings]       = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  // Where Settings opens and the one status line it shows there
  // (Recovery's links and the wearable OAuth return land on Integrations).
  // `from` names the screen Settings goes back to (Profile, Recovery), when it
  // was opened from one; otherwise it closes.
  const [settingsLanding, setSettingsLanding] = useState({ section: null, notice: null, from: null });
  const openSettings = (section = null, notice = null, from = null) => {
    setSettingsLanding({ section, notice, from });
    setSettingsOpen(true);
    setSheetOpen(false);
  };
  // Latest settings for async merges that outlive the render that started them.
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const [showTutorial, setShowTutorial] = useState(false);
  // Null, or why this account can't be shown: "unreachable" (the
  // settings read failed and nothing is cached on this device), "missing" (no
  // profile row) or "cap" (no profile row, and signup is at its user limit).
  // While set, the tabs and Profile show a retry panel instead: setup and the
  // Day Zero samples would otherwise run off default settings, and any
  // settings or program save would write those defaults over the account.
  const [accountUnavailable, setAccountUnavailable] = useState(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [loaded, setLoaded]       = useState(false);
  const [loadedOwner, setLoadedOwner] = useState(null);
  // This account's settings are known: from a successful read or from
  // its own cache. Until then the in-memory settings are defaults, so nothing
  // may write them anywhere: edits and queued saves skip the cache, the queue
  // waits, and Profile and Settings stay closed.
  const accountReady = loaded && !accountUnavailable;
  const accountReadyRef = useRef(accountReady);
  useEffect(() => { accountReadyRef.current = accountReady; }, [accountReady]);
  // True while a background stale-while-revalidate fetch runs on top of already
  // shown (cached) content. Drives the quiet RefreshingBar so a cached tab never
  // blanks between the cache paint and the network refresh.
  const [refreshing, setRefreshing] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [, setSelectedDay] = useState(null);
  const [logDate, setLogDate]     = useState(null); // null = today; "YYYY-MM-DD" = past date
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY); // broadsheet shell tier
  // ⌘K palette: the FAB's quick actions, desktop-native.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const handleQuickAction = (key) => {
    setSheetOpen(false);
    setPaletteOpen(false);
    if (key === "coach") { setCoachOpen(true); return; }
    setOverlay(null);
    setSelectedDay(null);
    if (key === "meal") navigateTo("Fuel");
    else if (key === "checkin") openCheckin();
    else {
      // Workouts and runs are logged on Today.
      navigateTo("Today");
      setTodayIntent({ kind: key === "run" ? "run" : "workout", nonce: Date.now() });
    }
  };
  // The check-in sits at the top of Today, so land there at the top.
  const openCheckin = () => {
    setLogDate(null);
    tabScrollPositions.current.Today = 0;
    navigateTo("Today");
    if (tab === "Today") window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };
  useEffect(() => {
    if (!isBroadsheet) return;
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(v => !v); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isBroadsheet]);
  const [toast, setToast]         = useState(null);
  const [exportModal, setExportModal] = useState(null);
  const [importOpen, setImportOpen]   = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSaves, setPendingSaves] = useState({});
  const [bootRecovery, setBootRecovery] = useState(null);
  // One call across the app (sharedCall.js): Recovery's latest data load and
  // Today's own read, each tagged with the account it belongs to.
  const [recoveryLoad, setRecoveryLoad] = useState(null);
  const accountOwner = user?.id ?? null;
  const integrationAccountReady = accountReady && !demoMode && Boolean(accountOwner) && loadedOwner === accountOwner;
  const integrationRevision = useAppIntegrationSync({ owner: accountOwner, ready: integrationAccountReady });
  const currentLoad = recoveryLoad?.owner === accountOwner ? recoveryLoad : null;
  const currentDayKey = getTodayKey();
  const bootSample = bootRecovery?.owner === accountOwner ? bootRecovery?.sample : null;
  const liveSample = currentLoad?.snapshot?.recovery;
  const wearableSample = currentLoad ? liveSample : bootSample;
  const ouraRecovery = scoreForRecoveryDay(wearableSample, currentDayKey);
  const acceptRecoveryLoad = useCallback((out, owner) => {
    setRecoveryLoad(previous => previous?.owner === owner && previous.startedAt > out.startedAt ? previous : { ...out, owner });
  }, []);
  const [todayCall, setTodayCall] = useState(null);
  const [showDemo, setShowDemo] = useState(() => typeof window !== "undefined" && /#\/?demo\b/.test(window.location.hash || ""));
  const [, setCacheStatus] = useState({ cached: false }); // track cache status for potential UI feedback
  const fileRef    = useRef();

  const saveTimers = useRef({});
  const dayUploads = useRef(new Map());
  const hasLoadedRef = useRef(null); // stores the user id that was last loaded
  // The user whose durable offline queue has been flushed (see the
  // flush effect below). Declared up here so the logged-out branch of
  // the load effect can reset it.
  const pendingFlushedRef = useRef(null);



  // Demo page is a hash route (#/demo) so it's shareable and works logged-out.
  useEffect(() => {
    const onHash = () => setShowDemo(/#\/?demo\b/.test(window.location.hash || ""));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // If an Oura ring is connected, load its biometric recovery score so the
  // decision engine can prefer it over the subjective score (HRV/RHR/sleep are
  // stronger signals). Display-only fallback to subjective when absent.
  //
  // Snapshot-first. The persisted wearable snapshot (written by
  // RecoveryDashboard and the hourly server-prefetch hydration) already holds
  // this EXACT number — calcOuraRecovery IS calcRecoveryScore, aliased — so a
  // same-day snapshot answers with zero network. Otherwise: one trimmed direct
  // oura_data query; an empty result means "not connected", so no /status
  // invocation is needed at all. The old path burned a status function call
  // (3–5 backend round trips incl. possible token self-heal) plus the full
  // 14-day dataset with raw heartrate series, on every boot, for this one
  // number.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (demoMode) {
          // The demo decision engine runs on the demo wearable data —
          // same math, seeded inputs.
          const rec = calcOuraRecovery(buildDemoOuraData(), DEMO_SETTINGS, getDemoWhoopData());
          if (!cancelled) { setBootRecovery({ owner: accountOwner, sample: rec }); perfMark("boot", "wearable-score-ready"); }
          return;
        }
        if (!user?.id) { if (!cancelled) setBootRecovery(null); return; }
        const snap = readWearableSnapshot(user.id);
        if (scoreForRecoveryDay(snap?.recovery, currentDayKey) !== null) {
          if (!cancelled) { setBootRecovery({ owner: accountOwner, sample: snap.recovery }); perfMark("boot", "wearable-score-ready"); }
          return;
        }
        // Whoop rides along (single-flighted — collapses with
        // TodayTab's concurrent load) so the boot score inherits the ladder.
        const [oura, whoopForScore] = await Promise.all([
          loadOuraData(14),
          loadWhoopData(14).catch(() => null),
        ]);
        const rec = calcOuraRecovery(oura, settings, whoopForScore);
        if (!cancelled) {
          setBootRecovery({ owner: accountOwner, sample: rec });
          perfMark("boot", "wearable-score-ready");
        }
      } catch {
        if (!cancelled) setBootRecovery(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, accountOwner, currentDayKey, demoMode, settings]);

  // Recovery's data, loaded once when the account is ready, so Today shows
  // Recovery's verdict before Recovery is opened. Recovery hands back every
  // load it makes after that. The module loads with this, not with the app.
  const recoveryInputs = useRef({ data, settings });
  useEffect(() => { recoveryInputs.current = { data, settings }; });
  useEffect(() => {
    if (!loaded || accountUnavailable) return undefined;
    if (!demoMode && !integrationAccountReady) return undefined;
    const controller = new AbortController();
    const owner = user?.id ?? null;
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    import("./recoveryLoad")
      .then(({ loadRecoveryData }) => loadRecoveryData({ ...recoveryInputs.current, yesterdayKey: yesterday, userId: owner ?? undefined, signal: controller.signal }))
      .then((out) => { if (out && !controller.signal.aborted) acceptRecoveryLoad(out, owner); })
      .catch(() => {});
    return () => controller.abort();
  }, [loaded, accountUnavailable, integrationAccountReady, demoMode, user?.id, currentDayKey, acceptRecoveryLoad, integrationRevision]);

  // Auth bootstrap — wait for INITIAL_SESSION before doing anything else.
  // onAuthStateChange fires synchronously with the current session on subscribe,
  // but the token may not be attached to outgoing requests yet on cold start.
  // Waiting for the INITIAL_SESSION event guarantees the session is fully hydrated.
  useEffect(() => {
    if (demoMode) {
      setUser(DEMO_USER);
      setAuthReady(true);
      setCachedUserId(DEMO_USER.id);
      return;
    }
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "SIGNED_OUT"].includes(event)) {
        void setWhoopBluetoothOwner(event === "SIGNED_OUT" ? null : u?.id ?? null);
      }
      if (event === "INITIAL_SESSION") {
        // Session fully hydrated — safe to load data now
        setUser(u);
        setAuthReady(true);
        if (u?.id) setCachedUserId(u.id);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setUser(prev => prev?.id === u?.id ? prev : u);
        if (u?.id) setCachedUserId(u.id);
      } else if (event === "SIGNED_OUT") {
        const priorUserId = hasLoadedRef.current || user?.id;
        setUser(null);
        clearCachedUserId();
        // Clear local caches. If Supabase emits SIGNED_OUT with no session user,
        // fall back to the last loaded user id; then clear session-only recovery cache.
        clearCache(priorUserId);
        clearRecoveryDashboardCache(priorUserId);
        clearAlertHistory(priorUserId);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Load entries + program — only after auth is confirmed ready
  // Strategy: read cache first (if valid) and hydrate immediately, then revalidate in background.
  useEffect(() => {
    if (!authReady) return;
    if (demoMode) {
      setData(buildDemoEntries());
      setProgram(DEFAULT_PROGRAM);
      setMyUsername(DEMO_SETTINGS.username);
      setSettings(DEMO_SETTINGS);
      if (themeId !== DEMO_SETTINGS.theme) onThemeChange(DEMO_SETTINGS.theme);
      setShowTutorial(false);
      setLoaded(true);
      return;
    }
    if (!user) {
      setData({}); setProgram(null); setLoaded(false); setLoadedOwner(null); setRefreshing(false);
      // Nothing from the last account carries into the next one on this
      // page: its settings and username, its in-memory save queue (persisted
      // under its own key, it flushes when that account signs back in), and
      // any save still waiting on its debounce timer.
      setSettings(DEFAULT_SETTINGS); setMyUsername(null); setPendingSaves({});
      setShowTutorial(false); setAccountUnavailable(null);
      // Any way of being signed out (Log out, or another tab), not just Log out:
      // close what was open (the export screen holds the last account's whole
      // history) and start the next sign-in on Today.
      setOverlay(null); setSettingsOpen(false); setTab("Today");
      setExportModal(null); setImportOpen(false); setLogDate(null); setCoachOpen(false);
      Object.values(saveTimers.current).forEach((t) => clearTimeout(t));
      saveTimers.current = {};
      pendingFlushedRef.current = null;
      hasLoadedRef.current = null;
      setCacheStatus({ cached: false });
      return;
    }
    // Guard against re-loading for the same user (e.g. token refresh events)
    // but allow reload if a different user logs in
    if (hasLoadedRef.current === user.id) return;
    hasLoadedRef.current = user.id;
    let cancelled = false;

    perfStart("boot"); // instrumentation — Settings → About → Diagnostics

    // Step 1: Try to read from cache synchronously
    const cachedData = readCache(user.id);
    const cacheStatus = getCacheStatus(user.id);
    setCacheStatus(cacheStatus);

    // Overlay the durable offline queue onto whatever loads. A queued
    // entry exists precisely because the server hasn't accepted it yet, so the
    // local copy is canonical over both the cache snapshot and the fresh fetch
    // (whole-day payloads; last local edit wins — single-account beta). The
    // flush effect below retries each one once the load settles.
    const storedPending = readPendingSaves(user.id);
    if (Object.keys(storedPending).length) {
      setPendingSaves(prev => ({ ...storedPending, ...prev }));
    }

    // A cache without settings can't stand in for the account (the
    // paint would run on defaults with Profile and Settings open), so it gets
    // the skeleton like no cache at all.
    if (cachedData?.settings) {
      // Cache hit — hydrate immediately (fast perceived load)
      setData({ ...(cachedData.entries || {}), ...storedPending });
      perfMark("boot", "cache-paint");
      setProgram(cachedData.program || DEFAULT_PROGRAM);
      setMyUsername(cachedData.myUsername || null);
      setSettings(cachedData.settings || DEFAULT_SETTINGS);
      if (cachedData.settings?.theme && cachedData.settings.theme !== themeId) {
        onThemeChange(cachedData.settings.theme);
      }
      // For now, assume cached data is already onboarded (we only cache after initial load)
      setShowTutorial(false);
      setLoadedOwner(user.id);
      setLoaded(true);
      setRefreshing(true);
    } else {
      // No cache for this user/session: show the stable skeleton until the first
      // fresh load completes. This prevents stale content from a prior account or
      // demo session from remaining visible during revalidation.
      setLoaded(false);
      setRefreshing(false);
    }

    // Step 2: Revalidate in background regardless (stale-while-revalidate)
    (async () => {
      let unavailable = false;
      try {
        // Signup-orphan self-heal: a session with no profiles row (auth
        // succeeded, profile insert failed) finishes setting itself up here.
        // Runs before the loads so profile-dependent reads see the healed row.
        let healReason = null;
        if (!demoMode) {
          const healed = await ensureProfileExists();
          if (cancelled) return;
          healReason = healed.ok ? null : healed.reason;
          if (healed.ok && healed.existed === false) {
            showToast(healed.needsRecoveryPhrase
              ? "Account setup finished — set a recovery phrase in Settings → Account"
              : "Account setup finished");
          } else if (!healed.ok && healed.reason === "cap") {
            showToast("This app is at its user limit — account setup is paused");
          }
        }
        // Windowed boot. The blocking load fetches
        // only the last 180 days — one indexed range query, capped forever
        // instead of growing with account age. Older history arrives three
        // ways, all non-blocking: (1) the SWR cache already holds the full map
        // from prior sessions and is retained under the fresh window below;
        // (2) a background hydrate pages the remainder from the server and
        // merges UNDER current state, so fresher keys always win; (3) the
        // final cache write persists the fully merged map for the next boot.
        const HISTORY_CUTOFF = entriesWindowCutoff(180);
        const [recent, programRead, settingsRead] = await Promise.all([loadRecentEntries(180), loadProgramChecked(), loadSettingsChecked()]);
        if (cancelled) return;

        // A failed read is not a new account. The plain loaders answer
        // defaults when the server can't be reached, so opening the app offline
        // swapped in the default program, put the setup wizard in front of an
        // existing athlete, and wrote both into the cache. When a read fails,
        // keep this account's cached copy; the next launch reads again. Never
        // fall back to what's in memory: it can be another account's.
        const programReadFailed = Boolean(programRead.error);
        const settingsReadFailed = Boolean(settingsRead.error);
        const prog = programReadFailed ? (cachedData?.program ?? null) : programRead.program;
        const userSettings = settingsRead.missing ? null : settingsReadFailed ? (cachedData?.settings ?? null) : settingsRead.settings;
        const username = settingsReadFailed ? (cachedData?.myUsername ?? null) : settingsRead.settings.username;
        if (!userSettings || (programReadFailed && !prog)) {
          // Nothing trustworthy to show: no profile row, or no answer and
          // nothing cached (for settings or for the program, which would
          // otherwise show and cache the default plan as this athlete's).
          // Show the retry panel rather than setup and the samples running
          // off defaults.
          unavailable = true;
          setAccountUnavailable(settingsRead.missing ? (healReason === "cap" ? "cap" : "missing") : "unreachable");
          setLoaded(true);
          return;
        }
        setAccountUnavailable(null);

        // Update state with fresh data. Merge order (lowest → highest
        // precedence): cached history · fresh recent window · queued offline
        // days (their server copy is by definition stale or absent).
        const cachedHistory = cachedData?.entries || {};
        let mergedEntries = { ...cachedHistory, ...recent, ...storedPending };
        setData(mergedEntries);
        perfMark("boot", "revalidate-done");
        setProgram(prog || DEFAULT_PROGRAM);
        setMyUsername(username);
        setSettings(userSettings);
        // Set unconditionally: the launch value of themeId is stale once the
        // cached paint has switched themes, so comparing against it could skip
        // a switch back (setting the theme it already has is a no-op).
        if (userSettings.theme) onThemeChange(userSettings.theme);
        // Setup opens only when the server says this account hasn't done it.
        if (!settingsReadFailed) {
          if (userSettings.onboarded !== true) {
            setShowTutorial(true);
          } else {
            setShowTutorial(false);
          }
        }

        // Update cache with fresh data
        writeCache(user.id, {
          entries: mergedEntries,
          program: prog || DEFAULT_PROGRAM,
          settings: userSettings,
          myUsername: username,
        });

        // Update cache status to reflect the fresh load
        setCacheStatus(getCacheStatus(user.id));

        setLoadedOwner(user.id);
        setLoaded(true);

        // Background history hydrate: pages entries older than the window and
        // merges them beneath whatever is already in state (state wins per
        // key — it holds the fresh window, any cached-history edits, and the
        // offline queue). Fire-and-forget; a failure leaves the cached history
        // in place and never affects the visible boot.
        loadOlderEntries(HISTORY_CUTOFF, (chunk) => {
          if (cancelled) throw new Error("cancelled");
          mergedEntries = { ...chunk, ...mergedEntries };
          setData((prev) => ({ ...chunk, ...prev }));
        }).then((count) => {
          if (cancelled) return;
          perfMark("boot", "entries-hydrated");
          if (count > 0) {
            writeCache(user.id, {
              entries: mergedEntries,
              program: prog || DEFAULT_PROGRAM,
              settings: userSettings,
              myUsername: username,
            });
          }
        }).catch(() => {});
      } finally {
        if (!cancelled) setRefreshing(false);
        // Back from a wearable's OAuth screen (or an old /settings
        // link): once this account's settings are fresh, open Integrations
        // with the result, then take the markers out of the address so a
        // reload doesn't replay it.
        // Not while the account is unavailable: Settings would show defaults,
        // and a save from there would write them over the profile. The markers
        // stay in the address for the retry.
        const landing = cancelled || unavailable ? null : readOAuthReturn(window.location);
        if (landing) {
          try { window.history.replaceState(window.history.state, "", cleanOAuthReturnUrl(window.location)); } catch { /* best-effort */ }
          openSettings(landing.section, landing.notice);
        }
      }
    })();
    return () => { cancelled = true; };
    // ThemeId is read above but deliberately not a dependency. The
    // cached boot switches to the saved theme, and as a dependency that change
    // cancelled this run before the revalidation (and the OAuth return) could
    // finish, leaving stale data and the refresh bar up whenever the saved
    // theme differed from the phone's light/dark setting. (In demo mode it also
    // rebuilt the demo data on every theme change.) bootAttempt is the retry
    // panel's "Try again".
  }, [user, authReady, demoMode, onThemeChange, bootAttempt]);


  // A toast says what just happened. Pass { action, onAction } and it carries
  // a button (Undo) and stays up longer; the newest toast replaces the last.
  const toastTimer = useRef(null);
  const showToast = useCallback((msg, options) => {
    clearTimeout(toastTimer.current);
    setToast(options?.action ? { text: msg, action: options.action, onAction: options.onAction } : msg);
    toastTimer.current = setTimeout(() => setToast(null), options?.action ? 6000 : 2200);
  }, []);

  useEffect(() => {
    const onUpdate = () => setAppUpdateReady(true);
    window.addEventListener("ovt:service-worker-update", onUpdate);
    return () => window.removeEventListener("ovt:service-worker-update", onUpdate);
  }, []);

  const todayKey  = logDate || getTodayKey();
  const todayName = getDayName(logDate ? new Date(logDate + "T12:00:00") : new Date());
  const todayData = data[todayKey] || defaultDay();
  // Race-build overlay: consuming surfaces see the current build week;
  // Train's program screens keep the raw template so edits target the source of truth.
  // Use the same dated wearable warnings, sleep debt and check-in ceiling
  // displayed on Recovery when deciding whether today's loads can advance.
  const customReadiness = useMemo(() => {
    if (!Object.values(program || {}).some(day => day?.adaptivePlan)) return undefined;
    const verdict = recoveryVerdictFromLoad(currentLoad, { data, todayKey: currentDayKey,
      yesterdayKey: shiftDate(currentDayKey, -1), settings });
    return { capped: "moderate", easy: "pull_back", recover: "rest" }[verdict?.call];
  }, [program, currentLoad, data, settings, currentDayKey]);
  const liveProgram = useMemo(() => liveTrainingWeek({ program, data, dateKey: todayKey, currentDateKey: currentDayKey, wearableScore: ouraRecovery, readiness: customReadiness }),
    [program, data, todayKey, currentDayKey, ouraRecovery, customReadiness]);
  const recoveryProgram = todayKey === currentDayKey ? liveProgram : liveTrainingWeek({ program, data, dateKey: currentDayKey, currentDateKey: currentDayKey, wearableScore: ouraRecovery, readiness: customReadiness });

  // Debounced per-day save with offline retry queue
  const scheduleSave = useCallback((dateKey, dayPayload) => {
    if (demoMode) return;
    if (saveTimers.current[dateKey]) clearTimeout(saveTimers.current[dateKey]);
    const timer = setTimeout(async () => {
      const key = `${user?.id}/${dateKey}`;
      await dayUploads.current.get(key);
      if (saveTimers.current[dateKey] !== timer || hasLoadedRef.current !== user?.id) return;
      setSaving(true);
      // Serialize a day's uploads so an older request cannot overwrite a
      // newer, acknowledged watch batch on the server or clear its local queue.
      const upload = saveEntry(dateKey, dayPayload).catch(() => ({ error: "Save failed" }));
      dayUploads.current.set(key, upload);
      const res = await upload;
      dayUploads.current.delete(key);
      setSaving(dayUploads.current.size > 0);
      if (saveTimers.current[dateKey] !== timer || hasLoadedRef.current !== user?.id) return;
      if (res.error) {
        // Queue any failed save, not just browser-detected offline failures.
        // Gyms are full of half-dead networks; navigator.onLine can lie.
        setPendingSaves(prev => ({ ...prev, [dateKey]: dayPayload }));
        // Optimistic cache write on FAILURE too, so a reload mid-outage keeps
        // the queued entry on screen. Belt and suspenders with the
        // pendingSavesStore overlay on boot.
        if (user?.id && accountReadyRef.current) { // only once the account's settings are known
          writeCache(user.id, {
            entries: { ...data, [dateKey]: dayPayload },
            program,
            settings,
            myUsername,
          });
        }
        showToast(isOnline ? "Save pending — will retry" : "Queued offline save");
      } else {
        setPendingSaves(prev => {
          const next = { ...prev };
          delete next[dateKey];
          return next;
        });
        // Keep cache warm with the saved entry. Use the payload directly so the
        // cache cannot lag behind React state captured by this debounced closure.
        if (user?.id && accountReadyRef.current) { // only once the account's settings are known
          writeCache(user.id, {
            entries: { ...data, [dateKey]: dayPayload },
            program,
            settings,
            myUsername,
          });
        }
      }
    }, 700);
    saveTimers.current[dateKey] = timer;
    // showToast is a stable useCallback([]) — intentionally omitted; including
    // it makes the React Compiler drop memoization here (compile-skip error).
  }, [demoMode, isOnline, user?.id, data, program, settings, myUsername]);

  // Flush the durable offline queue once per loaded user. Gated on
  // `loaded` so the data overlay in the load effect has already landed; the
  // ref makes the scheduleSave dependency churn harmless (re-runs no-op).
  // Declared AFTER scheduleSave — the dependency array evaluates at render
  // time, so referencing the const above avoids a temporal-dead-zone crash.
  // Gated on accountReady, not just loaded: behind the retry panel the
  // account's settings are unknown.
  useEffect(() => {
    const uid = user?.id;
    if (!uid || demoMode || !accountReady) return;
    if (pendingFlushedRef.current === uid) return;
    pendingFlushedRef.current = uid;
    Object.entries(readPendingSaves(uid)).forEach(([dateKey, payload]) => scheduleSave(dateKey, payload));
  }, [user?.id, demoMode, accountReady, scheduleSave]);

  // Write-through: every queue change persists, so an iOS suspend or
  // app close mid-outage keeps queued workouts. The empty-pre-flush
  // guard stops the initial {} render from deleting a stored queue before the
  // load effect has merged it into state.
  useEffect(() => {
    const uid = user?.id;
    if (!uid || demoMode) return;
    if (pendingFlushedRef.current !== uid && Object.keys(pendingSaves).length === 0) return;
    writePendingSaves(uid, pendingSaves);
  }, [pendingSaves, user?.id, demoMode]);

  // Clear all pending save timers on unmount
  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach(t => clearTimeout(t));
    };
  }, []);

  // A device that turned notifications on before the push endpoint was
  // routed holds a subscription the server never stored. Send it again once
  // the account is loaded (push.js runs it once per page load). Only devices
  // with permission granted load the push module at all.
  useEffect(() => {
    if (!loaded || !user?.id || demoMode) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    import("./push").then((m) => m.resyncPushSubscription()).catch(() => {});
  }, [loaded, user?.id, demoMode]);

  // Monitor online/offline status and retry pending saves
  useEffect(() => {
    setIsOnline(navigator.onLine);
    
    const handleOnline = () => {
      setIsOnline(true);
      // Retry pending saves. Toast only when something is actually
      // queued, and say how much — "retrying saves" with nothing pending read
      // like the app had been silently failing.
      const pendingCount = Object.keys(pendingSaves).length;
      if (pendingCount > 0) {
        showToast(`Back online — retrying ${pendingCount} save${pendingCount === 1 ? "" : "s"}`);
        Object.entries(pendingSaves).forEach(([dateKey, payload]) => {
          scheduleSave(dateKey, payload);
        });
      }
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      showToast("Offline mode — saves queued");
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [pendingSaves, scheduleSave, showToast]);

  // Efficient immutable nested path update — avoids JSON.parse/stringify on every keystroke
  const setPath = (obj, parts, value) => {
    if (parts.length === 1) return { ...obj, [parts[0]]: value };
    return { ...obj, [parts[0]]: setPath(obj[parts[0]] || {}, parts.slice(1), value) };
  };

  const updateEntryAtDate = (dateKey, path, value) => {
    setData(prev => {
      const current = prev[dateKey] || defaultDay();
      const beforeEdit = snapshotOnTrainingWrite({ entry: current, program, data: prev, dateKey, currentDateKey: currentDayKey, wearableScore: ouraRecovery, readiness: customReadiness, path });
      const updated = setPath(beforeEdit, path.split("."), value);
      const next = { ...prev, [dateKey]: updated };
      // Optimistically cache local edits so a reload does not drop visible work
      // while a debounced/offline save is still pending. Only once the
      // account's settings are known (accountReady).
      if (!demoMode && user?.id && accountReadyRef.current) {
        writeCache(user.id, { entries: next, program, settings, myUsername });
      }
      scheduleSave(dateKey, updated);
      return next;
    });
  };

  const updateToday = (path, value) => updateEntryAtDate(todayKey, path, value);

  // In the iPhone app: today's lifting to the watch, and the sets logged on
  // the watch into the log. Nothing in a browser.
  const stageWatchDays = (days) => {
    if (!user?.id || !accountReadyRef.current) return false;
    const queued = { ...readPendingSaves(user.id), ...days };
    if (!writePendingSaves(user.id, queued, { allowEviction: false })) return false;
    setPendingSaves(previous => ({ ...previous, ...days }));
    return true;
  };
  const saveRehearsalAttempt = (dateKey, raw) => {
    const attempt = rehearsalAttempt(raw);
    if (!attempt || !validCourseDate(dateKey) || (!demoMode && !integrationAccountReady)) return false;
    const day = data[dateKey] || defaultDay();
    if (day.workout?.raceRehearsals?.[attempt.id]) return true;
    const path = ["workout", "raceRehearsals", attempt.id];
    if (!demoMode && !stageWatchDays({ [dateKey]: setPath(day, path, attempt) })) return false;
    updateEntryAtDate(dateKey, path.join("."), attempt);
    return true;
  };
  const saveClimbAttempt = value => {
    if (!demoMode && !integrationAccountReady) return false;
    const { dateKey } = value;
    const owner = demoMode ? "demo" : accountOwner;
    const day = data[dateKey] || defaultDay();
    const workout = recordClimb(day.workout, value, owner, program);
    if (!workout) return false;
    if (workout === day.workout) return true;
    if (!demoMode && !stageWatchDays({ [dateKey]: { ...day, workout } })) return false;
    // Reapply the scoped mutation against the latest state. A Watch edit or
    // health import for this day may have been queued in the same render.
    setData(prev => {
      const current = prev[dateKey] || defaultDay();
      const updated = { ...current, workout: recordClimb(current.workout, value, owner, program) || current.workout };
      const next = { ...prev, [dateKey]: updated };
      if (!demoMode && accountReadyRef.current) writeCache(owner, { entries: next, program, settings, myUsername });
      scheduleSave(dateKey, updated);
      return next;
    });
    return true;
  };
  useWatchBridge({ owner: accountOwner, builderPreferences: settings?.programBuilder, ready: integrationAccountReady, data, program, wearableScore: ouraRecovery, readiness: customReadiness, updateEntryAtDate, stageDays: stageWatchDays });
  useWatchRuns({ owner: accountOwner, ready: integrationAccountReady, data, program, updateEntryAtDate, showToast });
  useHealthDaily({ owner: accountOwner, ready: integrationAccountReady, data, wearables: Boolean(settings?.ouraConnected || settings?.whoopConnected), updateEntryAtDate });
  useWidgetCards({ ready: accountReady && !demoMode && Boolean(user?.id), data, program, wearableScore: ouraRecovery, readiness: customReadiness });
  useHealthWrite({ owner: accountOwner, ready: integrationAccountReady, data });
  useMorningPlan({ ready: accountReady && !demoMode && Boolean(user?.id), program });
  // The app's light taps on controls follow the runner's haptics setting.
  const uiHapticsOn = settings?.trainingCues?.haptics !== false;
  useEffect(() => { setUiHaptics(uiHapticsOn); }, [uiHapticsOn]);

  // Save user settings to Supabase — merge with existing state so onboarded/theme are never wiped
  const handleSaveSettings = async (newSettings) => {
    setSettingsBusy(true);
    // Always carry forward the fields that SettingsScreen doesn't touch (onboarded, theme)
    const merged = { ...settings, ...newSettings };
    if (demoMode) {
      setSettings(merged);
      setSettingsBusy(false);
      setSettingsOpen(false);
      showToast("Demo settings updated locally");
      return;
    }
    const res = await saveSettings(merged);
    setSettingsBusy(false);
    if (res.error) { showToast("Settings save error"); return; }
    setSettings(merged);
    // Keep cache warm after successful settings save
    if (user?.id) {
      writeCache(user.id, {
        entries: data,
        program,
        settings: merged,
        myUsername,
      });
    }
    setSettingsOpen(false);
    showToast("Settings saved");
  };

  // Quiet patch for Integrations: it persists a connection flag the
  // moment the server confirms the connection. The Save path above closes
  // Settings and toasts, which would shut the screen right after an OAuth
  // return lands there. This keeps you on Integrations and only speaks up on
  // failure.
  // The write is a server-side merge (patchSettings), never this device's whole
  // settings object: right after an OAuth return the device copy can be the
  // defaults (a failed read), and saving those would wipe the profile.
  const handlePatchSettings = async (patch) => {
    if (!demoMode) {
      const res = await patchSettings(patch);
      if (res?.error) { showToast("Settings save error"); return { ok: false, error: res.error }; }
    }
    setSettings((prev) => ({ ...prev, ...patch }));
    // Gated: a sign-out during the save resets settingsRef to the defaults.
    if (!demoMode && user?.id && accountReadyRef.current) writeCache(user.id, { entries: data, program, settings: { ...settingsRef.current, ...patch }, myUsername });
    return { ok: true };
  };

  // Persist the clinician guardrails (settings.coachingSystem) from
  // Progress → Coach without opening or closing the generic Settings screen.
  const handleSaveCoachingSystemSettings = async (nextSettings) => {
    const merged = { ...settings, ...nextSettings };
    if (demoMode) {
      setSettings(merged);
      showToast("Coaching system updated locally");
      return { ok: true };
    }
    const res = await saveSettings(merged);
    if (res.error) {
      showToast("Coaching system save error");
      return { ok: false, error: res.error };
    }
    setSettings(merged);
    if (user?.id) {
      writeCache(user.id, { entries: data, program, settings: merged, myUsername });
    }
    return { ok: true };
  };

  // Persist the opt-in Coach Memory preferences from the More hub. This is
  // a light patch (it never opens/closes the Settings modal). Demo mode updates
  // local state only. Suggest-only: nothing here edits programs or scores.
  const handleSaveCoachPreferences = async (coachPreferences) => {
    const merged = { ...settings, coachPreferences };
    if (demoMode) { setSettings(merged); showToast("Coach preferences updated locally"); return; }
    const res = await saveSettings(merged);
    if (res.error) { showToast("Coach prefs save error"); return; }
    setSettings(merged);
    if (user?.id) writeCache(user.id, { entries: data, program, settings: merged, myUsername });
    showToast("Coach preferences saved");
  };

  // Handle tutorial completion — apply full setup payload + mark onboarded.
  // Backward compatible: older callers pass a bare program-preset id string.
  const handleTutorialComplete = async (payload) => {
    const setup = typeof payload === "string" ? { programPreset: payload } : (payload || {});

    // Merge onboarding fields over existing settings without clobbering
    // theme / dietary / supplements / oura state.
    let mergedSettings = mergeOnboardingSettings(settings, {
      goal: setup.goal,
      dataMode: setup.dataMode,
      macroPreset: setup.macroPreset,
      customGoals: setup.customGoals,
      completedAt: new Date().toISOString(),
    });

    // Resolve the starter program. If onboarding collected Program Builder
    // preferences, generate a plan from them and save it + the builder prefs.
    // Otherwise fall back to the legacy preset path (back-compatible with the
    // bare program-preset string payload).
    let programToSave;
    if (setup.builderPrefs) {
      const input = buildOnboardingBuilderInput({
        goal: setup.goal,
        builderPrefs: setup.builderPrefs,
        generatedAt: new Date().toISOString(),
      });
      const plan = buildProgramPlan(input);
      programToSave = plan.program;
      const patch = buildProgramBuilderSettingsPatch(plan.input, plan);
      mergedSettings = {
        ...mergedSettings,
        programBuilder: { ...(settings.programBuilder || {}), ...patch.programBuilder },
      };
    } else {
      // Legacy preset path: explicit choice wins, else derive from goal.
      const programPreset = setup.programPreset || resolveOnboardingProgramPreset(setup.goal);
      // Every listed preset carries its own program (hybrid included);
      // an unknown id still falls back to DEFAULT_PROGRAM.
      programToSave = presetProgram(programPreset);
    }

    programToSave = preserveRehearsal(program, programToSave);

    if (!demoMode) {
      // Setup only counts once it's saved: on a failed save the wizard stays on its last step
      // and Finish retries. Settings (the onboarded flag) only save after the
      // program does, so a half-saved setup never marks the account set up.
      // Setup's own fields land together in one server-side merge
      // (patchSettings), so the account's other stored settings are kept even
      // when this device's copy is stale or the defaults (a failed read).
      const onboardingPatch = {
        setup: mergedSettings.setup,
        onboarded: mergedSettings.onboarded,
        goals: mergedSettings.goals,
        ...(setup.builderPrefs ? { programBuilder: mergedSettings.programBuilder } : {}),
      };
      let programRes, settingsRes;
      try {
        programRes = await saveProgram(programToSave);
        settingsRes = programRes?.error ? null : await patchSettings(onboardingPatch);
      } catch (e) {
        programRes = { error: e?.message || "save failed" };
      }
      if (programRes?.error || settingsRes?.error) {
        showToast("Setup didn't save. Check your connection and tap Go to Today again.");
        return;
      }
    }
    setShowTutorial(false);
    setProgram(programToSave);
    setSettings(mergedSettings);
    if (!demoMode && user?.id) {
      writeCache(user.id, {
        entries: data,
        program: programToSave,
        settings: mergedSettings,
        myUsername,
      });
    }
    // Land the athlete on Today with their first task ready.
    setOverlay(null);
    navigateTo("Today");
    setSelectedDay(null);
    showToast("Setup complete");
  };

  // Handle theme change — update context + save to profile
  const handleThemeChange = async (newThemeId) => {
    onThemeChange(newThemeId);
    const newSettings = { ...settings, theme: newThemeId };
    setSettings(newSettings);
    if (!demoMode) await saveSettings(newSettings);
    if (!demoMode && user?.id) {
      writeCache(user.id, { entries: data, program, settings: newSettings, myUsername });
    }
  };

  // Save updated program to Supabase + local state
  const handleSaveProgram = async (incomingProgram, { savedMessage = "Program saved" } = {}) => {
    const newProgram = preserveRehearsal(program, incomingProgram);
    setSaving(true);
    if (demoMode) {
      setProgram(newProgram);
      setSaving(false);
      showToast("Demo program updated locally");
      return true;
    }
    const res = await saveProgram(newProgram);
    setSaving(false);
    if (res.error) { showToast(res.error || "Program save error"); return false; }
    setProgram(newProgram);
    // Keep cache warm after successful program save
    if (user?.id) {
      writeCache(user.id, {
        entries: data,
        program: newProgram,
        settings,
        myUsername,
      });
    }
    showToast(savedMessage);
    return true;
  };
  // A race result's paces, written into the race plan.
  const applyRaceToPaces = (benchmark) => {
    if (!program?.__raceBuild || !benchmark) return Promise.resolve(false);
    return handleSaveProgram(changeHybridRacePlan(program, { ...program.__raceBuild, benchmark }, data, currentDayKey), { savedMessage: "Training paces updated" });
  };

  // Apply a Program Builder V2 generated plan. Explicit user action from
  // the builder panel's Apply button — nothing here runs before Apply. Saves the
  // generated program via the existing program path AND merges the builder
  // preferences into settings.programBuilder WITHOUT clobbering other settings.
  const handleApplyGeneratedProgram = async ({ program: incomingProgram, preferences }) => {
    const generatedProgram = preserveRehearsal(program, incomingProgram);
    const builderPatch = { programBuilder: { ...settingsRef.current.programBuilder, ...preferences } };
    if (demoMode) {
      setProgram(generatedProgram);
      setSettings(prev => ({ ...prev, ...builderPatch }));
      showToast("Demo plan applied locally");
      return true;
    }
    setSaving(true);
    const res = await saveProgram(generatedProgram);
    if (res.error) { setSaving(false); showToast(res.error || "Program save error"); return false; }
    // Program is saved; persist preferences too. If preferences fail we keep the
    // applied program and surface a softer message rather than rolling back.
    const sres = await patchSettings(builderPatch);
    setSaving(false);
    setProgram(generatedProgram);
    setSettings(prev => ({ ...prev, ...builderPatch }));
    if (user?.id && accountReadyRef.current) {
      writeCache(user.id, { entries: data, program: generatedProgram, settings: { ...settingsRef.current, ...builderPatch }, myUsername });
    }
    showToast(sres?.error ? "Plan applied · prefs not saved" : "Plan applied");
    return true;
  };

  // Export / import helpers
  // Note: one line about what the file holds (an incomplete export),
  // shown on the export screen and in the "Shared" toast. A separate toast
  // would sit under the full-screen export screen, or be replaced by "Shared".
  const deliver = async (text, filename, mime, label, note = null) => {
    try {
      const file = new File([text], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        showToast(note ? `Shared. ${note}` : "Shared"); return;
      }
    } catch (e) {}
    try {
      const blob = new Blob([text], { type: mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {}
    setExportModal({ text, filename, label, note });
  };

  // Exports cover the whole history. In-memory `data` is the 180-day
  // boot window plus whatever older history the background hydrate merged, so
  // after a failed hydrate a "Full Backup" was quietly short. Page everything
  // from the server and lay the in-memory map over it: queued or unsaved local
  // edits win, and nothing in memory is lost if the fetch comes back partial.
  const loadFullHistory = async () => {
    if (demoMode) return { history: data, note: null };
    let server = {};
    let complete = false;
    try { ({ entries: server, complete } = await loadAllEntriesChecked()); } catch { /* keep what's in memory */ }
    const merged = { ...(server || {}), ...data };
    return {
      history: Object.fromEntries(Object.keys(merged).sort().map((key) => [key, merged[key]])),
      note: complete ? null : "The server couldn't be reached, so this has only what's on this device.",
    };
  };
  const exportJSON = async () => {
    const { history, note } = await loadFullHistory();
    return deliver(JSON.stringify(history, null, 2), `athlete_data_${getTodayKey()}.json`, "application/json", "JSON Backup", note);
  };
  const exportCSV  = async () => {
    const { history, note } = await loadFullHistory();
    const rows = [["Date","Weight","Calories","Protein","Carbs","Fats","Water","Sleep","Energy","Soreness","Miles","Workout Done"]];
    Object.entries(history).sort().forEach(([date, d]) => {
      rows.push([date, d.body?.weight||"", d.nutrition?.calories||"", d.nutrition?.protein||"", d.nutrition?.carbs||"", d.nutrition?.fats||"", d.nutrition?.water||"", d.body?.sleep||"", d.body?.energy||"", d.body?.soreness||"", d.workout?.cardio?.miles||"", d.workout?.completed?"Yes":"No"]);
    });
    deliver(rows.map(r => r.join(",")).join("\n"), `athlete_stats_${getTodayKey()}.csv`, "text/csv", "CSV Export", note);
  };

  const importFromText = async (text) => {
    let parsed; try { parsed = JSON.parse(text); } catch { showToast("Invalid JSON"); return; }
    if (demoMode) {
      setData(parsed);
      setImportOpen(false);
      showToast("Demo import loaded locally");
      return;
    }
    setSaving(true);
    const res = await importEntries(parsed);
    setSaving(false);
    if (res.error) { showToast(res.error || "Import failed"); return; }
    const all = await loadAllEntries();
    setData(all); 
    // Keep cache warm after successful import (once the account is known)
    if (user?.id && accountReadyRef.current) {
      writeCache(user.id, {
        entries: all,
        program,
        settings,
        myUsername,
      });
    }
    setImportOpen(false); 
    showToast("Data imported");
  };

  const importFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    // Reject files over 5MB before reading — a legitimate export is <1MB.
    // This prevents memory exhaustion from accidental large file selection.
    if (file.size > 5 * 1024 * 1024) {
      showToast('File too large (max 5MB)');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => importFromText(ev.target.result);
    reader.readAsText(file); e.target.value = "";
  };

  // Funnel: mark the wearable-connected step once per session. Lives
  // above ALL early returns (rules-of-hooks); the derivation is inlined here
  // because the render-side `ouraConnected` const is computed after them.
  useEffect(() => {
    const connected = settings?.ouraConnected === true || ouraRecovery != null;
    if (connected && loaded) logFunnelEvent("oura_connected");
  }, [settings?.ouraConnected, ouraRecovery, loaded]);

  if (user === undefined) return (
    <div className="ot" style={{ alignItems: "center", justifyContent: "center" }}>
      <p className="t-s c2" role="status">Loading…</p>
    </div>
  );
  if (showDemo) return <Suspense fallback={null}><DemoPage signedIn={Boolean(user)} onClose={() => { try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch {} setShowDemo(false); }} /></Suspense>;
  if (!user && !demoMode) return <AuthScreen onAuthed={u => { void setWhoopBluetoothOwner(u?.id ?? null); setUser(u); }} />;

  const yesterdayKey = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();

  // First-week baseline state for the additive per-tab guidance banners. Gated on
  // `loaded` so a tab never flashes a banner before its real data resolves.
  const ouraConnected = settings?.ouraConnected === true || ouraRecovery != null;
  // Day Zero — per-tab zero states. Computed every render (cheap:
  // key scans over the entries map); gated on `loaded` at the render sites so
  // specimens never flash during boot. Demo mode counts as real data.
  const dayZero = detectDayZero({ data, settings, ouraConnected, demoMode });
  // The retry panel's "Try again": run the launch again for this account.
  // Loading state first, so the tabs show their skeletons, not samples built
  // from the defaults, until the account answers.
  const retryBoot = () => { hasLoadedRef.current = null; setLoaded(false); setAccountUnavailable(null); setBootAttempt((n) => n + 1); };
  const handleLogout = async () => { if (!demoMode) { const id = user?.id || hasLoadedRef.current; await logOut(); void setWhoopBluetoothOwner(null); clearCache(id); clearRecoveryDashboardCache(id); clearAlertHistory(id); } setUser(demoMode ? DEMO_USER : null); hasLoadedRef.current = null; };
  const firstWeek = loaded && isFirstWeekUser(settings, data);
  const appLoadState = resolveLoadState({ loaded, refreshing });
  const coachEnabled = isCoachEnabled(user?.id);

  const isPastDay = Boolean(logDate) && logDate !== getTodayKey();
  const shortDay = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const closeOverlay = () => {
    setOverlay(null);
    setEditionAsked(false);
    const top = tabScrollPositions.current[tab] ?? 0;
    requestAnimationFrame(() => window.scrollTo({ top, left: 0, behavior: "auto" }));
  };
  // What the top bar shows: the screen's own request first, then the overlay,
  // then the tab.
  const tabBar = overlay === "profile" && PROFILE_TITLES[profileView] ? { title: PROFILE_TITLES[profileView], back: "Profile", onBack: () => setProfileView("home") }
    : overlay === "profile" ? { title: "Profile", close: "Close", onClose: closeOverlay }
    : overlay === "recovery" ? { title: "Recovery", back: tab, onBack: closeOverlay }
    : tab === "Today" && isPastDay ? { title: shortDay(new Date(`${logDate}T12:00:00`)), sub: " · past day" }
    : { title: tab, sub: tab === "Today" || tab === "Fuel" ? ` · ${shortDay(new Date())}` : "" };
  const bar = (!overlay && screenBar) || tabBar;
  const logActions = coachEnabled ? [...QUICK_ACTIONS, COACH_ACTION] : QUICK_ACTIONS;
  const changeTab = (t) => { setClimbHistoryRequest(null); setTrainLanding(null); navigateTo(t); setSelectedDay(null); };
  // The Sunday Edition is drawn from wearable mornings, so its doors show only
  // on a connected account, and only while an edition is out.
  const openEdition = ouraConnected && !dayZero.recovery.isZero && editionWindow(new Date()).available
    ? () => { setEditionAsked(true); navigateTo("Recovery"); }
    : null;

  return (
    <div className={`ot ovt-app-shell${isDesktop ? "" : " has-tabs"}`}>
      <a className="skip" href="#main">Skip to content</a>
      {showTutorial && (
        <Suspense fallback={null}>
          <Tutorial onComplete={handleTutorialComplete} />
        </Suspense>
      )}
      <Header title={bar.title} sub={bar.sub} back={bar.back} onBack={bar.onBack} close={bar.close} onClose={bar.onClose} saving={saving} demoMode={demoMode} onOpenProfile={overlay === "profile" && !isDesktop ? undefined : openProfile} isOnline={isOnline} pendingSaves={pendingSaves} currentTab={overlay === "profile" ? null : tab} onTabChange={changeTab} onQuickAction={() => setSheetOpen(true)} onOpenPalette={() => setPaletteOpen(true)} tabsOrder={TABS_ORDER} />
      {integrationAccountReady && <LiveLiftMirror key={accountOwner} owner={accountOwner} />}
      {appLoadState.showRefreshing && <RefreshingBar label="Refreshing your latest data in the background" />}

      <AppMain overlay={overlay} tab={tab} profilePage={overlay === "profile" && PROFILE_TITLES[profileView] ? profileView : null} title={bar.title} back={bar.back} enabled={!isDesktop} id="main" tabIndex={-1} style={{ outline: "none", display: "flex", flexDirection: "column", flex: "1 1 auto", minWidth: 0 }}>
        {isDesktop && <ScreenTitle bar={bar} />}

        {/* Profile: account, settings and data, behind the top bar on every screen. */}
        {overlay === "profile" && (
          <div className={!accountUnavailable && loaded ? "tab-screen" : "legacy-screen"} style={isBroadsheet ? { maxWidth: "var(--ovt-content-width)" } : undefined}>
            {accountUnavailable ? <AccountUnavailable reason={accountUnavailable} onRetry={retryBoot} onLogout={handleLogout} /> : !loaded ? <AccountLoading /> : (<>
            <BaselineBanner tab="More" firstWeek={firstWeek} settings={settings} entries={data} program={liveProgram} ouraConnected={ouraConnected} />
            <ErrorBoundary label="Profile">
            <Suspense fallback={<LoadingShell plan={getSkeletonPlan("Profile")} />}>
            <ProfileScreen
              view={profileView} onView={setProfileView}
              username={myUsername} demoMode={demoMode}
              exportJSON={exportJSON} exportCSV={exportCSV} fileRef={fileRef}
              onPasteImport={() => setImportOpen(true)}
              onSettings={(section) => openSettings(section || null, null, "Profile")}
              onLogout={handleLogout}
              settings={settings}
              allData={data}
              showToast={showToast}
              onSaveCoachPreferences={handleSaveCoachPreferences}
              onSaveCoachingSettings={handleSaveCoachingSystemSettings}
            />
            </Suspense>
            </ErrorBoundary>
            </>)}
          </div>
        )}

        {/* Recovery: the detail behind the call, one level down from the tab it was opened on. */}
        {overlay === "recovery" && (
          <div className={!accountUnavailable && loaded && !dayZero.recovery.isZero ? "tab-screen" : "legacy-screen"}>
            <ErrorBoundary label="Recovery">
            <Suspense fallback={<LoadingShell plan={getSkeletonPlan("Recovery")} />}>
            {accountUnavailable ? <AccountUnavailable reason={accountUnavailable} onRetry={retryBoot} /> : loaded && dayZero.recovery.isZero
              ? <DayZeroSpecimen tab="Recovery" onAction={() => openSettings("integrations")} />
              : <><BaselineBanner tab="Recovery" firstWeek={firstWeek} settings={settings} entries={data} program={liveProgram} ouraConnected={ouraConnected} /><RecoveryDashboard key={accountOwner} integrationRevision={integrationRevision} data={data} settings={settings} yesterdayKey={yesterdayKey} appLoaded={loaded} userId={user?.id} todayKey={currentDayKey} todayName={getDayName()} onOpenCheckin={openCheckin} programDay={recoveryProgram?.[getDayName()] || DEFAULT_PROGRAM[getDayName()]} todayPlan={recoveryProgram?.[getDayName()]?.type || null} onOpenIntegrations={() => openSettings("integrations", null, "Recovery")} openEdition={editionAsked} onEditionClosed={() => setEditionAsked(false)} onLoaded={(out) => acceptRecoveryLoad(out, accountOwner)} todayCall={todayCall && todayCall.owner === (user?.id ?? null) && todayCall.dateKey === getTodayKey() ? todayCall : null} /></>}
            </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {!overlay && (
          /* key={tab} resets the boundary on tab switch, so a crash in one tab
             never leaves another tab stuck on the fallback. */
          <ErrorBoundary key={tab} label={`${tab} tab`}>
          <Suspense fallback={<LoadingShell plan={getSkeletonPlan(tab)} />}>
          {accountUnavailable ? <div className="legacy-screen"><AccountUnavailable reason={accountUnavailable} onRetry={retryBoot} /></div> : (<>
          {tab === "Today" && (
            <div className={loaded && !dayZero.today.isZero ? "tab-screen" : "legacy-screen"}>
            {loaded && dayZero.today.isZero && !program?.__climbs?.[todayKey]
              ? <DayZeroSpecimen tab="Today" onAction={() => setShowTutorial(true)} />
              : <TodayTab onOpenClimb={() => { setClimbHistoryRequest(null); setTrainLanding("climb"); navigateTo("Train"); }} key={accountOwner} integrationRevision={integrationRevision} todayName={todayName} todayData={todayData} updateToday={updateToday} updateEntryAtDate={updateEntryAtDate} showToast={showToast} onExport={exportJSON} loaded={loaded} program={liveProgram} baseProgram={program} onSaveProgram={handleSaveProgram} onUseRaceForPaces={applyRaceToPaces} settings={settings} allData={data} logDate={logDate} setLogDate={setLogDate} ouraRecovery={ouraRecovery} wearableSample={wearableSample} setTab={navigateTo} onChangeStartDate={() => { setTrainLanding("block"); navigateTo("Train"); }} saving={saving} isOnline={isOnline} savePending={Boolean(pendingSaves[todayKey])} intent={todayIntent} onIntentHandled={() => setTodayIntent(null)} onOpenEdition={openEdition} recoveryLoad={currentLoad} onCall={(read) => setTodayCall({ ...read, owner: user?.id ?? null })} />}
            </div>
          )}
          {tab === "Train" && (
            <TrainTab
              key={(accountOwner || "demo") + (trainLanding || "home")} initialView={trainLanding} initialHealthRun={trainLanding === "climb" && climbHistoryRequest?.owner === accountOwner ? climbHistoryRequest?.run : null}
              owner={demoMode ? "demo" : integrationAccountReady ? accountOwner : null} onSaveClimbAttempt={saveClimbAttempt} onSaveRehearsalAttempt={saveRehearsalAttempt}
              program={program} liveProgram={recoveryProgram} entries={data} settings={settings}
              onSaveProgram={handleSaveProgram} onApplyGeneratedProgram={handleApplyGeneratedProgram}
              onStartToday={() => { setLogDate(null); navigateTo("Today"); setTodayIntent({ kind: "workout", nonce: Date.now() }); }}
              onOpenDay={(dateKey) => { setLogDate(dateKey); navigateTo("Today"); }}
            />
          )}
          {tab === "Fuel" && (
            <div className={loaded && !dayZero.fuel.isZero ? "tab-screen" : "legacy-screen"}>
            {loaded && dayZero.fuel.isZero
              ? <DayZeroSpecimen tab="Fuel" onAction={() => setShowTutorial(true)} />
              : <><BaselineBanner tab="Fuel" firstWeek={firstWeek} settings={settings} entries={data} program={liveProgram} ouraConnected={ouraConnected} /><FuelTab settings={settings} todayData={todayData} updateToday={updateToday} updateEntryAtDate={updateEntryAtDate} showToast={showToast} todayKey={todayKey} loaded={loaded} data={data} onPatchSettings={handlePatchSettings} /></>}
            </div>
          )}
          {tab === "Progress" && (
            <div className={loaded && !dayZero.progress.isZero ? "tab-screen" : "legacy-screen"}>
            {loaded && dayZero.progress.isZero
              ? <DayZeroSpecimen tab="Progress" progressInfo={dayZero.progress} />
              : <><BaselineBanner tab="Progress" firstWeek={firstWeek} settings={settings} entries={data} program={liveProgram} ouraConnected={ouraConnected} /><ProgressTab onRaceClimb={run => { setClimbHistoryRequest({ owner: accountOwner, run }); setTrainLanding("climb"); navigateTo("Train"); }} owner={integrationAccountReady ? accountOwner : null} data={data} settings={settings} program={recoveryProgram} baseProgram={program} loaded={loaded} updateEntryAtDate={updateEntryAtDate} showToast={showToast} onOpenDay={(dateKey) => { setLogDate(dateKey); navigateTo("Today"); }} onOpenEdition={openEdition} onOpenBlock={() => { setTrainLanding("block"); navigateTo("Train"); }} /></>}
            </div>
          )}
          </>)}
          </Suspense>
          </ErrorBoundary>
        )}
      </AppMain>

      <BottomNav currentTab={overlay === "profile" ? null : tab} onTabChange={changeTab} tabsOrder={TABS_ORDER} onQuickAction={() => setSheetOpen(true)} />

      {isBroadsheet && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          actions={logActions}
          tabs={TABS_ORDER}
          onAction={handleQuickAction}
          onNavigate={(t) => { setPaletteOpen(false); setOverlay(null); navigateTo(t); setSelectedDay(null); }}
        />
      )}
      <QuickActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        actions={logActions}
        onAction={handleQuickAction}
      />

      <div className="toast-dock">
        {appUpdateReady && <Toast action="Reload" onAction={() => window.location.reload()}>Updated. Reload for the newest version.</Toast>}
        {toast && !appUpdateReady && (typeof toast === "string"
          ? <Toast>{toast}</Toast>
          : <Toast action={toast.action} onAction={() => { toast.onAction?.(); setToast(null); }}>{toast.text}</Toast>)}
      </div>
      <input ref={fileRef} type="file" accept=".json" aria-label="Import data from JSON file" style={{ display:"none" }} onChange={importFile} />
      {exportModal && <ExportModal modal={exportModal} onClose={() => setExportModal(null)} showToast={showToast} />}
      {settingsOpen && accountReady && <Suspense fallback={null}><SettingsScreen key={accountOwner} owner={integrationAccountReady ? accountOwner : null} integrationRevision={integrationRevision} settings={settings} onSave={handleSaveSettings} onPatch={handlePatchSettings} onClose={() => setSettingsOpen(false)} busy={settingsBusy} onThemeChange={handleThemeChange} currentTheme={themeId} initialSection={settingsLanding.section} notice={settingsLanding.notice} backLabel={settingsLanding.from} loggedDays={countLoggedDays(data)} currentTab={tab} /></Suspense>}
      {importOpen  && <ImportModal onImport={importFromText} onClose={() => setImportOpen(false)} />}
      {/* Coach stays always-mounted (it manages its own open/close animation and
          in-flight request state); lazy just moves its code out of the entry
          chunk. coachEnabled gates whether it can ever open, so skip the chunk
          fetch entirely for accounts that will never see it. */}
      {coachEnabled && <Suspense fallback={null}><Coach data={data} settings={settings} program={liveProgram} todayKey={todayKey} todayName={todayName} userId={user?.id} open={coachOpen} onClose={() => setCoachOpen(false)} /></Suspense>}
    </div>
  );
}


// Today Tab
// Daily Coach Hero
// Shown in place of the tabs and Profile while the account can't be
// loaded (see accountUnavailable in AppInner). Nothing behind it may run off
// default settings: no setup, no samples, no settings or program saves.
const ACCOUNT_UNAVAILABLE_COPY = {
  unreachable: { title: "Couldn't reach your account", body: "The server didn't answer, and nothing from this account is saved on this device yet. Your data is safe. Check your connection and try again." },
  missing: { title: "Your account isn't set up yet", body: "Signing up didn't finish on the server, so there's nothing to load yet. Try again in a moment." },
  cap: { title: "Your account isn't set up yet", body: "The beta is at its user limit, so account setup is paused. Nothing is lost. Try again later." },
};
function AccountUnavailable({ reason, onRetry, onLogout }) {
  const copy = ACCOUNT_UNAVAILABLE_COPY[reason] || ACCOUNT_UNAVAILABLE_COPY.unreachable;
  return (
    <section role="alert" data-testid="account-unavailable" className="card" style={{ display: "flex", flexDirection: "column", gap: 12, margin: "12px 16px" }}>
      <h2 className="t-title">{copy.title}</h2>
      <p className="t-b c2">{copy.body}</p>
      <button type="button" className="btn btn-p btn-b" onClick={onRetry}>Try again</button>
      {onLogout && <button type="button" className="btn btn-s btn-b" onClick={onLogout}>Log out</button>}
    </section>
  );
}

// At 1024 px and up the tabs sit in the top bar, so the screen's h1 moves into
// the page, with Back or Close beside it when the screen is one level down.
function ScreenTitle({ bar }) {
  return (
    <div className="screen-title">
      {bar.back && <button type="button" className="back" data-nav="back" style={{ marginLeft: 0 }} onClick={bar.onBack}><Icon name="back" size="s" />{bar.back}</button>}
      {bar.close && <button type="button" className="back" style={{ marginLeft: 0, gap: 4 }} onClick={bar.onClose}><Icon name="close" size="s" />{bar.close}</button>}
      <h1 className="t-xl" tabIndex={-1}>{bar.title}</h1>
      {bar.sub && <p className="t-b c2">{bar.sub.replace(/^ · /, "")}</p>}
    </div>
  );
}

// Profile while the account is still loading: its settings aren't
// known yet, so Settings and the program editors wait.
function AccountLoading() {
  return <p role="status" className="t-b c2" style={{ margin: 0, padding: "24px 16px" }}>Loading your account…</p>;
}

// The first week, while the app learns your normal range: one line above the
// tab saying what the tab needs.
function BaselineBanner({ tab, firstWeek, settings, entries, program, ouraConnected }) {
  if (!firstWeek) return null;
  const es = buildNewUserEmptyState(tab, { settings, entries, program, ouraConnected });
  if (!es) return null;
  return (
    <p className="banner" style={{ margin: "12px 16px 0" }}>
      <span><b>{es.title}.</b> {es.message}</span>
    </p>
  );
}

// A backup to copy, shown after an export: the share sheet or download may
// not be available, and the text is always here to copy by hand.
function ExportModal({ modal, onClose, showToast }) {
  const taRef = useRef();
  const copyAll = async () => {
    try { await navigator.clipboard.writeText(modal.text); showToast("Copied to clipboard"); }
    catch { if (taRef.current) { taRef.current.focus(); taRef.current.select(); } showToast("Select all + copy"); }
  };
  return (
    <Flow label={modal.label} onClose={onClose}>
      <div className="shell" style={{ maxWidth: "var(--ovt-content-width)" }}>
        <TopBar title={modal.label} close="Close" onClose={onClose} />
        <div className="main" style={{ gap: 12 }}>
          <p className="t-b">Copy it and keep it anywhere.{/\.json$/i.test(modal.filename || "") ? " Restore it later from Profile, under Your data." : ""}</p>
          {modal.note && <p className="banner" role="status">{modal.note}</p>}
          <textarea ref={taRef} className="input area n" readOnly rows={12} value={modal.text} aria-label={`${modal.label} text`} onFocus={(e) => e.target.select()} style={{ fontSize: 14 }} />
        </div>
        <div className="foot"><button type="button" className="btn btn-p btn-b" onClick={copyAll}>Copy all</button></div>
      </div>
    </Flow>
  );
}

// Paste a backup's JSON and import it.
function ImportModal({ onImport, onClose }) {
  const [text, setText] = useState("");
  const empty = !text.trim();
  return (
    <Flow label="Import from pasted text" onClose={onClose}>
      <div className="shell" style={{ maxWidth: "var(--ovt-content-width)" }}>
        <TopBar title="Import from pasted text" close="Close" onClose={onClose} />
        <div className="main" style={{ gap: 12 }}>
          <p className="t-b">Paste the text of an exported backup (JSON), then import it.</p>
          <label className="field"><span className="lbl">Backup</span><textarea className="input area" rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /></label>
        </div>
        <div className="foot"><button type="button" className="btn btn-p btn-b" aria-disabled={empty || undefined} onClick={() => !empty && onImport(text)}>Import backup</button></div>
      </div>
    </Flow>
  );
}
export default function App() {
  // Logged-out first paint (landing/auth) follows the OS colour
  // scheme, matching the static /legal pages. Once a session loads, the
  // user's saved theme still overrides this (handled in AppInner's settings
  // effects), so signed-in behavior is unchanged.
  const [themeId, setThemeId] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "whitepaperDark"
      : "whitepaperLight"
  );
  return (
    <ThemeProvider themeId={themeId}>
      <ErrorBoundary label="App">
        <ShellProvider>
          <AppInner onThemeChange={setThemeId} />
        </ShellProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
