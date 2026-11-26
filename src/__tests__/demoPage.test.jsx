// src/__tests__/demoPage.test.jsx
// The public demo and the sample mornings run the app's own engines and name
// the call the way the app does.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DemoPage from "../DemoPage";
import { SampleMornings, callFor } from "../landing/ReadinessSpecimen";

afterEach(cleanup);

describe("The sample call", () => {
  it("gives each of the four calls a training day can reach", () => {
    expect(callFor(82, 1.05).stamp).toBe("Push");
    expect(callFor(72, 1.2).stamp).toBe("Train");
    expect(callFor(58, 1.45).stamp).toBe("Easy");
    expect(callFor(45, 1.1).stamp).toBe("Recover");
  });
});

describe("Demo and the sample call", () => {
  it("names the call the way the app does and follows the inputs", () => {
    render(<DemoPage onClose={() => {}} />);
    expect(screen.getAllByText("Push").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Recovery"), { target: { value: "30" } });
    expect(screen.getAllByText("Recover").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("#signup");
  });

  it("leaves out the sign-up block for someone signed in", () => {
    render(<DemoPage onClose={() => {}} signedIn />);
    expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
  });

  it("steps through sample mornings only when asked", () => {
    render(<SampleMornings />);
    expect(screen.getByText("Push")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show another morning" }));
    expect(screen.getByText("Train")).toBeTruthy();
  });
});
