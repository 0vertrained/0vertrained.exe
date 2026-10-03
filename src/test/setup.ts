// Shared setup for the v20 component tests: RTL cleanup between tests and a
// clean localStorage, so a test never sees another test's guest data.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // storage can be unavailable in some environments
  }
});
