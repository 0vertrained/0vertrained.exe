// The widget as a hook: give it the container's ref and it returns the
// current token and whether a token is needed at all. Without a site key
// nothing loads and `required` is false, so local builds and tests see no
// widget.
import { useEffect, useState, type RefObject } from "react";
import { backendConfig } from "../../app/config";
import { loadTurnstile } from "./turnstile";

export interface TurnstileState {
  /** "" until the check passes, and again after it expires. */
  token: string;
  required: boolean;
}

export function useTurnstile(active: boolean, container: RefObject<HTMLDivElement>): TurnstileState {
  const siteKey = backendConfig.turnstileSiteKey;
  const required = active && siteKey.length > 0;
  const [token, setToken] = useState("");

  useEffect(() => {
    const el = container.current;
    if (!required || !el) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    loadTurnstile(siteKey, el, (t) => {
      if (!cancelled) setToken(t);
    }).then(
      (remove) => {
        if (cancelled) remove();
        else dispose = remove;
      },
      () => {
        // The widget stays blank and the primary stays disabled.
      },
    );
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [required, siteKey, container]);

  return { token, required };
}
