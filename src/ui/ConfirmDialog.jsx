// src/ui/ConfirmDialog.jsx
// Styled confirmation dialog — replaces the browser-native window.confirm() for
// destructive / consequential actions (disconnect wearable, overwrite program,
// switch preset): a titled panel over the dimmed screen with Cancel and the
// confirm action side by side. `destructive` turns the confirm button red,
// the colour kept for acts that can't be undone.
//
// `useConfirm()` wraps this in a promise-based API so an existing
//   if (!window.confirm(msg)) return;
// becomes
//   if (!(await confirm({ message, confirmLabel, destructive }))) return;
// with no other restructuring of the caller's async handler.
import { useState, useCallback, useRef, useEffect, useId } from "react";

export function ConfirmDialog({
  message,
  title = "Confirm",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const id = useId();
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const returnFocusRef = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);
  useEffect(() => {
    const opener = returnFocusRef.current;
    const initialButton = destructive ? cancelRef.current : confirmRef.current;
    initialButton?.focus();
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === "Escape") { e.preventDefault(); onCancelRef.current?.(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        // Holding Enter to open a confirmation must not also answer it.
        if (e.repeat) return;
        if (document.activeElement === cancelRef.current) onCancelRef.current?.();
        else if (document.activeElement === confirmRef.current) onConfirmRef.current?.();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const next = document.activeElement === confirmRef.current ? cancelRef.current : confirmRef.current;
        next?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      requestAnimationFrame(() => {
        if (opener?.isConnected && document.activeElement === document.body) opener.focus?.();
      });
    };
  }, [destructive]);

  return (
    <>
      <div className="scrim mo-scrim" aria-hidden="true" />
      <div
        className="confirm-frame"
        role="presentation"
        onClick={onCancel}
      >
        <div
          className="dialog mo-rise"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-t`}
          aria-describedby={`${id}-m`}
          onClick={(e) => e.stopPropagation()}
          style={{ width: "100%", maxWidth: 400 }}
        >
          <h2 id={`${id}-t`} className="t-h">{title}</h2>
          <p id={`${id}-m`} className="t-b">{message}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button ref={cancelRef} type="button" className="btn btn-s" onClick={onCancel} style={{ flex: "1 1 0", minWidth: 0 }}>{cancelLabel}</button>
            <button ref={confirmRef} type="button" className={destructive ? "btn btn-d" : "btn btn-p"} onClick={onConfirm} style={{ flex: "1 1 0", minWidth: 0 }}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// useConfirm — promise-based bridge so callers keep their linear async flow.
// Returns { confirm, confirmDialog }: render confirmDialog anywhere in the
// component tree (it's a fixed overlay), and await confirm(opts) for a boolean.
// opts may be a string (message only) or { message, title, confirmLabel,
// cancelLabel, destructive }.
export function useConfirm() {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  useEffect(() => () => {
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const confirm = useCallback((opts) => {
    if (resolveRef.current) return Promise.resolve(false);
    const options = typeof opts === "string" ? { message: opts } : (opts || {});
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState(options);
    });
  }, []);

  const finish = useCallback((result) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    resolve?.(result);
  }, []);

  const confirmDialog = state ? (
    <ConfirmDialog
      {...state}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  ) : null;

  return { confirm, confirmDialog };
}
