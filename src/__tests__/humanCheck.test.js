// src/__tests__/humanCheck.test.js
// @vitest-environment jsdom
// The human check on sign-in and sign-up (humanCheck.js), against a stand-in
// for Cloudflare's script: off without a site key, drawn once, one token per
// attempt, and a plain reason when it cannot finish.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHumanCheck, HumanCheckError, humanCheckSiteKey } from "../humanCheck";

// Stands in for window.turnstile: remembers what it was asked to draw, and lets a test play Cloudflare's part by
// calling the callbacks the page handed it.
function fakeTurnstile() {
  const api = {
    render: vi.fn((element, options) => { api.options = options; api.element = element; return "widget-1"; }),
    reset: vi.fn(),
    remove: vi.fn(),
    says: (name, ...args) => api.options[name](...args),
  };
  return api;
}

const SITE_KEY = "0x4AAAAAAA-site-key";
// A form's slot for the widget, as wide as the sign-in card on a desktop unless a test says otherwise.
const slot = (width = 390) => Object.defineProperty(document.createElement("div"), "clientWidth", { value: width });
// Lets promise callbacks that are already due run.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function started(options = {}) {
  const api = fakeTurnstile();
  const load = vi.fn(async () => api);
  const check = createHumanCheck({ siteKey: SITE_KEY, load, ...options });
  return { api, load, check };
}

afterEach(() => { vi.useRealTimers(); });

describe("where the human check is off", () => {
  it("has no site key in a build without one, or in the seeded demo", () => {
    expect(humanCheckSiteKey({})).toBe("");
    expect(humanCheckSiteKey({ VITE_TURNSTILE_SITE_KEY: "  " })).toBe("");
    expect(humanCheckSiteKey({ VITE_TURNSTILE_SITE_KEY: ` ${SITE_KEY} ` })).toBe(SITE_KEY);
    expect(humanCheckSiteKey({ VITE_TURNSTILE_SITE_KEY: SITE_KEY, VITE_DEMO_MODE: "true" })).toBe("");
  });

  it("never loads Cloudflare's script, and gives each attempt no token", async () => {
    const load = vi.fn();
    const check = createHumanCheck({ siteKey: "", load });
    expect(check.enabled).toBe(false);
    await check.start(slot());
    expect(await check.token(slot())).toBeUndefined();
    check.renew();
    check.stop();
    expect(load).not.toHaveBeenCalled();
  });
});

describe("drawing the widget", () => {
  it("loads the script and draws once, however often the form asks", async () => {
    const { api, load, check } = started();
    const element = slot();
    await Promise.all([check.start(element, { theme: "light" }), check.start(element, { theme: "light" })]);
    void check.token(element, { theme: "light" });
    await settled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(api.element).toBe(element);
    expect(api.options).toMatchObject({ sitekey: SITE_KEY, theme: "light", size: "normal", appearance: "interaction-only" });
  });

  it("draws the compact widget where the standard one would not fit", async () => {
    const { api, check } = started();
    await check.start(slot(238));
    expect(api.options.size).toBe("compact");
  });

  it("tells the form when Cloudflare needs the person, and when it no longer does", async () => {
    const { api, check } = started();
    const onInteractive = vi.fn();
    await check.start(slot(), { onInteractive });
    api.says("before-interactive-callback");
    api.says("after-interactive-callback");
    expect(onInteractive.mock.calls).toEqual([[true], [false]]);
  });
});

describe("one token per attempt", () => {
  it("makes a submit wait for Cloudflare's answer", async () => {
    const { api, check } = started();
    const element = slot();
    const waiting = check.token(element);
    await settled();
    api.says("callback", "token-1");
    expect(await waiting).toBe("token-1");
  });

  it("uses an answer that came first straight away, and only once", async () => {
    const { api, check } = started();
    const element = slot();
    await check.start(element);
    api.says("callback", "token-1");
    expect(await check.token(element)).toBe("token-1");

    const next = vi.fn();
    void check.token(element).then(next);
    await settled();
    expect(next).not.toHaveBeenCalled();
    api.says("callback", "token-2");
    await settled();
    expect(next).toHaveBeenCalledWith("token-2");
  });

  it("asks for a fresh answer after an attempt", async () => {
    const { api, check } = started();
    const element = slot();
    await check.start(element);
    api.says("callback", "token-1");
    check.renew();
    expect(api.reset).toHaveBeenCalledWith("widget-1");

    const next = vi.fn();
    void check.token(element).then(next);
    await settled();
    expect(next).not.toHaveBeenCalled();  // the old token went with the attempt it was for
  });

  it("does not send a token that has run out", async () => {
    const { api, check } = started();
    const element = slot();
    await check.start(element);
    api.says("callback", "token-1");
    api.says("expired-callback");

    const next = vi.fn();
    void check.token(element).then(next);
    await settled();
    expect(next).not.toHaveBeenCalled();
    api.says("callback", "token-2");  // Cloudflare refreshes it by itself
    await settled();
    expect(next).toHaveBeenCalledWith("token-2");
  });
});

describe("when the check cannot finish", () => {
  it("tells the waiting submit why, with Cloudflare's code", async () => {
    const { api, check } = started();
    const waiting = check.token(slot());
    await settled();
    expect(api.says("error-callback", "110200")).toBe(true);  // handled here, so Cloudflare does not also warn
    await expect(waiting).rejects.toBeInstanceOf(HumanCheckError);
    await expect(waiting).rejects.toThrow(/could not finish \(Cloudflare code 110200\)/);
  });

  it("says a failure that came before the submit once, then starts over", async () => {
    const { api, check } = started();
    const element = slot();
    await check.start(element);
    api.says("error-callback", "300030");
    await expect(check.token(element)).rejects.toThrow(/Cloudflare code 300030/);
    expect(api.reset).toHaveBeenCalledTimes(1);

    const next = check.token(element);  // the next submit waits for the new answer
    api.says("callback", "token-2");
    expect(await next).toBe("token-2");
  });

  it("says so when the script cannot be loaded, and tries again next time", async () => {
    const api = fakeTurnstile();
    const load = vi.fn()
      .mockRejectedValueOnce(new HumanCheckError("The human check could not load."))
      .mockResolvedValue(api);
    const check = createHumanCheck({ siteKey: SITE_KEY, load });
    const element = slot();
    await expect(check.token(element)).rejects.toThrow("The human check could not load.");

    const next = check.token(element);
    await settled();
    expect(load).toHaveBeenCalledTimes(2);
    api.says("callback", "token-1");
    expect(await next).toBe("token-1");
  });

  it("says it could not start when Cloudflare's script refuses to draw, and keeps the script's reason for the console", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const { api, check } = started();
    const refusal = new Error('[Cloudflare Turnstile] Invalid input for parameter "sitekey".');
    api.render.mockImplementation(() => { throw refusal; });
    await expect(check.token(slot())).rejects.toThrow("The human check could not start. Reload the page and try again.");
    expect(said).toHaveBeenCalledWith(refusal);
    said.mockRestore();
  });

  it("gives up on a check that never answers", async () => {
    vi.useFakeTimers();
    const { check } = started({ patienceMs: 20_000 });
    const waiting = check.token(slot());
    const refused = expect(waiting).rejects.toThrow(/taking too long/);
    await vi.advanceTimersByTimeAsync(20_000);
    await refused;
  });

  it("waits as long as it takes while the person is answering Cloudflare's box", async () => {
    vi.useFakeTimers();
    const { api, check } = started({ patienceMs: 20_000 });
    const done = vi.fn();
    const waiting = check.token(slot());
    void waiting.then(done, done);
    await vi.advanceTimersByTimeAsync(5_000);
    api.says("before-interactive-callback");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(done).not.toHaveBeenCalled();

    api.says("callback", "token-1");
    expect(await waiting).toBe("token-1");
  });

  it("says so when the box was left unanswered", async () => {
    const { api, check } = started();
    const waiting = check.token(slot());
    await settled();
    api.says("before-interactive-callback");
    api.says("timeout-callback");
    await expect(waiting).rejects.toThrow(/timed out before it was answered/);
  });
});

describe("leaving the form", () => {
  it("takes the widget away", async () => {
    const { api, check } = started();
    await check.start(slot());
    check.stop();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
  });

  it("draws nothing when the script arrives after the form has gone", async () => {
    const api = fakeTurnstile();
    let arrive;
    const check = createHumanCheck({ siteKey: SITE_KEY, load: () => new Promise((resolve) => { arrive = resolve; }) });
    void check.start(slot());
    check.stop();
    arrive(api);
    await settled();
    expect(api.render).not.toHaveBeenCalled();
  });
});

describe("Cloudflare's script", () => {
  let loadTurnstile;
  beforeEach(async () => {
    vi.resetModules();
    document.head.innerHTML = "";
    delete window.turnstile;
    ({ loadTurnstile } = await import("../humanCheck"));
  });
  const tags = () => [...document.head.querySelectorAll("script")];

  it("is added to the page once, from Cloudflare's address, asking to draw only where told", async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(tags().map((tag) => tag.src)).toEqual(["https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]);
    window.turnstile = fakeTurnstile();
    tags()[0].onload();
    expect(await first).toBe(window.turnstile);
    expect(await second).toBe(window.turnstile);
  });

  it("is not added again once it is on the page", async () => {
    window.turnstile = fakeTurnstile();
    expect(await loadTurnstile()).toBe(window.turnstile);
    expect(tags()).toHaveLength(0);
  });

  it("says a content blocker may be in the way when it cannot load, and can be asked for again", async () => {
    const first = loadTurnstile();
    tags()[0].onerror();
    await expect(first).rejects.toThrow(/could not load.*allow challenges\.cloudflare\.com/);
    expect(tags()).toHaveLength(0);

    void loadTurnstile().catch(() => {});
    expect(tags()).toHaveLength(1);
  });
});
