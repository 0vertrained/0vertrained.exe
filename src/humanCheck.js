// The human check on sign-in and sign-up: Cloudflare Turnstile, verified by
// Supabase Auth before it looks at a password.
//
// Off unless the build has VITE_TURNSTILE_SITE_KEY. Supabase asks for the
// token only once CAPTCHA protection is switched on there, with the widget's
// secret key, which is held by Supabase and by nothing in this repository.
// docs/human-check.md gives the order to turn the two on in: this side first.
//
// Cloudflare is not contacted until someone starts to sign in. The script is
// added on the form's first focus or submit, never for a visitor who only
// reads the landing page.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// How long a submit waits for the check before saying it could not finish.
const PATIENCE_MS = 20_000;
// The narrowest the standard widget can be; below it the compact one is drawn.
const STANDARD_WIDTH = 300;

const COULD_NOT_LOAD =
  "The human check could not load. If a content blocker is on, allow challenges.cloudflare.com for this site, then reload.";
const COULD_NOT_START = "The human check could not start. Reload the page and try again.";
const TOOK_TOO_LONG = "The human check is taking too long. Check your connection, then try again.";
const NOBODY_ANSWERED = "The human check timed out before it was answered. Try again.";
const couldNotFinish = (code) =>
  `The human check could not finish${code ? ` (Cloudflare code ${code})` : ""}. Try again; if it keeps happening, reload the page.`;

/** Why a sign-in or sign-up cannot go ahead yet, in words for the person signing in. */
export class HumanCheckError extends Error {}

/** The widget's public site key, or "" where the check is off: no key in this build, or the seeded demo. */
export function humanCheckSiteKey(env = import.meta.env) {
  if (env?.VITE_DEMO_MODE === "true") return "";
  return String(env?.VITE_TURNSTILE_SITE_KEY || "").trim();
}

let script = null;

/** Cloudflare's script, added to the page once. A failed load is not kept, so the next try asks again. */
export function loadTurnstile(doc = document) {
  const view = doc.defaultView;
  if (view?.turnstile) return Promise.resolve(view.turnstile);
  script ??= new Promise((resolve, reject) => {
    const tag = doc.createElement("script");
    const failed = () => {
      script = null;
      tag.remove();
      reject(new HumanCheckError(COULD_NOT_LOAD));
    };
    tag.src = SCRIPT_URL;
    tag.async = true;
    tag.onload = () => (view?.turnstile ? resolve(view.turnstile) : failed());
    tag.onerror = failed;
    doc.head.appendChild(tag);
  });
  return script;
}

/**
 * One form's human check. `start` draws the widget, `token` gives the next attempt its token, `renew` asks for a
 * fresh one after an attempt (a token is good once), and `stop` takes the widget away.
 * Without a site key every method does nothing, and `token` resolves to undefined.
 */
export function createHumanCheck({ siteKey = humanCheckSiteKey(), load = loadTurnstile, patienceMs = PATIENCE_MS } = {}) {
  const enabled = Boolean(siteKey);
  let turnstile = null;  // Cloudflare's API, once loaded
  let widget = null;     // this form's widget, once drawn
  let starting = null;   // start() in progress or done, so it happens once
  let ready = null;      // a token nobody has used yet
  let problem = null;    // why the last check did not finish
  let waiting = null;    // the submit waiting for a token: { promise, resolve, reject, timer }
  let asking = false;    // Cloudflare is showing its box and waiting for the person
  let life = 0;          // goes up at each stop(), so a script that loads after it draws nothing

  const answer = (settle, value) => {
    if (!waiting) return false;
    const { timer } = waiting;
    const done = waiting[settle];
    waiting = null;
    clearTimeout(timer);
    done(value);
    return true;
  };
  const passed = (value) => {
    problem = null;
    if (!answer("resolve", value)) ready = value;
  };
  const failed = (error) => {
    ready = null;
    if (!answer("reject", error)) problem = error;
  };

  function start(element, { theme = "auto", onInteractive } = {}) {
    if (!enabled || !element) return Promise.resolve();
    const begun = life;
    starting ??= load()
      .then((api) => {
        if (begun !== life) return;
        turnstile = api;
        widget = api.render(element, {
          sitekey: siteKey,
          theme,
          size: element.clientWidth > 0 && element.clientWidth < STANDARD_WIDTH ? "compact" : "normal",
          // Nothing is shown unless Cloudflare needs the person to do something.
          appearance: "interaction-only",
          callback: passed,
          "expired-callback": () => { ready = null; },
          "timeout-callback": () => failed(new HumanCheckError(NOBODY_ANSWERED)),
          // true tells Cloudflare the page has dealt with it, so it does not also warn in the console.
          "error-callback": (code) => { failed(new HumanCheckError(couldNotFinish(code))); return true; },
          // While the person is working through Cloudflare's box, a submit waits for them: Cloudflare keeps its
          // own time there, and says so through the timeout callback.
          "before-interactive-callback": () => {
            asking = true;
            if (waiting) clearTimeout(waiting.timer);
            onInteractive?.(true);
          },
          "after-interactive-callback": () => {
            asking = false;
            onInteractive?.(false);
          },
        });
      })
      .catch((error) => {
        if (begun !== life) return;
        starting = null;
        if (error instanceof HumanCheckError) return failed(error);
        // The script loaded and refused what it was asked to draw: a site key it does not recognise, most likely.
        // Its own words are for whoever set the key, so they go to the console.
        console.error(error);
        return failed(new HumanCheckError(COULD_NOT_START));
      });
    return starting;
  }

  function token(element, options) {
    if (!enabled) return Promise.resolve(undefined);
    void start(element, options);
    if (ready) {
      const value = ready;
      ready = null;
      return Promise.resolve(value);
    }
    if (problem) {
      // Said once. The widget starts over, so the next submit waits for a new answer.
      const error = problem;
      renew();
      return Promise.reject(error);
    }
    if (!waiting) {
      const entry = {};
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      if (!asking) entry.timer = setTimeout(() => answer("reject", new HumanCheckError(TOOK_TOO_LONG)), patienceMs);
      waiting = entry;
    }
    return waiting.promise;
  }

  function renew() {
    ready = null;
    problem = null;
    if (turnstile && widget != null) turnstile.reset(widget);
  }

  function stop() {
    life += 1;
    answer("reject", new HumanCheckError(TOOK_TOO_LONG));
    if (turnstile && widget != null) turnstile.remove(widget);
    widget = null;
    starting = null;
    ready = null;
    problem = null;
    asking = false;
  }

  return { enabled, start, token, renew, stop };
}
