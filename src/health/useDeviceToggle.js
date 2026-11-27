import { useCallback, useSyncExternalStore } from "react";

// Read the current owner's permission on the very first render after login.
// A cached boolean from the previous athlete would start an incorrect import.
export function useDeviceToggle(event, read, owner, ready) {
  const subscribe = useCallback(notify => {
    window.addEventListener(event, notify);
    return () => window.removeEventListener(event, notify);
  }, [event]);
  return useSyncExternalStore(subscribe, () => ready && read(owner), () => false);
}
