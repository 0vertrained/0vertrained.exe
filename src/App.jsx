// src/App.jsx
// V8 refactor · App shell only: auth/session, data load + cache, save paths,
// theme, header, nav, overlays, and modals. The four tabs live in their own
// files (TodayTab/ProgressTab/FuelTab/MoreTab) — extracted verbatim, no
// behavior change. DemoPage and FormCheck are lazy: neither is needed for
// first paint, so they load on demand and stay out of the initial bundle.
import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { ThemeProvider, useTheme } from "./theme";
import { DEFAULT_PROGRAM, defaultDay, getTodayKey, getDayName, presetProgram } from "./constants";
import { applyRaceBuild } from "./raceBuild";
import { detectDayZero } from "./dayZero";
import { readOAuthReturn, cleanOAuthReturnUrl } from "./oauthReturn";
import { logFunnelEvent } from "./funnel";
import { logOut, ensureProfileExists } from "./auth";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
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
import { readWearableSnapshot } from "./wearableSnapshotCache";
import { perfStart, perfMark } from "./perf";
import { isCoachEnabled } from "./coachEnabled";
import { DEMO_USER, DEMO_SETTINGS, buildDemoEntries, buildDemoOuraData, getDemoWhoopData, isDemoMode } from "./demoData";
import { Header } from "./AppHeader";
import { BottomNav, QuickActionSheet, QUICK_ACTIONS, TABS_ORDER } from "./AppBottomNav";
import { RefreshingBar } from "./ui/primitives";
import { resolveLoadState } from "./uiStability";
import { isFirstWeekUser, buildNewUserEmptyState, countLoggedDays } from "./firstWeekJourney";
import { ErrorBoundary } from "./ErrorBoundary";
import { TodayTab } from "./TodayTab";

// V8 · Lazy chunks — DemoPage only loads on the #demo route; FormCheck only
// when its overlay opens.
// V12.1 · Everything not needed for first paint is now lazy. TodayTab stays
// eager (it IS first paint); the other three tabs, the Profile overlay,
// Settings, Tutorial, and Coach each load on demand. This cut the entry chunk
// from ~775 KB to roughly a third of that. Each lazy usage below sits inside
// a Suspense with a null/quiet fallback — these panels already render against
// loaded app state, so the flash-of-nothing is a single frame on a warm cache
// and a short beat on first visit.
const DemoPage = lazy(() => import("./DemoPage"));
const FormCheck = lazy(() => import("./FormCheck").then(m => ({ default: m.FormCheck })));
const ProgressTab = lazy(() => import("./ProgressTab").then(m => ({ default: m.ProgressTab })));
const FuelTab = lazy(() => import("./FuelTab").then(m => ({ default: m.FuelTab })));
const MoreTab = lazy(() => import("./MoreTab").then(m => ({ default: m.MoreTab })));
const RecoveryDashboard = lazy(() => import("./RecoveryDashboard").then(m => ({ default: m.RecoveryDashboard })));
const SettingsScreen = lazy(() => import("./SettingsScreen").then(m => ({ default: m.SettingsScreen })));
const Tutorial = lazy(() => import("./Tutorial").then(m => ({ default: m.Tutorial })));
const DayZeroSpecimen = lazy(() => import("./DayZeroSpecimen").then(m => ({ default: m.DayZeroSpecimen })));
const Coach = lazy(() => import("./Coach").then(m => ({ default: m.Coach })));

// The app shell reserves room for the persistent bottom dock during normal tab
// navigation. Profile and Form Check are full-screen overlays that hide that
// dock, so carrying its reserve space into them creates a blank tail on long
// pages. Keep the regular safe-area contract unchanged outside overlays.
export function appShellStyle(appStyle, overlayOpen) {
  return overlayOpen ? { ...appStyle, paddingBottom: 0 } : appStyle;
}

function AppInner({ onThemeChange }) {
  const { C, S, themeId } = useTheme();
  const demoMode = isDemoMode();
  const mono = C.fontFamily;
  const [user, setUser]           = useState(undefined);
  const [tab, setTab]             = useState("Today");
  const [appUpdateReady, setAppUpdateReady] = useState(false);
  const tabScrollPositions = useRef({ Today: 0 });
  // V5.0 nav restructure — overlay is a full-screen panel stacked above the
  // tab content: "profile" (was the More tab) or "formcheck" (was nested
  // three taps deep inside More). null means no overlay is showing.
  const [overlay, setOverlay]     = useState(null); // null | "profile" | "formcheck"
  const [sheetOpen, setSheetOpen] = useState(false); // FAB quick-action sheet
  const [coachOpen, setCoachOpen] = useState(false); // Coach chat sheet — was a floating self-positioned
                                                      // button that overlapped the header; now a normal
                                                      // controlled overlay triggered from the quick-action sheet.
  // Wraps setTab so existing callers (first-week checklist CTAs, etc.) that
  // still target the old "More" tab land on the Profile overlay instead of a
  // tab value that no longer exists in TABS_ORDER.
  const navigateTo = (t) => {
    setSheetOpen(false);
    if (t === "More") { setOverlay("profile"); return; }
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
  // V19.4 · Where Settings opens and the one status line it shows there
  // (Recovery's links and the wearable OAuth return land on Integrations).
  const [settingsLanding, setSettingsLanding] = useState({ section: null, notice: null });
  const openSettings = (section = null, notice = null) => {
    setSettingsLanding({ section, notice });
    setSettingsOpen(true);
    setSheetOpen(false);
  };
  // Latest settings for async merges that outlive the render that started them.
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const [showTutorial, setShowTutorial] = useState(false);
  // V19.4 · null, or why this account can't be shown: "unreachable" (the
  // settings read failed and nothing is cached on this device), "missing" (no
  // profile row) or "cap" (no profile row, and signup is at its user limit).
  // While set, the tabs and Profile show a retry panel instead: setup and the
  // Day Zero samples would otherwise run off default settings, and any
  // settings or program save would write those defaults over the account.
  const [accountUnavailable, setAccountUnavailable] = useState(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [loaded, setLoaded]       = useState(false);
  // V19.4 · This account's settings are known: from a successful read or from
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
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY); // V15.0 · broadsheet shell tier
  // V15.3 · ⌘K palette (mockup 1p): the FAB's quick actions, desktop-native.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const handleQuickAction = (key) => {
    setSheetOpen(false);
    setPaletteOpen(false);
    if (key === "coach") { setCoachOpen(true); return; }
    if (key === "formcheck") { setOverlay("formcheck"); return; }
    setOverlay(null);
    setSelectedDay(null);
    if (key === "meal") navigateTo("Fuel");
    else navigateTo("Today"); // workout + check-in both live on Today
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
  const [ouraRecovery, setOuraRecovery] = useState(null); // biometric recovery score (Oura), if connected
  const [showDemo, setShowDemo] = useState(() => typeof window !== "undefined" && /#\/?demo\b/.test(window.location.hash || ""));
  const [, setCacheStatus] = useState({ cached: false }); // track cache status for potential UI feedback
  const fileRef    = useRef();

  const saveTimers = useRef({});
  const hasLoadedRef = useRef(null); // stores the user id that was last loaded
  // V13.5 · The user whose durable offline queue has been flushed (see the
  // flush effect below). V19.4 · Declared up here so the logged-out branch of
  // the load effect can reset it.
  const pendingFlushedRef = useRef(null);

  // Keep the keyboard focus-ring colour in step with the active theme's ink,
  // and sync the document background/colour so the gutters outside the
  // content width (and overscroll) match the theme. Without this, index.css's
  // static paper values framed the dark themes with light margins — visible
  // on desktop and, since V13.2 bootstraps the logged-out theme from
  // prefers-color-scheme, on the landing page too.
  useEffect(() => {
    document.documentElement.style.setProperty("--ovt-focus", C.text);
    document.documentElement.style.background = C.bg;
    document.body.style.background = C.bg;
    document.body.style.color = C.text;
  }, [C.text, C.bg]);

  // Retrigger the tab-panel enter animation on every tab switch without causing
  // component remounts. Remove the class, force a reflow so the browser discards
  // the previous animation frame, then re-add it.
  const tabPanelRef = useRef(null);
  useEffect(() => {
    const el = tabPanelRef.current;
    if (!el) return undefined;
    el.classList.remove("ovt-tab-enter");
    // Re-add after the next paint so the animation restarts without a forced
    // synchronous layout read on every tab switch.
    const frame = requestAnimationFrame(() => el.classList.add("ovt-tab-enter"));
    return () => cancelAnimationFrame(frame);
  }, [tab]);

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
  // V14.2 · Snapshot-first. The persisted wearable snapshot (written by
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
          // V15.5 · The demo decision engine runs on the demo wearable data —
          // same math, seeded inputs.
          const rec = calcOuraRecovery(buildDemoOuraData(), DEMO_SETTINGS, getDemoWhoopData());
          if (!cancelled) { setOuraRecovery(Number.isFinite(rec?.score) ? rec.score : null); perfMark("boot", "wearable-score-ready"); }
          return;
        }
        if (!user?.id) { if (!cancelled) setOuraRecovery(null); return; }
        const snap = readWearableSnapshot(user.id);
        const snapScore = Number.isFinite(snap?.recovery?.score) ? snap.recovery.score : null;
        const snapIsToday = snap?.savedAt
          ? new Date(snap.savedAt).toDateString() === new Date().toDateString()
          : false;
        if (snapScore != null && snapIsToday) {
          if (!cancelled) { setOuraRecovery(snapScore); perfMark("boot", "wearable-score-ready"); }
          return;
        }
        // V16.0 · Whoop rides along (single-flighted — collapses with
        // TodayTab's concurrent load) so the boot score inherits the ladder.
        const [oura, whoopForScore] = await Promise.all([
          loadOuraData(14),
          loadWhoopData(14).catch(() => null),
        ]);
        const rec = calcOuraRecovery(oura, settings, whoopForScore);
        if (!cancelled) {
          setOuraRecovery(Number.isFinite(rec?.score) ? rec.score : null);
          perfMark("boot", "wearable-score-ready");
        }
      } catch {
        if (!cancelled) setOuraRecovery(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, demoMode, settings]);

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
      setData({}); setProgram(null); setLoaded(false); setRefreshing(false);
      // V19.4 · Nothing from the last account carries into the next one on this
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

    perfStart("boot"); // V14.2 · instrumentation — Settings → About → Diagnostics

    // Step 1: Try to read from cache synchronously
    const cachedData = readCache(user.id);
    const cacheStatus = getCacheStatus(user.id);
    setCacheStatus(cacheStatus);

    // V13.5 · Overlay the durable offline queue onto whatever loads. A queued
    // entry exists precisely because the server hasn't accepted it yet, so the
    // local copy is canonical over both the cache snapshot and the fresh fetch
    // (whole-day payloads; last local edit wins — single-account beta). The
    // flush effect below retries each one once the load settles.
    const storedPending = readPendingSaves(user.id);
    if (Object.keys(storedPending).length) {
      setPendingSaves(prev => ({ ...storedPending, ...prev }));
    }

    // V19.4 · A cache without settings can't stand in for the account (the
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
        // V14.1 · Signup-orphan self-heal: a session with no profiles row (auth
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
        // V14.3 · Windowed boot (perf plan P1-1). The blocking load fetches
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

        // V19.4 · A failed read is not a new account. The plain loaders answer
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
        // V19.4 · Back from a wearable's OAuth screen (or an old /settings
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
    // V19.4 · themeId is read above but deliberately not a dependency. The
    // cached boot switches to the saved theme, and as a dependency that change
    // cancelled this run before the revalidation (and the OAuth return) could
    // finish, leaving stale data and the refresh bar up whenever the saved
    // theme differed from the phone's light/dark setting. (In demo mode it also
    // rebuilt the demo data on every theme change.) bootAttempt is the retry
    // panel's "Try again".
  }, [user, authReady, demoMode, onThemeChange, bootAttempt]);


  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); }, []);

  useEffect(() => {
    const onUpdate = () => setAppUpdateReady(true);
    window.addEventListener("ovt:service-worker-update", onUpdate);
    return () => window.removeEventListener("ovt:service-worker-update", onUpdate);
  }, []);

  const todayKey  = logDate || getTodayKey();
  const todayName = getDayName(logDate ? new Date(logDate + "T12:00:00") : new Date());
  const todayData = data[todayKey] || defaultDay();
  // V19.2 · Race-build overlay: consuming surfaces see the current build week;
  // MoreTab keeps the raw template so edits target the source of truth.
  const liveProgram = useMemo(() => applyRaceBuild(program, todayKey), [program, todayKey]);

  // Debounced per-day save with offline retry queue
  const scheduleSave = useCallback((dateKey, dayPayload) => {
    if (demoMode) return;
    if (saveTimers.current[dateKey]) clearTimeout(saveTimers.current[dateKey]);
    saveTimers.current[dateKey] = setTimeout(async () => {
      setSaving(true);
      const res = await saveEntry(dateKey, dayPayload);
      setSaving(false);
      if (res.error) {
        // Queue any failed save, not just browser-detected offline failures.
        // Gyms are full of half-dead networks; navigator.onLine can lie.
        setPendingSaves(prev => ({ ...prev, [dateKey]: dayPayload }));
        // V13.5 · Optimistic cache write on FAILURE too — previously only
        // successful saves reached appDataCache, so a reload mid-outage
        // dropped the entry from the UI even though it was queued. Belt and
        // suspenders with the pendingSavesStore overlay on boot.
        if (user?.id && accountReadyRef.current) { // V19.4 · only once the account's settings are known
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
        if (user?.id && accountReadyRef.current) { // V19.4 · only once the account's settings are known
          writeCache(user.id, {
            entries: { ...data, [dateKey]: dayPayload },
            program,
            settings,
            myUsername,
          });
        }
      }
    }, 700);
    // showToast is a stable useCallback([]) — intentionally omitted; including
    // it makes the React Compiler drop memoization here (compile-skip error).
  }, [demoMode, isOnline, user?.id, data, program, settings, myUsername]);

  // V13.5 · Flush the durable offline queue once per loaded user. Gated on
  // `loaded` so the data overlay in the load effect has already landed; the
  // ref makes the scheduleSave dependency churn harmless (re-runs no-op).
  // Declared AFTER scheduleSave — the dependency array evaluates at render
  // time, so referencing the const above avoids a temporal-dead-zone crash.
  // V19.4 · Gated on accountReady, not just loaded: behind the retry panel the
  // account's settings are unknown.
  useEffect(() => {
    const uid = user?.id;
    if (!uid || demoMode || !accountReady) return;
    if (pendingFlushedRef.current === uid) return;
    pendingFlushedRef.current = uid;
    Object.entries(readPendingSaves(uid)).forEach(([dateKey, payload]) => scheduleSave(dateKey, payload));
  }, [user?.id, demoMode, accountReady, scheduleSave]);

  // V13.5 · Write-through: every queue change persists, so an iOS suspend or
  // app close mid-outage no longer loses queued workouts. The empty-pre-flush
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

  // V19.4 · A device that turned notifications on before the push endpoint was
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
      // Retry pending saves. V13.5 · toast only when something is actually
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
      const updated = setPath(current, path.split("."), value);
      const next = { ...prev, [dateKey]: updated };
      // Optimistically cache local edits so a reload does not drop visible work
      // while a debounced/offline save is still pending. V19.4 · Only once the
      // account's settings are known (accountReady).
      if (!demoMode && user?.id && accountReadyRef.current) {
        writeCache(user.id, { entries: next, program, settings, myUsername });
      }
      scheduleSave(dateKey, updated);
      return next;
    });
  };

  const updateToday = (path, value) => updateEntryAtDate(todayKey, path, value);

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

  // V19.4 · Quiet patch for Integrations: it persists a connection flag the
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

  // V18.6 · Persist coaching-system changes without opening or closing the
  // generic Settings screen. Approved plan versions can update the real goal
  // targets, while guardrails, projection ranges, and notification policy stay
  // namespaced under settings.coachingSystem.
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

  // V4.5 — persist the opt-in Coach Memory preferences from the More hub. This is
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

  // Handle tutorial completion — apply full V2.2 setup payload + mark onboarded.
  // Backward compatible: older callers pass a bare program-preset id string.
  const handleTutorialComplete = async (payload) => {
    const setup = typeof payload === "string" ? { programPreset: payload } : (payload || {});

    // Merge onboarding fields over existing settings without clobbering
    // theme / social / dietary / supplements / oura state.
    let mergedSettings = mergeOnboardingSettings(settings, {
      goal: setup.goal,
      dataMode: setup.dataMode,
      macroPreset: setup.macroPreset,
      customGoals: setup.customGoals,
      completedAt: new Date().toISOString(),
    });

    // Resolve the starter program. V2.3: if onboarding collected Program Builder
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
      // V19.5 · Every listed preset carries its own program (hybrid included);
      // an unknown id still falls back to DEFAULT_PROGRAM.
      programToSave = presetProgram(programPreset);
    }

    if (!demoMode) {
      // V19.4 · Setup only counts once it's saved. These results used to be
      // ignored: a failed save closed the wizard as if all was well, and it
      // came back on the next launch. Now the wizard stays on its last step
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
        showToast("Setup didn't save. Check your connection and tap Finish again.");
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
  const handleSaveProgram = async (newProgram) => {
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
    showToast("Program saved");
    return true;
  };

  // Apply a Program Builder V2 (V2.3) generated plan. Explicit user action from
  // the builder panel's Apply button — nothing here runs before Apply. Saves the
  // generated program via the existing program path AND merges the builder
  // preferences into settings.programBuilder WITHOUT clobbering other settings.
  const handleApplyGeneratedProgram = async ({ program: generatedProgram, preferences }) => {
    const mergedSettings = {
      ...settings,
      programBuilder: { ...(settings.programBuilder || {}), ...(preferences || {}) },
    };
    if (demoMode) {
      setProgram(generatedProgram);
      setSettings(mergedSettings);
      showToast("Demo plan applied locally");
      return true;
    }
    setSaving(true);
    const res = await saveProgram(generatedProgram);
    if (res.error) { setSaving(false); showToast(res.error || "Program save error"); return false; }
    // Program is saved; persist preferences too. If preferences fail we keep the
    // applied program and surface a softer message rather than rolling back.
    const sres = await saveSettings(mergedSettings);
    setSaving(false);
    setProgram(generatedProgram);
    setSettings(mergedSettings);
    if (user?.id) {
      writeCache(user.id, { entries: data, program: generatedProgram, settings: mergedSettings, myUsername });
    }
    showToast(sres?.error ? "Plan applied · prefs not saved" : "Plan applied");
    return true;
  };

  // Export / import helpers
  // V19.4 · note: one line about what the file holds (an incomplete export),
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

  // V19.4 · Exports cover the whole history. In-memory `data` is the 180-day
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
    // Keep cache warm after successful import (V19.4 · once the account is known)
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

  // V17.0 · Funnel: mark the wearable-connected step once per session. Lives
  // above ALL early returns (rules-of-hooks); the derivation is inlined here
  // because the render-side `ouraConnected` const is computed after them.
  useEffect(() => {
    const connected = settings?.ouraConnected === true || ouraRecovery != null;
    if (connected && loaded) logFunnelEvent("oura_connected");
  }, [settings?.ouraConnected, ouraRecovery, loaded]);

  if (user === undefined) return (
    <div style={{ ...S.app, display:"flex", alignItems:"center", justifyContent:"center", height:"100dvh" }}>
      <span style={{ color: C.textDim, fontSize:11.5, letterSpacing:"0.2em" }}>LOADING...</span>
    </div>
  );
  if (showDemo) return <Suspense fallback={null}><DemoPage onClose={() => { try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch {} setShowDemo(false); }} /></Suspense>;
  if (!user && !demoMode) return <AuthScreen onAuthed={u => setUser(u)} />;

  const yesterdayKey = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();

  // First-week baseline state for the additive per-tab guidance banners. Gated on
  // `loaded` so a tab never flashes a banner before its real data resolves.
  const ouraConnected = settings?.ouraConnected === true || ouraRecovery != null;
  // V17.0 · Day Zero — per-tab zero states. Computed every render (cheap:
  // key scans over the entries map); gated on `loaded` at the render sites so
  // specimens never flash during boot. Demo mode counts as real data.
  const dayZero = detectDayZero({ data, settings, ouraConnected, demoMode });
  // V19.4 · The retry panel's "Try again": run the launch again for this account.
  // Loading state first, so the tabs show their skeletons, not samples built
  // from the defaults, until the account answers.
  const retryBoot = () => { hasLoadedRef.current = null; setLoaded(false); setAccountUnavailable(null); setBootAttempt((n) => n + 1); };
  const handleLogout = async () => { if (!demoMode) { const id = user?.id || hasLoadedRef.current; await logOut(); clearCache(id); clearRecoveryDashboardCache(id); clearAlertHistory(id); } setUser(demoMode ? DEMO_USER : null); hasLoadedRef.current = null; };
  const firstWeek = loaded && isFirstWeekUser(settings, data);
  const appLoadState = resolveLoadState({ loaded, refreshing });
  const coachEnabled = isCoachEnabled(user?.id);

  return (
    <div className="ovt-app-shell" style={appShellStyle(S.app, Boolean(overlay))}>
      {showTutorial && (
        <Suspense fallback={null}>
          <Tutorial
            username={myUsername || "athlete"}
            onComplete={handleTutorialComplete}
            theme={themeId}
          />
        </Suspense>
      )}
      {/* V13 masthead — logout moved into Profile → Account + Data; at desktop
          the header also carries the tab nav + "+ Log" (see AppHeader). Tab
          changes from the masthead close any overlay first so desktop nav
          always lands on the tab, never behind Profile/Form Check. */}
      <Header saving={saving} demoMode={demoMode} onOpenProfile={() => setOverlay("profile")} allData={data} isOnline={isOnline} pendingSaves={pendingSaves} currentTab={tab} onTabChange={(t) => { setOverlay(null); navigateTo(t); setSelectedDay(null); }} onQuickAction={() => (isBroadsheet ? setPaletteOpen(true) : setSheetOpen(true))} tabsOrder={TABS_ORDER} program={liveProgram} todayName={todayName} logDate={logDate} />
      {appLoadState.showRefreshing && <RefreshingBar label="Refreshing latest data in background…" />}

      {/* ── Full-screen overlays: Profile (was More) and Form Check (was three
             taps deep inside More). Replaces tab content rather than layering
             over it, and hides the tab bar — a clear "pushed screen" rather
             than a fifth destination. ── */}
      {overlay === "profile" && (
        <div style={isBroadsheet ? { maxWidth: "var(--ovt-content-width)", margin: "0 auto", width: "100%" } : undefined}>
          <div style={S.overlayBackRow}>
            <button type="button" style={S.overlayBackBtn} onClick={() => setOverlay(null)}>← Back</button>
            <span style={S.overlayBackTitle}>Profile</span>
          </div>
          {accountUnavailable ? <AccountUnavailable reason={accountUnavailable} onRetry={retryBoot} onLogout={handleLogout} /> : !loaded ? <AccountLoading /> : (<>
          <BaselineBanner tab="More" firstWeek={firstWeek} settings={settings} entries={data} program={liveProgram} ouraConnected={ouraConnected} />
          <ErrorBoundary label="Profile">
          <Suspense fallback={null}>
          <MoreTab
            program={program} onSaveProgram={handleSaveProgram}
            onApplyGeneratedProgram={handleApplyGeneratedProgram}
            exportJSON={exportJSON} exportCSV={exportCSV} fileRef={fileRef}
            onPasteImport={() => setImportOpen(true)}
            onSettings={() => { openSettings(); setOverlay(null); }}
            onLogout={handleLogout}
            myUsername={myUsername}
            settings={settings}
            allData={data}
            showToast={showToast}
            onSaveCoachPreferences={handleSaveCoachPreferences}
          />
          </Suspense>
          </ErrorBoundary>
          </>)}
        </div>
      )}
      {overlay === "formcheck" && (
        <div style={isBroadsheet ? { maxWidth: "min(1360px, 100%)", margin: "0 auto", width: "100%" } : undefined}>
          <div style={S.overlayBackRow}>
            <button type="button" style={S.overlayBackBtn} onClick={() => setOverlay(null)}>← Back</button>
            <span style={S.overlayBackTitle}>Form Check</span>
          </div>
          <ErrorBoundary label="Form Check"><Suspense fallback={null}><FormCheck /></Suspense></ErrorBoundary>
        </div>
      )}

      {!overlay && (
        <>
          <div ref={tabPanelRef} id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} style={{ outline: "none" }}>
          {/* V9 · key={tab} resets the boundary on tab switch, so a crash in
              one tab never leaves another tab stuck on the fallback. */}
          <ErrorBoundary key={tab} label={`${tab} tab`}>
          <Suspense fallback={null}>
          {/* V15.0 · At the broadsheet tier only Today composes into columns
              (this slice); the other tabs keep their reading-column layout,
              centered inside the widened shell, until their V15.1–.2 spreads
              land. Below 1440px this wrapper is display:contents — the DOM
              gains a node but layout is byte-identical to V14. */}
          <div style={isBroadsheet && !["Today", "Fuel", "Recovery", "Progress"].includes(tab) ? { maxWidth: "var(--ovt-content-width)", margin: "0 auto", width: "100%" } : { display: "contents" }}>
          {accountUnavailable ? <AccountUnavailable reason={accountUnavailable} onRetry={retryBoot} /> : (<>
          {tab === "Today"   && (loaded && dayZero.today.isZero
            ? <Suspense fallback={null}><DayZeroSpecimen tab="Today" onAction={() => setShowTutorial(true)} /></Suspense>
            : <TodayTab   todayName={todayName} todayData={todayData} updateToday={updateToday} updateEntryAtDate={updateEntryAtDate} showToast={showToast} onExport={exportJSON} loaded={loaded} program={liveProgram} settings={settings} allData={data} logDate={logDate} setLogDate={setLogDate} ouraRecovery={ouraRecovery} setTab={navigateTo} saving={saving} isOnline={isOnline} savePending={Boolean(pendingSaves[todayKey])} />)}
          {tab === "Fuel"    && (loaded && dayZero.fuel.isZero
            ? <Suspense fallback={null}><DayZeroSpecimen tab="Fuel" onAction={() => setShowTutorial(true)} /></Suspense>
            : <><BaselineBanner tab="Fuel" firstWeek={firstWeek} settings={settings} entries={data} program={liveProgram} ouraConnected={ouraConnected} /><FuelTab settings={settings} todayData={todayData} updateToday={updateToday} showToast={showToast} todayKey={todayKey} loaded={loaded} data={data} /></>)}
          {tab === "Recovery" && (loaded && dayZero.recovery.isZero
            ? <Suspense fallback={null}><DayZeroSpecimen tab="Recovery" onAction={() => openSettings("integrations")} /></Suspense>
            : <><BaselineBanner tab="Recovery" firstWeek={firstWeek} settings={settings} entries={data} program={liveProgram} ouraConnected={ouraConnected} /><RecoveryDashboard data={data} settings={settings} yesterdayKey={yesterdayKey} appLoaded={loaded} userId={user?.id} todayKey={todayKey} todayName={todayName} updateToday={updateToday} onOpenIntegrations={() => openSettings("integrations")} /></>)}
          {tab === "Progress"&& (loaded && dayZero.progress.isZero
            ? <Suspense fallback={null}><DayZeroSpecimen tab="Progress" progressInfo={dayZero.progress} /></Suspense>
            : <><BaselineBanner tab="Progress" firstWeek={firstWeek} settings={settings} entries={data} program={liveProgram} ouraConnected={ouraConnected} /><ProgressTab data={data} settings={settings} program={liveProgram} loaded={loaded} updateEntryAtDate={updateEntryAtDate} showToast={showToast} onSaveCoachingSettings={handleSaveCoachingSystemSettings} /></>)}
          </>)}
          </div>
          </Suspense>
          </ErrorBoundary>
          </div>
          <BottomNav
            currentTab={tab}
            onTabChange={(t) => { navigateTo(t); setSelectedDay(null); }}
            tabsOrder={TABS_ORDER}
            onQuickAction={() => (isBroadsheet ? setPaletteOpen(true) : setSheetOpen(true))}
          />
        </>
      )}

      {isBroadsheet && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          actions={coachEnabled ? [...QUICK_ACTIONS, { key: "coach", label: "Ask Coach", sub: "Chat about training, fuel, recovery" }] : QUICK_ACTIONS}
          tabs={TABS_ORDER}
          onAction={handleQuickAction}
          onNavigate={(t) => { setPaletteOpen(false); setOverlay(null); navigateTo(t); setSelectedDay(null); }}
        />
      )}
      <QuickActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        actions={coachEnabled ? [...QUICK_ACTIONS, { key: "coach", label: "Ask Coach", sub: "Chat about training, fuel, recovery" }] : QUICK_ACTIONS}
        onAction={handleQuickAction}
      />

      {appUpdateReady && (
        <div role="status" aria-live="polite" style={{ position:"fixed", bottom:76, left:"50%", transform:"translateX(-50%)", width:"max-content", maxWidth:"calc(min(var(--ovt-content-width), 100vw) - 32px)", background:C.text, color:C.bg, padding:"9px 12px", border:`1px solid ${C.text}`, fontSize:11, letterSpacing:"0.08em", textTransform:"uppercase", zIndex:1000, fontFamily:mono, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", justifyContent:"center" }}>
          <span>Updated — reload for the newest version</span>
          <button type="button" onClick={() => window.location.reload()} style={{ background:C.bg, color:C.text, border:`1px solid ${C.bg}`, padding:"5px 9px", fontFamily:mono, fontSize:10, textTransform:"uppercase", cursor:"pointer" }}>Reload</button>
        </div>
      )}
      {toast && !appUpdateReady && <div role="status" aria-live="polite" style={{ position:"fixed", bottom:76, left:"50%", transform:"translateX(-50%)", width:"max-content", maxWidth:"calc(min(var(--ovt-content-width), 100vw) - 32px)", background:C.bg, color:C.text, padding:"7px 16px", border:`1px solid ${C.line}`, fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", zIndex:999, fontFamily:mono, whiteSpace:"normal", textAlign:"center", overflowWrap:"anywhere" }}>{toast}</div>}
      <input ref={fileRef} type="file" accept=".json" aria-label="Import data from JSON file" style={{ display:"none" }} onChange={importFile} />
      {exportModal && <ExportModal modal={exportModal} onClose={() => setExportModal(null)} showToast={showToast} />}
      {settingsOpen && accountReady && <Suspense fallback={null}><SettingsScreen settings={settings} onSave={handleSaveSettings} onPatch={handlePatchSettings} onClose={() => setSettingsOpen(false)} busy={settingsBusy} onThemeChange={handleThemeChange} currentTheme={themeId} initialSection={settingsLanding.section} notice={settingsLanding.notice} loggedDays={countLoggedDays(data)} currentTab={tab} /></Suspense>}
      {importOpen  && <ImportModal onImport={importFromText} onClose={() => setImportOpen(false)} />}
      {/* Coach stays always-mounted (it manages its own open/close animation and
          in-flight request state); lazy just moves its code out of the entry
          chunk. coachEnabled gates whether it can ever open, so skip the chunk
          fetch entirely for accounts that will never see it. */}
      {coachEnabled && <Suspense fallback={null}><Coach data={data} settings={settings} program={liveProgram} todayKey={todayKey} todayName={todayName} userId={user?.id} open={coachOpen} onClose={() => setCoachOpen(false)} /></Suspense>}
    </div>
  );
}


// ─── Today Tab ────────────────────────────────────────────────────────────────
// ─── Daily Coach Hero ──────────────────────────────────────────────────────────
// V19.4 · Shown in place of the tabs and Profile while the account can't be
// loaded (see accountUnavailable in AppInner). Nothing behind it may run off
// default settings: no setup, no samples, no settings or program saves.
const ACCOUNT_UNAVAILABLE_COPY = {
  unreachable: { title: "Couldn't reach your account", body: "The server didn't answer, and nothing from this account is saved on this device yet. Your data is safe. Check your connection and try again." },
  missing: { title: "Your account isn't set up yet", body: "Signing up didn't finish on the server, so there's nothing to load yet. Try again in a moment." },
  cap: { title: "Your account isn't set up yet", body: "The beta is at its user limit, so account setup is paused. Nothing is lost. Try again later." },
};
function AccountUnavailable({ reason, onRetry, onLogout }) {
  const { C, S } = useTheme();
  const copy = ACCOUNT_UNAVAILABLE_COPY[reason] || ACCOUNT_UNAVAILABLE_COPY.unreachable;
  return (
    <section role="alert" data-testid="account-unavailable" style={S.block}>
      <div style={{ fontFamily: S.fontSerif, fontSize: 22, color: C.text, lineHeight: 1.2, marginBottom: 8 }}>{copy.title}</div>
      <p style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, margin: "0 0 12px" }}>{copy.body}</p>
      <button type="button" onClick={onRetry} style={{ ...S.foodBtn, marginTop: 0, borderColor: C.text }}>Try again</button>
      {onLogout && <button type="button" onClick={onLogout} style={{ ...S.foodBtn, background: "none" }}>Log out</button>}
    </section>
  );
}

// V19.4 · Profile while the account is still loading: its settings aren't
// known yet, so Settings and the program editors wait.
function AccountLoading() {
  const { C, S } = useTheme();
  return <section role="status" style={S.block}><div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>Loading your account…</div></section>;
}

function BaselineBanner({ tab, firstWeek, settings, entries, program, ouraConnected }) {
  const { C, S } = useTheme();
  if (!firstWeek) return null;
  const es = buildNewUserEmptyState(tab, { settings, entries, program, ouraConnected });
  if (!es) return null;
  return (
    <section style={{ ...S.block, background: C.block }}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{es.title}</span>
        <span style={S.blockStat}>Baseline week</span>
      </div>
      <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5 }}>{es.message}</div>
    </section>
  );
}

// ─── First-week setup card ──────────────────────────────────────────────────────
// Compact "Baseline week" card shown near the top of Today for new beta users.
// One-line explanation, checklist progress (n/6), the next step + CTA, a subtle
// expand/collapse for the full checklist, and a privacy-safe beta feedback note.
// CTAs navigate existing tabs via setTab — no new nav structure. Whitepaper
// aesthetic throughout: soft C.line hairlines, mono labels, serif is avoided
// here to keep the card quiet.
function ExportModal({  modal, onClose, showToast }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const taRef = useRef();
  const copyAll = async () => {
    try { await navigator.clipboard.writeText(modal.text); showToast("Copied to clipboard"); }
    catch { if (taRef.current) { taRef.current.focus(); taRef.current.select(); } showToast("Select all + copy"); }
  };
  return (
    <div style={{ position:"fixed", inset:0, background:C.bg, zIndex:1000, display:"flex", flexDirection:"column", padding:16, maxWidth:"var(--ovt-content-width)", margin:"0 auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:13, letterSpacing:"0.2em", color:C.text, textTransform:"uppercase" }}>{"> "}{modal.label}</span>
        <button style={S.smallBtn} onClick={onClose}>✕ Close</button>
      </div>
      <div style={{ fontSize:11, color:C.textDim, marginBottom:8, lineHeight:1.6 }}>Copy and save this anywhere. Restore it later via Import.</div>
      {modal.note && <div role="status" style={{ fontSize:11, color:C.red, marginBottom:8, lineHeight:1.6 }}>{modal.note}</div>}
      <textarea ref={taRef} readOnly value={modal.text} onFocus={e => e.target.select()} style={{ flex:1, background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, fontFamily:mono, fontSize:11.5, padding:10, resize:"none", outline:"none", width:"100%", boxSizing:"border-box" }} />
      <button style={{ ...S.foodBtn, marginTop:10 }} onClick={copyAll}>Copy All to Clipboard</button>
    </div>
  );
}

function ImportModal({  onImport, onClose }) {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const [text, setText] = useState("");
  return (
    <div style={{ position:"fixed", inset:0, background:C.bg, zIndex:1000, display:"flex", flexDirection:"column", padding:16, maxWidth:"var(--ovt-content-width)", margin:"0 auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:13, letterSpacing:"0.2em", color:C.text, textTransform:"uppercase" }}>{"> "}Paste Backup</span>
        <button style={S.smallBtn} onClick={onClose}>✕ Close</button>
      </div>
      <div style={{ fontSize:11, color:C.textDim, marginBottom:8, lineHeight:1.6 }}>Paste exported JSON, then restore.</div>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="paste JSON here..." style={{ flex:1, background:C.cell, border:`1px solid ${C.lineBright}`, color:C.text, fontFamily:mono, fontSize:11.5, padding:10, resize:"none", outline:"none", width:"100%", boxSizing:"border-box" }} />
      <button style={{ ...S.foodBtn, marginTop:10 }} onClick={() => onImport(text)}>Restore From Pasted Data</button>
    </div>
  );
}

export default function App() {
  // V13.2 · Logged-out first paint (landing/auth) follows the OS colour
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
        <AppInner onThemeChange={setThemeId} />
      </ErrorBoundary>
    </ThemeProvider>
  );
}
