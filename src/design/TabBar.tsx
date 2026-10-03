// Three tabs, icon over a 12px label, 64px tall plus the safe-area inset,
// surface-2 with a hairline above. The current tab is chalk at weight 500 and
// carries aria-current="page"; the others are ink-2. No indicator bar, no
// badge counts. Full-screen flows (the runners, the promotion takeover) hide
// the bar entirely rather than disabling it.
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type TabId = "quest" | "stats" | "profile";

export interface TabBarTab {
  id: string;
  label: string;
  icon: IconName;
}

export interface TabBarProps {
  active: TabId;
  tabs?: TabBarTab[];
  onChange?: (id: string) => void;
  className?: string;
}

export const DEFAULT_TABS: TabBarTab[] = [
  { id: "quest", label: "Quest", icon: "quest" },
  { id: "stats", label: "Stats", icon: "stats" },
  { id: "profile", label: "Profile", icon: "profile" },
];

export function TabBar({ active, tabs = DEFAULT_TABS, onChange, className }: TabBarProps) {
  return (
    <nav className={cx("ot-tabbar", className)} aria-label="Main">
      {tabs.map((t) => (
        <button key={t.id} type="button" className="ot-tab" aria-current={active === t.id ? "page" : undefined} onClick={onChange ? () => onChange(t.id) : undefined}>
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
