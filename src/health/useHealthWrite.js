// src/health/useHealthWrite.js
// In iPhone app builds that can save to Apple Health, once that's on in
// Settings › Integrations: a few seconds after the log stops changing,
// saves what changed in the last three days (./healthWrite.js). In a
// browser, or while it's off, it does nothing.

import { useEffect, useState } from "react";
import { getTodayKey } from "../constants";
import { nativePlugin } from "../native";
import { HEALTH_WRITE_EVENT, planHealthWrites, readHealthWriteOn, readSaved, recordWrite, sendHealthWrite, writeSaved } from "./healthWrite";

const SAVE_DELAY_MS = 4000;

// `ready`: the account's own data is loaded, so only real days are saved.
export function useHealthWrite({ ready, data }) {
  const native = Boolean(nativePlugin("OTHealthWrite"));
  const [on, setOn] = useState(() => readHealthWriteOn());

  useEffect(() => {
    const sync = () => setOn(readHealthWriteOn());
    window.addEventListener(HEALTH_WRITE_EVENT, sync);
    return () => window.removeEventListener(HEALTH_WRITE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!native || !ready || !on) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const plugin = nativePlugin("OTHealthWrite");
      const todayKey = getTodayKey();
      let saved = readSaved();
      for (const write of planHealthWrites({ data, todayKey, saved })) {
        if (cancelled) break;
        const done = await sendHealthWrite(plugin, write).catch(() => false);
        saved = recordWrite(saved, write, done);
      }
      writeSaved(saved, todayKey);
    }, SAVE_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [native, ready, on, data]);
}

export default useHealthWrite;
