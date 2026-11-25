// src/ui/shell.jsx
// The top bar belongs to the shell, but the screen inside it knows what it is
// called and where Back goes. A screen one level down says so with
// useTopBar({ title, back, onBack }); the shell shows that until the screen
// unmounts, then returns to the tab's own title.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const ShellContext = createContext(null);

export function ShellProvider({ children }) {
  const [bar, setBar] = useState(null);
  const value = useMemo(() => ({ bar, setBar }), [bar]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

// What the current screen asked the top bar to show, or null.
export function useShellBar() {
  return useContext(ShellContext)?.bar || null;
}

// Called by a screen. Pass null (or nothing) to leave the tab's own title.
// Handlers may change every render; only the words decide when to update.
export function useTopBar(bar) {
  const setBar = useContext(ShellContext)?.setBar;
  const handlers = useRef({});
  useEffect(() => { handlers.current = { onBack: bar?.onBack, onClose: bar?.onClose }; });
  const title = bar?.title ?? null;
  const sub = bar?.sub ?? "";
  const back = bar?.back ?? null;
  const close = bar?.close ?? null;
  useEffect(() => {
    if (!setBar || title == null) return undefined;
    setBar({
      title, sub, back, close,
      onBack: () => handlers.current.onBack?.(),
      onClose: () => handlers.current.onClose?.(),
    });
    return () => setBar(null);
  }, [setBar, title, sub, back, close]);
}

// Focus follows the screen. Going one level down puts focus on Back or
// Close, so the new screen is announced and its way out is the first thing
// reached. Coming back up puts focus on the screen's title, but only when it
// would otherwise be lost: after a tab press it stays on the tab.
export function useScreenFocus({ title, back, close }) {
  const way = back || close || "";
  const key = `${way}|${title || ""}`;
  const previous = useRef(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { key, deep: Boolean(way) };
    if (!before || before.key === key) return;
    if (!before.deep && !way) return;
    const bar = document.querySelector(".ovt-app-shell > .top, #main > .screen-title");
    if (!bar) return;
    if (way) {
      bar.querySelector(".back")?.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (lost) bar.querySelector("h1")?.focus({ preventScroll: true });
  }, [key, way]);
}
