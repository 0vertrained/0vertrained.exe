import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");

describe("installed app shell", () => {
  it("uses the paper identity and a dedicated maskable icon", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "public/manifest.json"), "utf8"));
    expect(manifest.background_color).toBe("#FAF9F6");
    expect(manifest.theme_color).toBe("#FAF9F6");
    expect(manifest.description).toMatch(/private training ledger/i);
    expect(manifest.icons.some((icon) => icon.purpose === "maskable" && icon.src === "/icon-maskable.png")).toBe(true);
  });

  it("keeps push handling while adding a network-first navigation fallback", () => {
    const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain('cache.match("/")');
    expect(sw).toContain('addEventListener("push"');
  });

  it("passes a movie byte-range request through to the browser", () => {
    const listeners = new Map();
    const respondWith = vi.fn();
    const origin = "https://example.test";
    const self = { location: { origin }, addEventListener: (event, fn) => listeners.set(event, fn) };
    const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
    runInNewContext(sw, { self, URL });
    const request = new Request(origin + "/assets/finish.mp4", { headers: { Range: "bytes=0-1" } });
    listeners.get("fetch")({ request, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
});
