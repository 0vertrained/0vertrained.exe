import { useEffect, useState } from "react";
import { APP_FOREGROUND_EVENT, installAppForegroundSignals } from "./appForeground";

export function useAppIntegrationSync({ owner, ready }) {
  const [refresh, setRefresh] = useState(null);
  useEffect(installAppForegroundSignals, []);
  useEffect(() => {
    if (!ready || !owner) return undefined;
    const controller = new AbortController();
    let running = false;
    let queued = false;
    const connections = new Map();
    const sync = async () => {
      if (navigator.onLine === false || controller.signal.aborted) return;
      if (running) { queued = true; return; }
      running = true;
      try {
        const { syncCloudOnOpen } = await import("./cloudSync");
        do {
          queued = false;
          if (controller.signal.aborted) return;
          const result = await syncCloudOnOpen({ owner, signal: controller.signal });
          if (controller.signal.aborted) return;
          let changed = false;
          for (const [provider, status] of Object.entries(result)) {
            if (["synced", "partial", "fresh"].includes(status)) {
              connections.set(provider, "connected");
              changed = true;
            } else if (status === "disconnected" || status === "needs_attention") {
              const previous = connections.get(provider);
              if (previous !== status && (previous || status === "needs_attention")) changed = true;
              connections.set(provider, status);
            }
          }
          if (changed) {
            setRefresh(previous => ({ owner, version: previous?.owner === owner ? previous.version + 1 : 1 }));
          }
        } while (queued);
      } catch { /* Keep local training data available. Retry on the next foreground or connection. */ }
      finally { running = false; }
    };
    window.addEventListener(APP_FOREGROUND_EVENT, sync);
    if (document.visibilityState !== "hidden") void sync();
    return () => {
      controller.abort();
      window.removeEventListener(APP_FOREGROUND_EVENT, sync);
    };
  }, [owner, ready]);
  return ready && refresh?.owner === owner ? refresh.version : 0;
}
