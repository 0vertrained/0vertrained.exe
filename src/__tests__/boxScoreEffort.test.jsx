// src/__tests__/boxScoreEffort.test.jsx
// The Box Score asks how hard the session was, 1 to 10 on Apple's scale,
// and says what the number means. The rating is the session's RPE, so it
// sets the day's training load.
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionComplete } from "../SessionComplete";
import { effortWord } from "../effort";
import { computeSessionLoad } from "../loadModel";

afterEach(cleanup);

function Rated() {
  const [effort, setEffort] = useState("");
  return (
    <>
      <SessionComplete boxScore={{ headline: "Session logged." }} onDismiss={() => {}} effort={effort} onEffort={(score) => setEffort(String(score))} />
      <output data-testid="rpe">{effort}</output>
    </>
  );
}

describe("rating the session", () => {
  it("takes 1 to 10 and says what it means", () => {
    render(<Rated />);
    expect(screen.getByText("1 is easy, 10 is all out. It sets this session’s training load.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "7, hard" }));
    expect(screen.getByTestId("rpe").textContent).toBe("7");
    expect(screen.getByRole("button", { name: "7, hard" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("7, hard. It sets this session’s training load.")).toBeTruthy();
  });

  it("isn't asked where it can't be kept", () => {
    render(<SessionComplete boxScore={{ headline: "Session logged." }} onDismiss={() => {}} />);
    expect(screen.queryByRole("heading", { name: "How hard was it?" })).toBeNull();
  });

  it("uses Apple's words", () => {
    expect([1, 3, 4, 6, 7, 8, 9, 10].map(effortWord)).toEqual(["easy", "easy", "moderate", "moderate", "hard", "hard", "all out", "all out"]);
    expect(effortWord(0)).toBe("");
  });

  it("sets the session's load", () => {
    const set = { weight: "200", reps: "5", done: true };
    const day = (rpe) => ({ workout: { rpe, exercises: { Squat: { sets: [set, set, set] } } } });
    expect(computeSessionLoad(day("8"))).toMatchObject({ rpe: 8, load: 72, rpeEstimated: false });
    expect(computeSessionLoad(day("")).rpeEstimated).toBe(true);
  });
});
