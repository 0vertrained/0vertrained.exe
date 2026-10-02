import { useTheme } from "./theme";
import { useIsDesktop, useIsBroadsheet } from "./ui/useMediaQuery";
import { WordmarkTheta } from "./ui/WordmarkTheta";

// ─── Calculate streak ───────────────────────────────────────────────────────
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

// Resolve the sync state into a labelled, colour-coded descriptor. The three
// distinct states (offline / in-flight / settled) each get their own wording
// so "is my workout safe?" is always answerable at a glance.
function syncState({ isOnline, saving, pendingCount, demoMode }) {
  if (demoMode)   return { key: "demo",    label: "DEMO",    sr: "Demo mode — changes are not saved",                  dot: "muted" };
  if (!isOnline)  return { key: "offline", label: pendingCount ? `OFFLINE · ${pendingCount} QUEUED` : "OFFLINE",
                            sr: pendingCount ? `Offline. ${pendingCount} change${pendingCount===1?"":"s"} saved on this device, will sync when you reconnect.` : "Offline. Changes are saved on this device.", dot: "warn" };
  if (saving)     return { key: "saving",  label: "SAVING",  sr: "Saving your changes.",                                dot: "busy" };
  if (pendingCount) return { key: "queued", label: `SYNCING · ${pendingCount}`,
                            sr: `Saved on this device. Syncing ${pendingCount} change${pendingCount===1?"":"s"} now.`, dot: "busy" };
  return { key: "synced", label: "SYNCED", sr: "All changes synced.", dot: "ok" };
}

// ─── Header Component ──────────────────────────────────────────────────────
// V13 masthead. One row of chrome instead of three: wordmark + issue number on
// the left, sync status and actions on the right. At >=1024px the four tabs
// move INTO the masthead (broadsheet navigation) and a "+ Log" action replaces
// the mobile FAB; the bottom dock unmounts (see AppBottomNav). Logout moved to
// Profile → Account + Data, where a once-a-quarter action belongs. Each tab's
// own hero carries the day's headline now, so the big title row is gone —
// that returns ~60px of viewport to every scroll.
export function Header({ saving, demoMode, onOpenProfile, allData, isOnline, pendingSaves, currentTab, onTabChange, onQuickAction, tabsOrder = [], program, todayName, logDate }) {
  const { C, S } = useTheme();
  const mono = S.fontAnnot;
  const isDesktop = useIsDesktop();
  const isBroadsheet = useIsBroadsheet();
  const pendingCount = Object.keys(pendingSaves || {}).length;
  const st = syncState({ isOnline, saving, pendingCount, demoMode });
  const dotColor = { ok: C.greenMid, busy: C.textDim, warn: C.red, muted: C.textFaint }[st.dot] || C.textDim;
  const labelColor = st.dot === "warn" ? C.red : st.dot === "ok" ? C.greenMid : C.textDim;
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const showNav = isDesktop && Array.isArray(tabsOrder) && tabsOrder.length > 0 && typeof onTabChange === "function";

  return (
    <header style={{ ...(isBroadsheet ? { position: "sticky", top: 0, zIndex: 40, background: C.bg } : null), ...S.header, padding: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "stretch", gap: 16, padding: "0 16px", minHeight: 46 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <h1 style={{ ...S.wordmark, fontSize: 14, margin: 0 }} aria-label="Overtrained — training ledger">
            <span style={S.wordmarkTheta} aria-hidden="true"><WordmarkTheta /></span>
            <span aria-hidden="true">VERTRAINED</span>
          </h1>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textFaint, whiteSpace: "nowrap" }} aria-hidden="true">
            No. {dayOfYear}
          </span>
          {isBroadsheet && (
            <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textFaint, whiteSpace: "nowrap" }} aria-hidden="true">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][now.getDay()]} · {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][now.getMonth()]} {now.getDate()} {now.getFullYear()}
            </span>
          )}
        </span>

        {showNav && (
          <nav aria-label="Primary" style={{ display: "flex", alignItems: "stretch", gap: 22 }}>
            <div role="tablist" aria-label="Sections" style={{ display: "flex", alignItems: "stretch", gap: 22 }}>
              {tabsOrder.map((t) => {
                const active = currentTab === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    id={`tab-${t}`}
                    aria-selected={active}
                    aria-current={active ? "page" : undefined}
                    aria-controls="tabpanel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => onTabChange(t)}
                    style={{ background: "none", border: "none", borderBottom: active ? `2px solid ${C.text}` : "2px solid transparent", padding: "0 2px", cursor: "pointer", fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: active ? C.text : C.navInactiveTxt, fontWeight: active ? 600 : 500, WebkitTapHighlightColor: "transparent", transition: "color 140ms ease" }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        <span style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
          {/* Sync status — announced politely to assistive tech when it changes. */}
          <span
            role="status"
            aria-live="polite"
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: labelColor, letterSpacing: "0.05em", fontFamily: mono }}
          >
            <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
            <span aria-hidden="true">{st.label}</span>
            <span className="sr-only">{st.sr}</span>
          </span>
          {isDesktop && typeof onQuickAction === "function" && (
            <>
            <button
              type="button"
              onClick={onQuickAction}
              aria-label="Quick log — workout, form check, meal, or check-in"
              style={{ background: C.text, color: C.bg, border: `1px solid ${C.text}`, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: mono, padding: "7px 13px", fontWeight: 500 }}
            >
              + Log
            </button>
            {isBroadsheet && (
              <span title="Command palette" style={{ marginLeft: 8, fontSize: 9.5, letterSpacing: "0.08em", color: C.textFaint, border: `1px solid ${C.line}`, padding: "2px 6px", fontFamily: mono }}>⌘K</span>
            )}
            </>
          )}
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="Profile — training plan, form check history, account and data"
            style={{ ...S.profileBtn, padding: "6px 11px" }}
          >Profile</button>
        </span>
      </div>
      {/* V15.0 · Context strip (broadsheet only): the working context that
          the mobile shell distributes across cards — today's plan, the
          logging target, the streak — pinned under the masthead. Sources are
          all existing: program day plan, App's logDate, calcStreak. The
          "Week N of M · phase" chip from the mockups needs program metadata
          that does not exist yet; deferred rather than faked. */}
      {isBroadsheet && showNav && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, padding: "5px 16px", borderTop: `1px solid ${C.line}`, fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim }}>
          <span style={{ display: "flex", gap: 24, minWidth: 0 }}>
            {todayName && (
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {(program?.[todayName]?.name || program?.[todayName]?.label || todayName)}
              </span>
            )}
            <span style={{ whiteSpace: "nowrap" }}>Logging: {logDate || "Today"}</span>
          </span>
          <span style={{ whiteSpace: "nowrap" }}>Streak {calcStreak(allData || {}).count} days</span>
        </div>
      )}
    </header>
  );
}
