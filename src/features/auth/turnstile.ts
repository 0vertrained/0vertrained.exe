// Cloudflare Turnstile, loaded on demand: the script is fetched once, the
// widget is rendered explicitly into a container the sheet owns, and the
// token comes back through onToken ("" again when it expires). Nothing
// here runs without a site key; the sheet checks that first.

export const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const ONLOAD_NAME = "ovtTurnstileReady";

export interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
  reset(widgetId?: string): void;
}

export interface TurnstileWindow {
  document: Document;
  turnstile?: TurnstileApi;
  ovtTurnstileReady?: () => void;
}

let script: Promise<TurnstileApi> | null = null;

/** Resolves with the global API once the script has run; one script tag per page. */
export function loadTurnstileScript(win: TurnstileWindow = window as unknown as TurnstileWindow): Promise<TurnstileApi> {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  script ??= new Promise<TurnstileApi>((resolve, reject) => {
    win.ovtTurnstileReady = () => {
      const api = win.turnstile;
      if (api) resolve(api);
      else reject(new Error("Turnstile did not load."));
    };
    const el = win.document.createElement("script");
    el.src = `${TURNSTILE_SRC}?onload=${ONLOAD_NAME}&render=explicit`;
    el.async = true;
    el.defer = true;
    el.onerror = () => {
      script = null;
      reject(new Error("Turnstile could not be loaded."));
    };
    win.document.head.appendChild(el);
  });
  return script;
}

/** Renders the widget into `container`; the returned function removes it. */
export async function loadTurnstile(siteKey: string, container: HTMLElement, onToken: (token: string) => void, win?: TurnstileWindow): Promise<() => void> {
  const api = await loadTurnstileScript(win);
  const id = api.render(container, {
    sitekey: siteKey,
    theme: "dark",
    size: "flexible",
    callback: onToken,
    "expired-callback": () => onToken(""),
    "error-callback": () => onToken(""),
  });
  return () => {
    try {
      api.remove(id);
    } catch {
      // Already removed with its container.
    }
  };
}
