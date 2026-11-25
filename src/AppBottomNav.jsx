import { useIsDesktop } from "./ui/useMediaQuery";
import { Icon, Sheet, TabBar } from "./ui/ledger";

// Four destinations and one Log action. Everything about the plan lives in
// Train; Recovery is a detail screen behind the call; account, settings and
// help sit behind Profile in the top bar.
export const TABS_ORDER = ["Today", "Train", "Fuel", "Progress"];

// The tab bar is the phone's navigation. At 1024 px and up the tabs live in
// the top bar (see AppHeader) and this unmounts.
export function BottomNav({ currentTab, onTabChange, tabsOrder = TABS_ORDER, onQuickAction }) {
  const isDesktop = useIsDesktop();
  if (isDesktop) return null;
  return <TabBar tabs={tabsOrder} current={currentTab} onChange={onTabChange} onLog={onQuickAction} />;
}

// The Log sheet: five choices at most, each routing to a screen that already
// exists. Ask coach joins only for accounts the coach is on for.
export const QUICK_ACTIONS = [
  { key: "workout", label: "Log workout", sub: "Start today’s session, or log sets by hand", icon: "train" },
  { key: "run", label: "Log run", sub: "Miles and time, or confirm a Strava import", icon: "run" },
  { key: "meal", label: "Log meal", sub: "Search, recents or quick add", icon: "fuel" },
  { key: "checkin", label: "Check in", sub: "Four taps: sleep, soreness, stress, energy", icon: "done" },
];
export const COACH_ACTION = { key: "coach", label: "Ask coach", sub: "Answers drawn from your own data", icon: "chat" };

export function QuickActionSheet({ open, onAction, onClose, actions = QUICK_ACTIONS }) {
  return (
    <Sheet open={open} title="Log" onClose={onClose}>
      <ul className="rows">
        {actions.map((a) => (
          <li key={a.key}>
            <button type="button" className="row" style={{ minHeight: 56 }} onClick={() => onAction(a.key)}>
              {a.icon && <Icon name={a.icon} />}
              <span className="kv grow"><span className="t-bs">{a.label}</span><span className="t-s c2">{a.sub}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
