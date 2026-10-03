// Hash routing without a router dependency: "#/quest", "#/stats/log/2026-10-02".
// Works on static hosting with the "/* → /index.html" rewrite and offline in
// the PWA. Sheets are not routes: opening one pushes a history entry carrying
// the open sheet ids, so the browser's Back closes the topmost sheet. One
// external store feeds every hook instance, so a navigate() in one component
// is seen by all of them at once.
import { useCallback, useSyncExternalStore } from "react";

export interface Route {
  /** "/quest", "/stats/log/2026-10-02"; "/" for an empty hash. */
  path: string;
  parts: string[];
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = raw ? raw.split("/").map(decodeURIComponent) : [];
  return { path: `/${parts.join("/")}`, parts };
}

interface SheetState {
  sheets?: string[];
}

function readSheets(): string[] {
  const state = window.history.state as SheetState | null;
  return Array.isArray(state?.sheets) ? state.sheets : [];
}

interface Snapshot {
  route: Route;
  sheets: string[];
}

const listeners = new Set<() => void>();
let snapshot: Snapshot | null = null;
let snapshotKey = "";

function getSnapshot(): Snapshot {
  const sheets = readSheets();
  const key = `${window.location.hash}|${sheets.join(",")}`;
  if (!snapshot || key !== snapshotKey) {
    snapshot = { route: parseHash(window.location.hash), sheets };
    snapshotKey = key;
  }
  return snapshot;
}

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

export interface HashRouter {
  route: Route;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  /** The topmost open sheet id, or null. */
  sheet: string | null;
  sheets: string[];
  openSheet: (id: string) => void;
  closeSheet: () => void;
}

export function useHashRoute(): HashRouter {
  const { route, sheets } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const navigate = useCallback((path: string, options?: { replace?: boolean }) => {
    const hash = `#${path.startsWith("/") ? path : `/${path}`}`;
    if (options?.replace) window.history.replaceState({ sheets: [] }, "", hash);
    else if (window.location.hash !== hash || readSheets().length > 0) window.history.pushState({ sheets: [] }, "", hash);
    else return;
    notify();
  }, []);

  const openSheet = useCallback((id: string) => {
    const next = [...readSheets(), id];
    window.history.pushState({ sheets: next }, "", window.location.hash || "#/");
    notify();
  }, []);

  const closeSheet = useCallback(() => {
    if (readSheets().length === 0) return;
    window.history.back();
  }, []);

  return { route, navigate, sheet: sheets[sheets.length - 1] ?? null, sheets, openSheet, closeSheet };
}
