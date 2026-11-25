// src/__tests__/landingCompliance.test.jsx
// Locks the public homepage's basics: the functionality description
// (Abstract), the privacy/terms links in both the masthead and the colophon,
// and index.html's description and no-JS fallback. Google Health was retired
// in 19.9.0, so the Google data-use disclosure and its verification tag are
// gone and must stay gone while nothing reads Google data.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ThemeProvider } from "../theme";
import LandingPage, { ABSTRACT_TEXT } from "../landing/LandingPage";

// This repo runs vitest without globals, so RTL's automatic cleanup never
// registers — without this, each render leaks into the next test's queries.
afterEach(cleanup);

const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("LandingPage — public homepage", () => {
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

  it("lists only the data sources the app reads", () => {
    const { container } = wrap(<LandingPage />);
    const text = container.textContent;
    for (const source of ["Manual", "Oura + Whoop", "Strava"]) expect(text).toContain(source);
    expect(text).not.toMatch(/Fitbit|Google/);
  });
});

describe("Static files", () => {
  it("index.html carries the landing meta description and a no-JS fallback with a privacy link", () => {
    const html = read("../../index.html");
    expect(html).toContain('name="description"');
    expect(html).toContain("<noscript>");
    expect(html.split("<noscript>")[1]).toContain("/legal/privacy-policy.html");
  });

  it("no page still describes Google data access", () => {
    for (const rel of ["../../index.html", "../../public/legal/privacy-policy.html", "../../public/legal/terms-of-service.html", "../../public/legal/index.html"]) {
      expect(read(rel), rel).not.toMatch(/Fitbit|Google Health|Limited Use|google-site-verification/);
    }
  });
});
