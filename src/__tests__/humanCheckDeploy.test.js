// src/__tests__/humanCheckDeploy.test.js
// What the human check needs from the deployment, and what it must not get
// (docs/human-check.md): the content security policy lets in Cloudflare's
// script and frame and nothing more, the site key is treated as the public
// value it is, the widget's secret key has no place in Netlify, the service
// worker stays out of Cloudflare's requests, and the privacy policy names
// Cloudflare for as long as the code can load it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const netlify = readFileSync("netlify.toml", "utf8");
const csp = netlify.match(/Content-Security-Policy = "([^"]+)"/)[1];
const directive = (name) => csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `))?.slice(name.length + 1);
const TURNSTILE = "https://challenges.cloudflare.com";

describe("the human check's place in the deployment", () => {
  it("lets Cloudflare's script run and its frame open, and nothing else new", () => {
    expect(directive("script-src")).toBe(`'self' ${TURNSTILE}`);
    expect(directive("frame-src")).toBe(TURNSTILE);
    expect(directive("default-src")).toBe("'self'");
    // The page itself never calls Cloudflare: the widget talks to it from inside its own frame.
    expect(directive("connect-src")).not.toContain("cloudflare");
  });

  it("treats the site key as public, so Netlify's secret scan does not fail on finding it in the build", () => {
    const omitted = netlify.match(/SECRETS_SCAN_OMIT_KEYS = "([^"]+)"/)[1].split(",");
    expect(omitted).toContain("VITE_TURNSTILE_SITE_KEY");
  });

  it("gives the widget's secret key no name here: it is held by Supabase alone", () => {
    expect(netlify).not.toMatch(/TURNSTILE_SECRET/i);
    expect(readFileSync("src/humanCheck.js", "utf8")).not.toMatch(/SECRET_KEY|secretKey/);
  });

  it("keeps the service worker out of other origins' requests", () => {
    expect(readFileSync("public/sw.js", "utf8")).toContain("url.origin !== self.location.origin");
  });

  it("is named in the privacy policy", () => {
    const policy = readFileSync("public/legal/privacy-policy.html", "utf8");
    expect(policy).toMatch(/<strong>Cloudflare \(Turnstile\):<\/strong>/);
    expect(policy).toContain("It runs only once you start to use the sign-in form.");
  });
});
