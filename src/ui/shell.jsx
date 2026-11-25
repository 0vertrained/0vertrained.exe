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
