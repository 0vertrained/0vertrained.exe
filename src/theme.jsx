// src/theme.jsx
// Light or dark. The colours themselves live in src/ledger.css, keyed by
// data-theme on <html>; this module holds the choice and writes data-theme.
// The ids stay whitepaperLight and whitepaperDark because saved settings hold
// them, and the ids from earlier builds map onto the two.
import { createContext, useContext, useEffect } from "react";
import { setNativeBarStyle } from "./native";

// The two themes Settings offers.
export const PRIMARY_THEMES = ["whitepaperLight", "whitepaperDark"];

// `bg` and `text` repeat --bg and --ink from ledger.css for script that needs
// a colour value rather than a variable.
const LIGHT = { id: "whitepaperLight", mode: "light", label: "Paper", desc: "Light", bg: "#FAF9F6", text: "#1A1A1A" };
const DARK = { id: "whitepaperDark", mode: "dark", label: "Negative", desc: "Dark", bg: "#141412", text: "#F1EEE7" };

export const THEMES = {
  whitepaperLight: LIGHT,
  whitepaperDark: DARK,
  // Ids saved by earlier builds.
  instrument: DARK,
  instrumentLight: LIGHT,
  terminal: DARK,
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children, themeId = "whitepaperLight" }) {
  const C = THEMES[themeId] || LIGHT;
  // data-switching is held for one frame so nothing transitions because the
  // theme changed.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-switching", "");
    root.setAttribute("data-theme", C.mode);
    setNativeBarStyle(C.mode); // the iPhone app's status bar; nothing in a browser
    const frame = requestAnimationFrame(() => root.removeAttribute("data-switching"));
    return () => { cancelAnimationFrame(frame); root.removeAttribute("data-switching"); };
  }, [C.mode]);
  return <ThemeContext.Provider value={{ C, themeId }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
