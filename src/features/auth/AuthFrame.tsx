// The sheet every account mode shares: the Wordmark at 28px above the
// fields, a server error as an [ERROR] notice, and the mode's one primary
// in the footer with the ghost that switches mode under it.
import type { KeyboardEvent, ReactNode } from "react";
import { Notice } from "../../design/Notice";
import { Sheet } from "../../design/Sheet";
import { Wordmark } from "../../design/Wordmark";
import styles from "./AuthSheet.module.css";

export type AuthMode = "sign-in" | "create" | "forgot";

export interface FormErrors {
  username?: string | undefined;
  password?: string | undefined;
  phrase?: string | undefined;
  /** A request-level error, shown as a notice above the fields. */
  form?: string | undefined;
}

export interface AuthFrameProps {
  title: string;
  footer: ReactNode;
  onClose: () => void;
  error?: string | undefined;
  children: ReactNode;
}

export function AuthFrame({ title, footer, onClose, error, children }: AuthFrameProps) {
  return (
    <Sheet id="auth" title={title} onClose={onClose} footer={footer}>
      <div className={styles.stack}>
        <Wordmark size={28} className={styles.mark} />
        {error ? <Notice tag="ERROR">{error}</Notice> : null}
        {children}
      </div>
    </Sheet>
  );
}

/** An Enter handler that submits; Shift+Enter keeps a newline in a textarea. */
export function enterSubmits(submit: () => void) {
  return (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    submit();
  };
}
