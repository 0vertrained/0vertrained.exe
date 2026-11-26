import { useIsDesktop, useIsBroadsheet } from "./ui/useMediaQuery";
import { Icon, SyncStatus, TopBar, Wordmark } from "./ui/ledger";
import { useScreenFocus } from "./ui/shell";

// Calculate streak
export function calcStreak(data) {
  // Count consecutive days with any logged data ending today or yesterday.
  // Returns { count, active } where active=true if today is already logged.
  let streak = 0;
  const today = new Date();
  let active = false;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const entry = data[key];
    const hasData = entry && (
      Object.keys(entry.workout?.exercises || {}).length > 0 ||
      parseFloat(entry.workout?.cardio?.miles) > 0 ||
      parseFloat(entry.nutrition?.calories) > 0
    );
    if (hasData) {
      streak++;
      if (i === 0) active = true;
    } else if (i > 0) break;
  }
  return { count: streak, active };
}

// Sync status in three words: Saving, Saved or Offline, with the number of
// queued changes. The screen-reader sentence answers "is my workout safe?".
export function syncState({ isOnline, saving, pendingCount, demoMode }) {
  const changes = `${pendingCount} change${pendingCount === 1 ? "" : "s"}`;
  if (demoMode) return { key: "demo", label: "Demo", sr: "Demo mode. Changes are not saved." };
  if (!isOnline) return {
    key: "offline",
    label: pendingCount ? `Offline · ${pendingCount} queued` : "Offline",
    sr: pendingCount ? `Offline. ${changes} saved on this device, will sync when you reconnect.` : "Offline. Changes are saved on this device.",
  };
  if (saving) return { key: "saving", label: "Saving", sr: "Saving your changes." };
  if (pendingCount) return { key: "queued", label: "Saving", sr: `Saved on this device. Syncing ${changes} now.` };
  return { key: "synced", label: "Saved", sr: "All changes saved." };
}

// The top bar. On a phone it holds the screen's h1, sync status and Profile;
// a screen one level down swaps the mark for a labelled Back, and a
// full-screen one for a labelled Close. At 1024 px and up the four tabs move
// into the bar in the same order, Log sits beside them, and the screen's h1
// moves into the page (see ScreenTitle in App.jsx).
export function Header({ title, sub, back, onBack, close, onClose, saving, demoMode, onOpenProfile, isOnline, pendingSaves, currentTab, onTabChange, onQuickAction, onOpenPalette, tabsOrder = [] }) {
  const isDesktop = useIsDesktop();
  const isBroadsheet = useIsBroadsheet();
  const pendingCount = Object.keys(pendingSaves || {}).length;
  const status = syncState({ isOnline, saving, pendingCount, demoMode });
  useScreenFocus({ title, back, close });

  if (!isDesktop) {
    return <TopBar title={title} sub={sub} back={back} onBack={onBack} close={close} onClose={onClose} status={status} onProfile={onOpenProfile} />;
  }

  return (
    <header className="dtop">
      <Wordmark style={{ marginRight: 16 }} />
      {tabsOrder.length > 0 && typeof onTabChange === "function" && (
        <nav className="dnav" aria-label="Primary">
          {tabsOrder.map((t) => (
            <button key={t} type="button" id={`tab-${t}`} data-t={t} aria-current={currentTab === t ? "page" : undefined} onClick={() => onTabChange(t)}>{t}</button>
          ))}
        </nav>
      )}
      <span className="grow" />
      {typeof onQuickAction === "function" && (
        <button type="button" className="btn btn-s btn-sm" aria-haspopup="dialog" onClick={onQuickAction} style={{ borderWidth: 2, borderColor: "var(--ink)" }}><Icon name="plus" size="s" />Log</button>
      )}
      {isBroadsheet && typeof onOpenPalette === "function" && (
        <button type="button" className="btn btn-s btn-sm" aria-haspopup="dialog" onClick={onOpenPalette}><span className="kbd" aria-hidden="true">⌘K</span>Shortcuts</button>
      )}
      <SyncStatus status={status} className="t-s c2" style={{ margin: "0 8px" }} />
      {typeof onOpenProfile === "function" && (
        <button type="button" className="ibtn" aria-label="Profile and settings" onClick={onOpenProfile}><Icon name="user" /></button>
      )}
    </header>
  );
}
