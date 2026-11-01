// netlify/tests/api-routes.test.js
// V19.4 · Every /api/… path the browser calls has to reach a function, either
// through a v2 function's `export const config = { path }` or a netlify.toml
// redirect. Anything else falls through to the SPA rewrite (/* → /index.html,
// 200) and fails without a sound. That is how analytics, crash reports and
// push subscriptions went nowhere until this release.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") sourceFiles(path, out);
    } else if (/\.(js|jsx)$/.test(name) && !/\.(test|spec)\./.test(name)) {
      out.push(path);
    }
  }
  return out;
}

// "/api/oura/events${qs}" → "/api/oura/events"
function clientCalls() {
  const calls = new Map();
  for (const file of sourceFiles(join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/["'`](\/api\/[-A-Za-z0-9_/.]*)/g)) {
      const path = m[1].replace(/\/$/, "");
      if (!calls.has(path)) calls.set(path, relative(root, file));
    }
  }
  return calls;
}

function functionRoutes() {
  const routes = [];
  const dir = join(root, "netlify/functions");
  for (const name of readdirSync(dir)) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    const text = readFileSync(join(dir, name), "utf8");
    const config = text.match(/export const config\s*=\s*\{([\s\S]*?)\};?/);
    if (!config) continue;
    const path = config[1].match(/\bpath:\s*(\[[\s\S]*?\]|"[^"]+"|'[^']+')/);
    if (!path) continue;
    for (const p of path[1].matchAll(/["']([^"']+)["']/g)) routes.push({ route: p[1], name });
  }
  return routes;
}

function redirectRoutes() {
  const toml = readFileSync(join(root, "netlify.toml"), "utf8");
  return [...toml.matchAll(/from\s*=\s*"(\/api\/[^"]*)"/g)].map((m) => ({ route: m[1], name: "netlify.toml" }));
}

const reaches = (path, route) => (route.endsWith("/*") ? path.startsWith(route.slice(0, -1)) : path === route);

describe("browser → function routing", () => {
  const routes = [...functionRoutes(), ...redirectRoutes()];
  const calls = clientCalls();

  it("finds the calls and the routes it is checking (a parser that finds nothing would pass vacuously)", () => {
    expect(calls.size).toBeGreaterThan(5);
    expect(routes.length).toBeGreaterThan(5);
  });

  it("every /api path in src/ reaches a declared function path or a redirect", () => {
    const unrouted = [...calls].filter(([path]) => !routes.some(({ route }) => reaches(path, route))).map(([path, file]) => `${path} (${file})`);
    expect(unrouted).toEqual([]);
  });

  it.each([
    ["log-event.js", "/api/log-event"],
    ["log-error.js", "/api/log-error"],
    ["push-subscribe.js", "/api/push-subscribe"],
  ])("%s answers at %s", (name, path) => {
    expect(routes).toContainEqual({ route: path, name });
  });
});
