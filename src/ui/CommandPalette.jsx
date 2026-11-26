// src/ui/CommandPalette.jsx
// Shortcuts, the ⌘K palette on wide screens: the quick actions the Log
// button offers, and the four tabs. Number keys fire an action, each tab's
// letter jumps to it, Escape closes, and Tab stays inside. Mounted only at
// the wide tier, by App.
import { useEffect, useRef } from "react";

const kbd = { minWidth: 24, padding: "0 6px", border: "1px solid var(--edge)", borderRadius: 4, textAlign: "center", flex: "none" };

// One letter per tab: its first letter, or the next one in its name that no
// earlier tab took (Today T, Train R, Fuel F, Progress P).
export function tabKeys(tabs) {
  const used = new Set();
  return tabs.map((tab) => {
    const letter = [...tab.toLowerCase()].find((ch) => /[a-z]/.test(ch) && !used.has(ch)) || "";
    used.add(letter);
    return letter;
  });
}

export function CommandPalette({ open, onClose, actions = [], tabs = [], onAction, onNavigate }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    // Focus starts on the first action, so the keyboard is already in the list.
    (ref.current?.querySelector("button") || ref.current)?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key === "Tab" && ref.current) {
        const items = ref.current.querySelectorAll("button");
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === ref.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const n = parseInt(event.key, 10);
      if (n >= 1 && n <= actions.length) { event.preventDefault(); onAction(actions[n - 1].key); return; }
      const index = tabKeys(tabs).indexOf(String(event.key).toLowerCase());
      if (index >= 0) { event.preventDefault(); onNavigate(tabs[index]); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => opener?.isConnected && opener.focus?.());
    };
  }, [open, actions, tabs, onAction, onNavigate, onClose]);

  if (!open) return null;
  const keys = tabKeys(tabs);
  return (
    <>
      <div className="scrim mo-scrim" aria-hidden="true" />
      <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: "var(--z-sheet)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12vh 24px 24px" }}>
        <section
          ref={ref}
          tabIndex={-1}
          className="dialog mo-rise"
          role="dialog"
          aria-modal="true"
          aria-labelledby="palette-title"
          data-section="command-palette"
          onClick={(event) => event.stopPropagation()}
          style={{ width: "100%", maxWidth: 480, outline: "none" }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 id="palette-title" className="t-h grow">Shortcuts</h2>
            <span className="t-s c2">Esc closes</span>
          </div>
          <h3 className="t-ss">Log</h3>
          <ul className="rows" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {actions.map((action, i) => (
              <li key={action.key}>
                <button type="button" className="row" onClick={() => onAction(action.key)} aria-keyshortcuts={String(i + 1)}>
                  <span className="kv grow">
                    <span className="t-bs">{action.label}</span>
                    {action.sub && <span className="t-s c2">{action.sub}</span>}
                  </span>
                  <kbd className="n-s c2" aria-hidden="true" style={kbd}>{i + 1}</kbd>
                </button>
              </li>
            ))}
          </ul>
          <h3 className="t-ss">Go to</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {tabs.map((tab, i) => (
              <button key={tab} type="button" className="btn btn-s btn-sm" onClick={() => onNavigate(tab)} aria-keyshortcuts={keys[i].toUpperCase()} style={{ gap: 8 }}>
                {tab}
                <kbd className="n-s c2" aria-hidden="true" style={kbd}>{keys[i].toUpperCase()}</kbd>
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
