import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../test/axe";
import { QuestLogScreen } from "./QuestLogScreen";
import { DayProbe, Harness } from "./testHarness";

const TODAY = "2026-10-02";

function Screen() {
  return <QuestLogScreen todayKey={TODAY} />;
}

async function openDay(name: RegExp): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Logged days" });
  await userEvent.click(within(list).getByRole("button", { name }));
  return screen.findByRole("dialog", { name });
}

describe("QuestLogScreen", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/stats/log");
  });

  it("lists 20 rows newest first and appends the next page", async () => {
    const { container } = render(<Harness character="demo" todayKey={TODAY}><Screen /></Harness>);
    await screen.findByRole("heading", { level: 1, name: "Quest log" });
    const list = await screen.findByRole("list", { name: "Logged days" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(20);

    const rows = within(list).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Fri 2 Oct");
    expect(rows[0]).toHaveTextContent("Open");
    expect(rows[0]).toHaveTextContent("+10 XP");
    expect(within(rows[0] as HTMLElement).getByRole("img", { name: "Tier: Reduced" })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Thu 1 Oct");
    expect(rows[1]).toHaveTextContent("Rest");
    expect(rows[2]).toHaveTextContent("Wed 30 Sep");
    expect(rows[2]).toHaveTextContent("Cleared");
    expect(rows[2]).toHaveTextContent("+100 XP");
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Next 20" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(40);
    await userEvent.click(screen.getByRole("button", { name: "Next 20" }));
    await userEvent.click(screen.getByRole("button", { name: "Next 10" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(70);
    expect(screen.queryByRole("button", { name: /^Next/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to stats" })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("opens a day on its own route, shows the sets, and closes back to the log", async () => {
    const { container } = render(<Harness character="demo" todayKey={TODAY}><Screen /></Harness>);
    const sheet = await openDay(/Wed 30 Sep/);
    expect(window.location.hash).toBe("#/stats/log/2026-09-30");
    expect(within(sheet).getByRole("img", { name: "Tier: Full" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Cleared");
    expect(sheet).toHaveTextContent("Training · 15 / 15 sets");
    expect(sheet).toHaveTextContent("+90 XP");
    expect(sheet).toHaveTextContent("Conventional Deadlift");
    expect(sheet).toHaveTextContent("75 × 6 · 75 × 6 · 75 × 6");
    expect(sheet).toHaveTextContent("Walking Lunge");
    expect(sheet).toHaveTextContent("BW × 10");
    expect(sheet).toHaveTextContent("Easy Walk/Run");
    expect(sheet).toHaveTextContent("29 min · 2.4 km");
    expect(sheet).toHaveTextContent("Slept well · Sore no · Stress low · Energy high");
    expect(within(sheet).getByRole("button", { name: "Edit in runner" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Delete day" })).not.toHaveAttribute("data-primary");
    await expectNoA11yViolations(container);

    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(window.location.hash).toBe("#/stats/log");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(screen.getByRole("list", { name: "Logged days" })).getAllByRole("listitem")).toHaveLength(20);
  });

  it("shows the record on the day it was set and no runner for a rest day", async () => {
    render(<Harness character="demo" todayKey={TODAY}><Screen /></Harness>);
    const sheet = await openDay(/Mon 28 Sep/);
    expect(sheet).toHaveTextContent("Record · Back Squat");
    expect(sheet).toHaveTextContent("Back Squat est. max 72.8 kg (was 69.7 kg).");
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const rest = await openDay(/Thu 1 Oct/);
    expect(rest).toHaveTextContent("Rest day.");
    expect(rest).toHaveTextContent("Recovery");
    expect(within(rest).queryByRole("button", { name: "Edit in runner" })).not.toBeInTheDocument();
    expect(within(rest).getByRole("button", { name: "Delete day" })).toBeInTheDocument();
  });

  it("opens the runner on the day's own session route", async () => {
    render(<Harness character="demo" todayKey={TODAY}><Screen /></Harness>);
    const sheet = await openDay(/Wed 30 Sep/);
    await userEvent.click(within(sheet).getByRole("button", { name: "Edit in runner" }));
    expect(window.location.hash).toBe("#/session/2026-09-30");
  });

  it("deletes a day after stating the cost, then toasts and closes", async () => {
    const { container } = render(
      <Harness character="demo" todayKey={TODAY}><Screen /><DayProbe dateKey="2026-09-28" /></Harness>,
    );
    const sheet = await openDay(/Mon 28 Sep/);
    expect(screen.getByTestId("has-day")).toHaveTextContent("yes");
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete day" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Delete this day?" });
    expect(dialog).toHaveTextContent("Removes the log for Mon 28 Sep. XP goes from 6,770 to 6,645 (−125). Streak drops to 66 days.");
    await expectNoA11yViolations(container);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("has-day")).toHaveTextContent("yes");

    await userEvent.click(within(sheet).getByRole("button", { name: "Delete day" }));
    const again = await screen.findByRole("alertdialog", { name: "Delete this day?" });
    await userEvent.click(within(again).getByRole("button", { name: "Delete day" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#/stats/log");
    expect(screen.getByTestId("has-day")).toHaveTextContent("no");
    expect(await screen.findByRole("status")).toHaveTextContent(/\[QUEST\]\s*Day deleted\./);
    // With its entry gone the planned day, past its logging window, is judged missed; the row stays, neutral in tone.
    const row = within(screen.getByRole("list", { name: "Logged days" })).getByRole("button", { name: /Mon 28 Sep/ });
    expect(row).toHaveTextContent("Missed");
    expect(row).toHaveTextContent("—");
  });

  it("says what is true when nothing is logged", async () => {
    render(<Harness character="bare" todayKey={TODAY}><Screen /></Harness>);
    expect(await screen.findByRole("heading", { level: 2, name: "Nothing logged yet." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to quest" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Logged days" })).not.toBeInTheDocument();
  });

  it("opens a date with no result as an empty sheet", async () => {
    window.history.replaceState(null, "", "#/stats/log/2030-01-01");
    render(<Harness character="demo" todayKey={TODAY}><Screen /></Harness>);
    const sheet = await screen.findByRole("dialog", { name: "Tue 1 Jan" });
    expect(sheet).toHaveTextContent("Nothing logged on this day.");
    expect(within(sheet).queryByRole("button", { name: "Delete day" })).not.toBeInTheDocument();
  });
});
