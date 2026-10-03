// The notice voice: a bracketed tag in the mono, then one calm sentence in
// the sans. The tone follows the tag: RECORD, LEVEL UP, RANK TRIAL and
// QUEST CLEARED are brass (earned); QUEST and SHIELD chalk; REST, OFFLINE
// and PAUSED muted; ERROR is danger and role="alert". Pass `tone` only to
// override. `action` adds one ghost button on the right ("Begin", "Undo").
// One sentence, no exclamation marks; numbers in it stay digits.
import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

export type NoticeTag = "QUEST" | "QUEST CLEARED" | "RECORD" | "LEVEL UP" | "RANK TRIAL" | "SHIELD" | "REST" | "OFFLINE" | "PAUSED" | "ERROR";
export type NoticeTone = "brass" | "chalk" | "muted" | "danger";

export const TONE_BY_TAG: Record<NoticeTag, NoticeTone> = {
  RECORD: "brass",
  "LEVEL UP": "brass",
  "RANK TRIAL": "brass",
  "QUEST CLEARED": "brass",
  QUEST: "chalk",
  SHIELD: "chalk",
  REST: "muted",
  OFFLINE: "muted",
  ERROR: "danger",
  PAUSED: "muted",
};

export interface NoticeAction {
  label: string;
  onClick?: () => void;
}

export interface NoticeProps {
  /** Shown in brackets and upper case; "[record]" and "RECORD" are the same tag. */
  tag?: NoticeTag | string;
  tone?: NoticeTone;
  action?: NoticeAction;
  /** Set by Toast: surface-2 and the toast shadow. */
  toast?: boolean;
  className?: string;
  children?: ReactNode;
}

function isNoticeTag(tag: string): tag is NoticeTag {
  return Object.prototype.hasOwnProperty.call(TONE_BY_TAG, tag);
}

export function Notice({ tag, tone, action, toast, className, children }: NoticeProps) {
  const t = (tag ?? "").replace(/^\[|\]$/g, "").toUpperCase();
  const resolved: NoticeTone = tone ?? (isNoticeTag(t) ? TONE_BY_TAG[t] : "chalk");
  return (
    <div className={cx("ot-notice", toast && "ot-notice-toast", className)} data-tone={resolved} role={resolved === "danger" ? "alert" : "status"}>
      {t ? <span className="ot-notice-tag">{`[${t}]`}</span> : null}
      <span className="ot-notice-text">{children}</span>
      {action ? (
        <Button variant="ghost" size="sm" className="ot-notice-action" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
