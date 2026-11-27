import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhoopStoredReadings } from "../whoop/WhoopStoredReadings";
import { historyWindow, readStoredPulse } from "../whoop/storedReadings";

afterEach(cleanup);

describe("reading an imported WHOOP window", () => {
  const from = new Date("2026-04-15T20:00").getTime();
  const at = (second, bpm, fields = {}) => ({ timestamp: from + second * 1000, bpm, ...fields });

  it("queries the evening before the morning date and handles a workout crossing midnight", () => {
    const overnight = historyWindow("2026-04-16", "overnight");
    expect(overnight).toEqual({ from, until: new Date("2026-04-16T10:00").getTime() });
    expect(historyWindow("2026-04-16", "workout", "23:55", "00:25")).toEqual({
      from: new Date("2026-04-16T23:55").getTime(), until: new Date("2026-04-17T00:25").getTime(),
    });
    expect(historyWindow("2026-04-16", "workout", "06:00", "06:00")).toBeNull();
    expect(historyWindow("", "overnight")).toBeNull();
  });

  it("merges pages, preserving gaps and excluding repeated, off-wrist and motion-only seconds", async () => {
    const bridge = { readHistory: vi.fn().mockResolvedValueOnce({ records: [at(0, 100), at(1, 50), at(10, 220, { onWrist: false })], nextAfter: 11 })
      .mockResolvedValueOnce({ records: [at(1, 50), at(120, null, { gravity: [0, 0, 1] }), at(150, 90)], nextAfter: null }) };
    const result = await readStoredPulse(bridge, from, from + 180_000);
    expect(bridge.readHistory).toHaveBeenLastCalledWith({ after: 11, from, to: from + 179_999, limit: 2000 });
    expect(result).toMatchObject({ samples: 3, totalSeconds: 180, peak: 100, average: 80, lowestFive: null, motionMinutes: 1 });
    expect(result.bins[1].peak).toBe(0);
  });

  it("requires five well-covered minutes for the lowest sustained heart rate", async () => {
    const records = Array.from({length: 6 * 60}, (_, s) => at(s, s < 60 ? 60 : 70));
    const bridge = { readHistory: () => Promise.resolve({ records, nextAfter: null }) };
    expect(await readStoredPulse(bridge, from, from + 7 * 60_000)).toMatchObject({ lowestFive: 68, samples: 360 });
    records.splice(100, 13);
    expect((await readStoredPulse(bridge, from, from + 7 * 60_000)).lowestFive).toBeNull();
  });

  it("stops when the owner leaves a read and surfaces invalid pagination", async () => {
    const bridge = { readHistory: vi.fn(async () => ({ records: [], nextAfter: 3 })) };
    expect(await readStoredPulse(bridge, from, from + 60_000, () => true)).toBeNull();
    expect(bridge.readHistory).toHaveBeenCalledTimes(1);
    await expect(readStoredPulse(bridge, from, from + 60_000)).rejects.toThrow(/paged/);
  });

  it("can browse a phone-free workout and read its imported numbers while disconnected", async () => {
    const readHistory = vi.fn(async ({ from: start }) => ({ records: [{ timestamp: start, bpm: 151 }], nextAfter: null }));
    render(<WhoopStoredReadings bridge={{owner: "athlete", readHistory}} history={{ status: "idle" }} />);
    fireEvent.change(screen.getByLabelText("Morning of"), { target: { value: "2023-03-01" } });
    fireEvent.click(screen.getByRole("button", {name: "Workout window"}));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "12:15" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "13:15" } });
    await waitFor(() => expect(readHistory).toHaveBeenLastCalledWith(expect.objectContaining({
      from: new Date("2023-03-01T12:15").getTime(), to: new Date("2023-03-01T13:15").getTime() - 1,
    })));
    expect(await screen.findByText("151 bpm average · 151 bpm peak")).toBeTruthy();
  });
});
