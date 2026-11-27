// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("serves the guide and the app shell independently after losing connectivity", async () => {
  const origin = "https://example.test";
  const handlers = {};
  const entries = new Map();
  let online = true;
  const cache = { put: (key, value) => entries.set(key, value), match: key => entries.get(key)?.clone() };
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL, Response, setTimeout, clearTimeout,
    self: { location: { origin }, addEventListener: (event, handle) => { handlers[event] = handle; } },
    caches: { open: async () => cache },
    fetch: async request => {
      if (!online) throw new Error("offline");
      return new Response(new URL(request.url).pathname === "/" ? "App shell" : "Training guide");
    },
  });
  async function navigate(path) {
    let response;
    handlers.fetch({ request: { mode: "navigate", method: "GET", url: origin + path }, respondWith: result => { response = result; } });
    return (await response).text();
  }
  expect(await navigate("/")).toBe("App shell");
  expect(await navigate("/training-guide")).toBe("Training guide");
  online = false;
  expect(await navigate("/training-guide.html")).toBe("Training guide");
  expect(await navigate("/")).toBe("App shell");
});
