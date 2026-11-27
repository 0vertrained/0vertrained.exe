// src/health/useHealthWrite.js
// In iPhone app builds that can save to Apple Health, once that's on in
// Settings › Integrations: a few seconds after the log stops changing,
// saves what changed in the last three days (./healthWrite.js). In a
// browser, or while it's off, it does nothing.

import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { useDeviceToggle } from "./useDeviceToggle";
import { useEffect, useState, useRef } from "react";
import { getTodayKey } from "../constants";
import { nativePlugin } from "../native";
import { HEALTH_WRITE_EVENT, planHealthWrites, readHealthWriteOn, readSaved, recordWrite, sendHealthWrite, writeSaved } from "./healthWrite";

const SAVE_DELAY_MS = 4000;

// `ready`: the account's own data is loaded, so only real days are saved.
export function useHealthWrite({ owner, ready, data }) {
  const native = Boolean(nativePlugin("OTHealthWrite"));
  const on = useDeviceToggle(HEALTH_WRITE_EVENT, readHealthWriteOn, owner, native && ready);

  const [wake, setWake] = useState(0);
  const pending = useRef(Promise.resolve());
  useEffect(() => {
    if (!native || !ready || !on) return undefined;
    const resume = () => setWake(value => value + 1);
    window.addEventListener(APP_FOREGROUND_EVENT, resume);
    return () => window.removeEventListener(APP_FOREGROUND_EVENT, resume);
  }, [native, ready, on]);

  useEffect(() => {
    if (!native || !ready || !on) return undefined;
    let cancelled = false;
    const flush = async () => {
      if (cancelled) return;
      const plugin = nativePlugin("OTHealthWrite");
      const todayKey = getTodayKey();
      let saved = readSaved(owner);
      for (const write of planHealthWrites({ data, todayKey, saved })) {
        if (cancelled) break;
        const done = await sendHealthWrite(plugin, write, owner).catch(() => false);
        saved = recordWrite(saved, write, done);
        writeSaved(saved, todayKey, owner);
      }
    };
    const timer = setTimeout(() => {
      pending.current = pending.current.then(flush).catch(() => {});
    }, SAVE_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [native, ready, on, owner, data, wake]);
}

export default useHealthWrite;
