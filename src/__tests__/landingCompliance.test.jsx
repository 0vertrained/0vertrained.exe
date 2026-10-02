// src/__tests__/landingCompliance.test.jsx
// V13.2 · Locks the Google-OAuth-verification-critical surface of the
// logged-out landing page: the Limited Use disclosure (homepage + privacy
// policy, kept in lockstep), the privacy/terms links in both the masthead and
// colophon, the Fig. 4 data-use rows, the functionality description
// (Abstract), and the Search Console site-verification meta tag in
// index.html. If a refactor drops any of these, app verification breaks —
// these tests fail first.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ThemeProvider } from "../theme";
import LandingPage, {
  ABSTRACT_TEXT,
  GOOGLE_DATA_ROWS,
  LIMITED_USE_DISCLOSURE,
} from "../landing/LandingPage";

// This repo runs vitest without globals, so RTL's automatic cleanup never
// registers — without this, each render leaks into the next test's queries.
afterEach(cleanup);

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";

describe("LandingPage — Google verification homepage requirements", () => {
  it("renders the Limited Use disclosure with a link to the User Data Policy", () => {
    const { container } = wrap(<LandingPage />);
    const text = container.textContent.replace(/\s+/g, " ");
    expect(LIMITED_USE_DISCLOSURE).toContain("including the Limited Use requirements");
    expect(text).toContain(LIMITED_USE_DISCLOSURE);
    const link = Array.from(container.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === POLICY_URL
    );
    expect(link).toBeTruthy();
    expect(link.textContent).toBe("Google API Services User Data Policy");
  });

  it("describes the app's functionality via the Abstract", () => {
    const { container } = wrap(<LandingPage />);
    expect(container.textContent).toContain(ABSTRACT_TEXT);
  });

  it("links the privacy policy and terms in both the masthead and the colophon", () => {
    const { container } = wrap(<LandingPage />);
    const hrefs = (sel) => container.querySelectorAll(`a[href="${sel}"]`).length;
    expect(hrefs("/legal/privacy-policy.html")).toBeGreaterThanOrEqual(2);
    expect(hrefs("/legal/terms-of-service.html")).toBeGreaterThanOrEqual(2);
  });

  it("explains access, purpose, prohibitions, and user control for Google data", () => {
    wrap(<LandingPage />);
    expect(GOOGLE_DATA_ROWS.map(([label]) => label)).toEqual([
      "We access",
      "Only to",
      "Never",
      "Your control",
    ]);
    for (const [label, body] of GOOGLE_DATA_ROWS) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(body)).toBeTruthy();
    }
    // The figure is deep-linkable (#google-data) for consent-screen reviewer notes.
    expect(document.getElementById("google-data")).toBeTruthy();
  });
});

describe("Static files — verification requirements stay in place", () => {
  it("privacy policy carries the same Limited Use disclosure and policy link", () => {
    const html = read("../../public/legal/privacy-policy.html");
    expect(html).toContain("including the Limited Use requirements");
    expect(html).toContain(POLICY_URL);
  });

  it("index.html keeps the Google site-verification tag verbatim", () => {
    const html = read("../../index.html");
    expect(html).toContain(
      '<meta name="google-site-verification" content="r-SApNWlGYvjjddS8aw7qAFzbWfBicwDw94nR6_kfrQ" />'
    );
  });

  it("index.html carries the landing meta description and a no-JS fallback with a privacy link", () => {
    const html = read("../../index.html");
    expect(html).toContain('name="description"');
    expect(html).toContain("<noscript>");
    expect(html.split("<noscript>")[1]).toContain("/legal/privacy-policy.html");
  });
});
