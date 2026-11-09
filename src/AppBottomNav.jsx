import { useEffect, useRef } from "react";
import { useTheme } from "./theme";
import { useIsDesktop } from "./ui/useMediaQuery";

// Form Check and quick-logging were three taps deep
// (More → Form Check → Analyze) despite being core differentiators. The FAB
// puts them one tap away from anywhere, and dropping "More" to a header
// entry (see Header's Profile button in AppHeader.jsx) frees the tab row to
// stay four clear destinations instead of a fifth catch-all.
export const TABS_ORDER = ["Today", "Recovery", "Fuel", "Progress"];

// Screen-reader descriptions for each tab (the visible label is terse by design).
const TAB_LABELS = {
  Today: "Today — log workout and fuel",
  Recovery: "Recovery — readiness and biometrics",
  Fuel: "Fuel — meals, macros and water",
  Progress: "Progress — trends and weekly review",
};

// Bottom Navigation Component
// tabsOrder splits around the FAB slot: the first half renders left of it,
// the remainder renders right of it. With the current 4-tab order that's a
// clean 2/2 split; this stays correct if a tab is ever added or removed.
export function BottomNav({ currentTab, onTabChange, tabsOrder = TABS_ORDER, onQuickAction }) {
  const { S } = useTheme();
  // Broadsheet: at >=1024px the tabs live in the masthead (see AppHeader)
  // and the center FAB becomes the header's "+ Log" — the dock unmounts
  // entirely so desktop reads as one newspaper, not a phone in a big window.
  const isDesktop = useIsDesktop();
  if (isDesktop) return null;
  const mid = Math.ceil(tabsOrder.length / 2);
  const left = tabsOrder.slice(0, mid);
  const right = tabsOrder.slice(mid);

  const renderTab = (t) => {
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
        aria-label={TAB_LABELS[t] || t}
        tabIndex={active ? 0 : -1}
        style={{ ...S.navItem, ...(active ? S.navItemActive : {}) }}
        onClick={() => onTabChange(t)}
      >
        {t}
      </button>
    );
  };

  return (
    <nav className="ovt-bottom-nav" style={S.nav} aria-label="Primary">
      <div style={S.navInner} role="tablist" aria-label="Sections">
        {left.map(renderTab)}
        <div style={S.navFabSlot}>
          <button
            type="button"
            aria-label="Quick log — workout, form check, meal, or check-in"
            style={S.navFab}
            onClick={onQuickAction}
          >
            +
          </button>
        </div>
        {right.map(renderTab)}
      </div>
      <div style={S.navSafeArea} />
    </nav>
  );
}

// Quick-action sheet
// Opened by the FAB. Display-only routing — every action just points at an
// existing tab or overlay; no new write paths, no logging logic here.
export const QUICK_ACTIONS = [
  { key: "workout", label: "Log workout", sub: "Sets, cardio, notes" },
  { key: "formcheck", label: "Form check", sub: "Record or upload a lift" },
  { key: "meal", label: "Log meal", sub: "Search food or quick add" },
  { key: "checkin", label: "Check in", sub: "How you're feeling today" },
];

export function QuickActionSheet({ open, onAction, onClose, actions = QUICK_ACTIONS }) {
  const { S } = useTheme();
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const target = returnFocusRef.current;
      requestAnimationFrame(() => target?.isConnected && target.focus?.());
    };
  }, [open]);
  return (
    <>
      <div
        style={{ ...S.sheetScrim, ...(open ? S.sheetScrimOpen : {}) }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        style={{ ...S.sheet, ...(open ? S.sheetOpen : {}) }}
        role="dialog"
        aria-modal="true"
        aria-label="Quick log"
        aria-hidden={!open}
      >
        <div style={S.sheetHandle} aria-hidden="true" />
        <div style={S.sheetHeader}>
          <div style={S.sheetTitle}>Quick log</div>
          <button ref={closeRef} type="button" style={S.sheetClose} onClick={onClose} aria-label="Close quick log">
            × Close
          </button>
        </div>
        {actions.map((a, i) => (
          <button
            key={a.key}
            type="button"
            style={{ ...S.sheetAction, ...(i === 0 ? { borderTop: "none" } : {}) }}
            onClick={() => onAction(a.key)}
          >
            <span>
              <span style={S.sheetActionLabel}>{a.label}</span>
              <span style={S.sheetActionSub}>{a.sub}</span>
            </span>
            <span style={S.sheetActionArrow} aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </>
  );
}
