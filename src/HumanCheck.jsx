// src/HumanCheck.jsx
// Where the human check's widget is drawn in a form (see humanCheck.js). It
// renders nothing where the check is off, and its handle then gives every
// attempt an undefined token, so the form needs no second code path.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createHumanCheck } from "./humanCheck";

const HumanCheck = forwardRef(function HumanCheck({ theme = "auto", onInteractive }, ref) {
  const slot = useRef(null);
  const check = useMemo(() => createHumanCheck(), []);
  // Cloudflare shows its box only when it needs the person to do something; the space for it opens only then.
  const [shown, setShown] = useState(false);
  // The widget is drawn once and keeps the callbacks it was given, so it is handed one that reads the latest prop.
  const told = useRef(onInteractive);
  told.current = onInteractive;
  const options = useMemo(() => ({
    theme,
    onInteractive: (interactive) => {
      setShown(interactive);
      told.current?.(interactive);
    },
  }), [theme]);

  useImperativeHandle(ref, () => ({
    /** Start the check early, so its answer is usually there by the time the form is sent. */
    begin: () => { void check.start(slot.current, options); },
    /** The token for this attempt; rejects with a HumanCheckError whose message can be shown as it is. */
    token: () => check.token(slot.current, options),
    /** After an attempt, whatever came of it: a token is good once. */
    renew: () => check.renew(),
  }), [check, options]);

  useEffect(() => () => check.stop(), [check]);

  if (!check.enabled) return null;
  return <div ref={slot} data-human-check="" style={{ marginTop: shown ? 16 : 0 }} />;
});

export default HumanCheck;
