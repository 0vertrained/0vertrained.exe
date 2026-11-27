// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ShellProvider } from "../ui/shell";
import { TrainTab } from "../TrainTab";
import { presetProgram } from "../constants";
import { startRoadTrailHybrid } from "../plans/roadTrailHybrid";
import { applyRaceBuild } from "../raceBuild";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Train → Road & Trail Hybrid block", () => {
  it("previews an entire race week and changes the active target only on Save, keeping the athlete’s dates and edits", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-07T12:00:00"));
    const todayKey = "2026-12-07";
    const base = structuredClone(presetProgram("roadTrailHybrid"));
    base.Monday.sessions[0].lifting[0].sets = 5;
    base.__weekMoves = { "2026-12-07": { Monday: "Friday", Friday: "Monday" } };
    const initial = startRoadTrailHybrid(base, "2026-11-30", { raceTarget: "road10k" });
    const saved = vi.fn();
    function Harness() {
      const [program, setProgram] = useState(initial);
      return <ThemeProvider><ShellProvider><TrainTab program={program} liveProgram={applyRaceBuild(program, todayKey)}
        entries={{}} settings={{}} onSaveProgram={async (next, options) => { saved(next, options); setProgram(next); return true; }} />
      </ShellProvider></ThemeProvider>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Block.*Road & Trail Hybrid/ }));
    expect(screen.getByText("Week 2 of 8 · Build")).toBeTruthy();
    const preview = screen.getByRole("combobox", { name: "Preview a training week" });
    expect(preview.value).toBe("2");
    fireEvent.change(preview, { target: { value: "8" } });
    expect(screen.getAllByText(/Road 10K race or benchmark/).length).toBeGreaterThan(0);
    expect(screen.getByText(/working sets ·.*min cardio/)).toBeTruthy();
    const target = screen.getByLabelText("Hybrid race target");
    fireEvent.change(target, { target: { value: "trail15k" } });
    expect(saved).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save race target" })));
    expect(saved).toHaveBeenCalledTimes(1);
    const next = saved.mock.calls[0][0];
    expect(next).toEqual({ ...initial, __hybridBlock: { ...initial.__hybridBlock, raceTarget: "trail15k" } });
    expect(preview.value).toBe("8");
    expect(screen.getAllByText(/Trail 15K race or benchmark/).length).toBeGreaterThan(0);
    expect(screen.getByText("Week 2 of 8 · Build")).toBeTruthy();
  });
});
