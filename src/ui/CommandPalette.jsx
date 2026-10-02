// src/ui/CommandPalette.jsx
// V15.3 · ⌘K command palette (mockup 1p, decision D4). Desktop-native "one
// tap from anywhere": the same QUICK_ACTIONS the mobile FAB serves, plus
// jump-to targets for the four tabs. Number keys fire actions, T/R/F/P jump
// tabs, Escape closes. Broadsheet-tier only — mounted and unmounted by App.
import { useEffect, useRef } from "react";
import { useTheme } from "../theme";

export function CommandPalette({ open, onClose, actions = [], tabs = [], onAction, onNavigate }) {
  const { C } = useTheme();
  const mono = C.fontFamily;
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= actions.length) { e.preventDefault(); onAction(actions[n - 1].key); return; }
      const t = tabs.find(tb => tb[0].toLowerCase() === e.key.toLowerCase());
      if (t) { e.preventDefault(); onNavigate(t); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, actions, tabs, onAction, onNavigate, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(26,26,26,0.32)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "18vh" }}>
      <div ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()} data-section="command-palette"
        style={{ width: 560, maxWidth: "92vw", background: C.bg, border: `1px solid ${C.text}`, outline: "none", fontFamily: mono }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textDim }}>
          <span>Quick log</span><span>esc to close</span>
        </div>
        {actions.map((a, i) => (
          <button key={a.key} type="button" onClick={() => onAction(a.key)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%", padding: "12px 14px", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, color: C.text, fontFamily: mono, cursor: "pointer", textAlign: "left" }}>
            <span style={{ fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>{a.label}
              <span style={{ marginLeft: 10, fontSize: 10, color: C.textFaint, textTransform: "none", letterSpacing: 0 }}>{a.sub}</span>
            </span>
            <span style={{ fontSize: 10, color: C.textFaint }}>{i + 1}</span>
          </button>
        ))}
        <div style={{ display: "flex", gap: 0 }}>
          {tabs.map((t) => (
            <button key={t} type="button" onClick={() => onNavigate(t)}
              style={{ flex: 1, padding: "10px 8px", background: "none", border: "none", borderRight: `1px solid ${C.line}`, color: C.textDim, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono, cursor: "pointer" }}>
              <span style={{ color: C.text }}>{t[0]}</span>{t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
