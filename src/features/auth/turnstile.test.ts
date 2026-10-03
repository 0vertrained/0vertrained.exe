import { describe, expect, it, vi } from "vitest";
import { loadTurnstile, loadTurnstileScript, TURNSTILE_SRC, type TurnstileApi, type TurnstileWindow } from "./turnstile";

function fakeApi() {
  const api: TurnstileApi & { options: Array<Parameters<TurnstileApi["render"]>[1]> } = {
    options: [],
    render: vi.fn((_el, options) => {
      api.options.push(options);
      return "widget-1";
    }),
    remove: vi.fn(),
    reset: vi.fn(),
  };
  return api;
}

describe("turnstile", () => {
  it("adds one script tag with the explicit-render URL and resolves when the onload callback fires", async () => {
    const win: TurnstileWindow = { document };
    const pending = loadTurnstileScript(win);
    const again = loadTurnstileScript(win);
    const scripts = document.querySelectorAll("script[src^='https://challenges.cloudflare.com/']");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute("src")).toBe(`${TURNSTILE_SRC}?onload=ovtTurnstileReady&render=explicit`);
    expect(again).toBe(pending);
    const api = fakeApi();
    win.turnstile = api;
    win.ovtTurnstileReady?.();
    await expect(pending).resolves.toBe(api);
    scripts[0]?.remove();
  });

  it("renders into the container with the site key, relays tokens and removes the widget on cleanup", async () => {
    const api = fakeApi();
    const win: TurnstileWindow = { document, turnstile: api };
    const container = document.createElement("div");
    const onToken = vi.fn();
    const dispose = await loadTurnstile("site-key", container, onToken, win);
    expect(api.render).toHaveBeenCalledWith(container, expect.objectContaining({ sitekey: "site-key" }));
    const options = api.options[0]!;
    options.callback("tok");
    options["expired-callback"]?.();
    expect(onToken.mock.calls).toEqual([["tok"], [""]]);
    dispose();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
  });
});
