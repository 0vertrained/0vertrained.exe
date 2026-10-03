// The three tabs' chrome: the status strip above, the tab bar below (or in
// the header at the desktop breakpoint), one centred column between.
import type { ReactNode } from "react";
import { STREAK } from "../domain/game/config";
import type { Progress } from "../domain/game/types";
import { StatusStrip, type StatusStripProps } from "../design/StatusStrip";
import { TabBar } from "../design/TabBar";
import styles from "./Shell.module.css";

export type Tab = "quest" | "stats" | "profile";

export interface ShellProps {
  tab: Tab;
  progress: Progress;
  sync: StatusStripProps["sync"];
  guest: boolean;
  onTab: (tab: Tab) => void;
  children: ReactNode;
}

export function Shell({ tab, progress, sync, guest, onTab, children }: ShellProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.top}>
        <StatusStrip
          rank={progress.rank.toLowerCase() as Lowercase<Progress["rank"]>}
          level={progress.level}
          xp={{ value: progress.levelProgress.into, max: progress.levelProgress.needed }}
          streak={{ days: progress.streak.current, shields: progress.streak.shields, shieldsTotal: STREAK.maxShields }}
          sync={sync}
          guest={guest}
          onRank={() => onTab("stats")}
        />
        <div className={styles.headerTabs}>
          <TabBar active={tab} onChange={(id) => onTab(id as Tab)} />
        </div>
      </div>
      <main className={styles.body}>{children}</main>
      <div className={styles.bottomTabs}>
        <TabBar active={tab} onChange={(id) => onTab(id as Tab)} />
      </div>
    </div>
  );
}
