// A Notice floated above the tab bar (z-toast, surface-2, shadow-toast),
// non-modal, for two things only: a record during a session and going
// offline. It stays 4 s (records) or until back online and is dismissed by
// swipe or its own action. Never stack toasts: a second record replaces the
// first. Never toast XP, level-ups or tier changes; those belong to the
// reward sheet and the notice slot.
import { Notice, type NoticeProps } from "./Notice";

export type ToastProps = NoticeProps;

export function Toast(props: ToastProps) {
  return (
    <div className="ot-toast-layer">
      <Notice {...props} toast />
    </div>
  );
}
