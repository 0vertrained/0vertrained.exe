import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionComplete } from "../SessionComplete";

let reportVisibility;
let motion;
let reducedData;
let connection;
let play;

beforeEach(() => {
  motion = Object.assign(new EventTarget(), { matches: false });
  reducedData = Object.assign(new EventTarget(), { matches: false });
  connection = Object.assign(new EventTarget(), { saveData: false });
  vi.stubGlobal("matchMedia", (query) => query.includes("reduced-data") ? reducedData : motion);
  Object.defineProperty(navigator, "connection", { configurable: true, value: connection });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback) {
      reportVisibility = (ratio) => act(() => callback([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]));
    }
    observe() {}
    disconnect() {}
  });
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  delete navigator.connection;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function recap(liftsDone = 1, mode) {
  return <div data-motion={mode}><SessionComplete boxScore={{ liftsDone }} onDismiss={() => {}} /></div>;
}

describe("the workout finish film", () => {
  it("requests the muted clip once the earned recap is in view and leaves it still when revisited", () => {
    const { container, rerender } = render(recap(0));
    expect(container.querySelector(".box-finish-art")).toBeNull();
    rerender(recap());
    expect(container.querySelector(".box-finish-art img").alt).toBe("");
    reportVisibility(0.25);
    expect(container.querySelector("video")).toBeNull();
    reportVisibility(1);
    const video = container.querySelector("video");
    expect(video.muted && video.playsInline).toBe(true);
    expect(video.loop || video.controls).toBe(false);
    expect(play).toHaveBeenCalledOnce();
    reportVisibility(0);
    reportVisibility(1);
    expect(container.querySelector("video")).toBeNull();
    expect(play).toHaveBeenCalledOnce();
  });

  it.each(["reduced", "still", "system", "save-data", "reduced-data"])("keeps the still photograph for %s", (mode) => {
    motion.matches = mode === "system";
    reducedData.matches = mode === "reduced-data";
    connection.saveData = mode === "save-data";
    const { container } = render(recap(1, mode));
    reportVisibility(1);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".box-finish-art img")).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
  });

  it("stops on a preference change and recovers from a playback rejection", async () => {
    const { container, rerender, unmount } = render(recap());
    reportVisibility(1);
    await act(async () => rerender(recap(1, "still")));
    expect(container.querySelector("video")).toBeNull();
    unmount();
    play.mockRejectedValueOnce(new Error("Autoplay unavailable"));
    const fallback = render(recap());
    await act(async () => reportVisibility(1));
    expect(fallback.container.querySelector("video")).toBeNull();
    expect(fallback.container.querySelector(".box-finish-art img")).toBeTruthy();
  });
});
