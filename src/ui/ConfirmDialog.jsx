// src/ui/ConfirmDialog.jsx
// Styled confirmation dialog — replaces the browser-native window.confirm() for
// destructive / consequential actions (disconnect wearable, overwrite program,
// switch preset). Keeps the whitepaper/ledger identity: a hairline-bordered
// panel over a dimmed backdrop, a mono uppercase eyebrow label, a serif message,
// and two ruled buttons (Cancel + Confirm). The `destructive` flag tints the
// confirm button with the theme's one reserved signal ink for irreversible acts.
//
// `useConfirm()` wraps this in a promise-based API so an existing
//   if (!window.confirm(msg)) return;
// becomes
//   if (!(await confirm({ message, confirmLabel, destructive }))) return;
// with no other restructuring of the caller's async handler.
import { useState, useCallback, useRef, useEffect } from "react";
import { useTheme } from "../theme";

export function ConfirmDialog({
  message,
  title = "Confirm",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const { C, S } = useTheme();
  const confirmRef = useRef(null);
  const returnFocusRef = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  useEffect(() => {
    // Focus the confirm action so keyboard users land inside the dialog, and
    // wire Escape → cancel / Enter → confirm for the two obvious shortcuts.
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancelRef.current?.(); }
      else if (e.key === "Enter") { e.preventDefault(); onConfirmRef.current?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const target = returnFocusRef.current;
      requestAnimationFrame(() => target?.isConnected && target.focus?.());
    };
  }, []);

  const confirmInk = destructive ? (C.red || C.signal) : C.text;

  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,19,17,0.55)",
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 340,
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: C.cardRadius,
          padding: "18px 18px 16px",
          boxShadow: "0 18px 40px -16px rgba(0,0,0,0.45)",
        }}
      >
        <div style={S.blockTitle}>{title}</div>
        <div
          style={{
            fontFamily: S.fontSerif,
            fontSize: 16,
            lineHeight: 1.42,
            color: C.text,
            letterSpacing: "-0.01em",
            marginTop: 10,
            marginBottom: 18,
          }}
        >
          {message}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} style={{ ...S.smallBtn, padding: "9px 15px" }}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{ ...S.smallBtn, padding: "9px 15px", borderColor: confirmInk, color: confirmInk, fontWeight: 600 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
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

  const confirm = useCallback((opts) => {
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
