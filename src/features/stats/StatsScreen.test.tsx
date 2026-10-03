import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../app/ToastProvider";
import { AppDataProvider } from "../../data/AppDataProvider";
import { createLocalSource } from "../../data/localSource";
import { useAppData } from "../../data/useAppData";
import { dateRange, weekdayName } from "../../domain/dates";
import { expectNoA11yViolations } from "../../test/axe";
import { MemoryStorage } from "../../test/memoryStorage";
import { firstProgram, ONBOARDING_DEFAULTS, previewWeek } from "../onboarding/plan";
import { StatsScreen } from "./StatsScreen";

/** A training day of the default generated week (the demo rotates to any date). */
const TODAY = dateRange("2026-10-05", "2026-10-11").find((k) => !previewWeek(ONBOARDING_DEFAULTS)[weekdayName(k)].rest) ?? "2026-10-05";

function Harness({ children, demo }: { children: ReactNode; demo: boolean }) {
  const storage = useState(() => new MemoryStorage())[0];
  const source = useState(() => createLocalSource(storage))[0];
  return (
    <AppDataProvider source={source}>
      <ToastProvider>
        <Seeded demo={demo}>{children}</Seeded>
      </ToastProvider>
    </AppDataProvider>
  );
}

function Seeded({ children, demo }: { children: ReactNode; demo: boolean }) {
  const { state, seedDemo, replaceProgram, patchSettings } = useAppData();
  const [seeded, setSeeded] = useState(false);
  if (state.status !== "ready") return null;
  if (!seeded) {
    setSeeded(true);
    if (demo) void seedDemo(TODAY);
    else {
      const { program, startedOn } = firstProgram(ONBOARDING_DEFAULTS, TODAY);
      replaceProgram(program);
      patchSettings({ onboarded: true, profile: { name: "Sam" }, game: { startedOn } });
    }
    return null;
  }
  if (!state.settings.onboarded) return null;
  return <>{children}</>;
}

/** Pops the sheet the way the browser's Back does. */
async function back() {
  await act(async () => {
    window.history.replaceState({ sheets: [] }, "", "#/stats");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

describe("StatsScreen", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/stats");
  });

  it("shows the demo's status, requirements, stat tiles, records and titles with one primary", async () => {
    const { container } = render(<Harness demo><StatsScreen todayKey={TODAY} /></Harness>);
    await screen.findByRole("heading", { level: 1, name: "Stats" });
    const status = screen.getByRole("region", { name: "Status" });
    expect(within(status).getByText("Guest")).toHaveClass("ot-heading");
    expect(within(status).getByText("Initiate")).toHaveClass("ot-small", "ot-ink-2");
    expect(within(status).getByRole("img", { name: "Rank D" })).toHaveClass("ot-rank-lg");
    expect(within(status).getByText(/^Lv 15 · \d{1,3}(,\d{3})* \/ \d{1,3}(,\d{3})* XP$/)).toHaveClass("ot-numeral");
    expect(within(status).getByRole("progressbar", { name: "Level 15 progress" })).toBeInTheDocument();
    expect(within(status).getByText("Level 12 (you: 15, met)")).toBeInTheDocument();
    expect(within(status).getByText("4 qualifying weeks (10, met)")).toBeInTheDocument();
    expect(within(status).getByText("STR or END 25 (42, met)")).toBeInTheDocument();
    expect(within(status).getByText("Rank Trial")).toBeInTheDocument();
    expect(within(status).getByText("available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Begin Rank Trial" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);

    const tiles = within(screen.getByRole("region", { name: "Stats" })).getAllByRole("button");
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual(["STR 42, steady. Explain.", "END 23, steady. Explain.", "VIT 92, steady. Explain."]);
    expect(tiles[0]?.querySelectorAll("path")).toHaveLength(1);

    const records = screen.getByRole("region", { name: "Records" });
    expect(within(records).getByRole("heading", { name: "Records" })).toBeInTheDocument();
    const rows = within(records).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(within(rows[0] as HTMLElement).getByText("Back Squat")).toHaveClass("ot-body-strong");
    expect(within(rows[0] as HTMLElement).getByText("est. max 72.8 kg")).toHaveClass("ot-numeral");
    expect(within(rows[0] as HTMLElement).getByText(/^\w{3} \d{1,2} \w{3}$/)).toHaveClass("ot-caption");
    expect(within(records).queryByRole("button", { name: "View all" })).toBeNull();

    const titles = screen.getByRole("region", { name: "Titles" });
    expect(within(titles).getByRole("heading", { name: "Titles 8/18" })).toBeInTheDocument();
    expect(within(titles).getAllByRole("listitem")).toHaveLength(8);
    expect(within(titles).getByRole("button", { name: /^Initiate/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(titles).getByRole("button", { name: "All titles" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/!|e1RM/);
    await expectNoA11yViolations(container);
  });

  it("opens the explain sheet from a stat tile with the formula, the inputs and a readable series", async () => {
    render(<Harness demo><StatsScreen todayKey={TODAY} /></Harness>);
    await userEvent.click(await screen.findByRole("button", { name: "STR 42, steady. Explain." }));
    const sheet = await screen.findByRole("dialog", { name: "STR" });
    expect(sheet).toHaveTextContent(/STR is the average of 4 groups/);
    expect(within(sheet).getByRole("list", { name: "STR inputs" })).toHaveTextContent("Squat36");
    expect(within(sheet).getByRole("table", { name: "STR by week" })).toBeInTheDocument();
    expect(within(sheet).getAllByRole("row")).toHaveLength(5);
    expect(within(sheet).getAllByRole("cell").at(-1)).toHaveTextContent("42");
    expect(sheet.textContent).not.toMatch(/e1RM|!/);
    await expectNoA11yViolations(sheet);
    await back();
  });

  it("opens the Rank Trial sheet from the primary, with the prescription, the safety line, the day and the reward", async () => {
    render(<Harness demo><StatsScreen todayKey={TODAY} /></Harness>);
    await userEvent.click(await screen.findByRole("button", { name: "Begin Rank Trial" }));
    const sheet = await screen.findByRole("dialog", { name: /\[Rank Trial\]/ });
    expect(within(sheet).getByRole("img", { name: "Rank C" })).toHaveClass("ot-rank-md");
    expect(within(sheet).getByText("5 reps at 80% of your best: 55 kg Back Squat")).toHaveClass("ot-numeral");
    expect(within(sheet).getByText("Stop if anything hurts.")).toHaveClass("ot-body-strong");
    expect(within(sheet).getByText(/^Attaches to \w{3} \d{1,2} \w{3}, your next full day with Back Squat\.$/)).toBeInTheDocument();
    expect(within(sheet).getByText("+300 XP, promotion, a title")).toHaveClass("ot-small", "ot-ink-2");
    expect(within(sheet).getByRole("button", { name: "Got it" })).toHaveAttribute("data-primary", "true");
    await expectNoA11yViolations(sheet);
    await back();
  });

  it("features a title on tap: settings patched, the status block and a toast say so", async () => {
    render(<Harness demo><StatsScreen todayKey={TODAY} /></Harness>);
    const titles = within(await screen.findByRole("region", { name: "Titles" }));
    await userEvent.click(titles.getByRole("button", { name: "First Quest" }));
    expect(titles.getByRole("button", { name: /^First Quest/ })).toHaveAttribute("aria-pressed", "true");
    expect(titles.getByRole("button", { name: /^Initiate/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(screen.getByRole("region", { name: "Status" })).getByText("First Quest")).toHaveClass("ot-small");
    expect(screen.getByRole("status")).toHaveTextContent(/^\[TITLE\]\s*First Quest featured\./);
  });

  it("opens every title in a sheet and features from there too", async () => {
    render(<Harness demo><StatsScreen todayKey={TODAY} /></Harness>);
    await userEvent.click(await screen.findByRole("button", { name: "All titles" }));
    const sheet = await screen.findByRole("dialog", { name: "Titles 8/18" });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(18);
    expect(within(sheet).getByText("Reach rank C")).toHaveClass("ot-small", "ot-ink-3");
    await userEvent.click(within(sheet).getByRole("button", { name: "Unbroken I" }));
    expect(within(sheet).getByRole("button", { name: "Unbroken I" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByRole("button", { name: "Initiate" })).toHaveAttribute("aria-pressed", "false");
    await expectNoA11yViolations(sheet);
    await back();
  });

  it("on a fresh character shows no primary, the locked trial, the empty records state and the name", async () => {
    const { container } = render(<Harness demo={false}><StatsScreen todayKey={TODAY} /></Harness>);
    const status = await screen.findByRole("region", { name: "Status" });
    expect(within(status).getByText("Sam")).toBeInTheDocument();
    expect(within(status).getByRole("img", { name: "Rank E" })).toBeInTheDocument();
    expect(within(status).getByText(/^Level 5 \(you: 1\)$/)).toBeInTheDocument();
    expect(within(status).queryByText("Rank Trial")).toBeNull();
    expect(screen.queryByRole("button", { name: "Begin Rank Trial" })).toBeNull();
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(0);
    const records = screen.getByRole("region", { name: "Records" });
    expect(within(records).getByText("No records yet")).toBeInTheDocument();
    expect(within(records).getByText("Your first logged set becomes your first record.")).toBeInTheDocument();
    expect(within(records).getByRole("button", { name: "Back to quest" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Titles" })).getByRole("heading", { name: "Titles 0/18" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VIT 25, calibrating. Explain." })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("renders the quest log slot last", async () => {
    render(<Harness demo><StatsScreen todayKey={TODAY} questLog={<section aria-label="Quest log">log</section>} /></Harness>);
    const log = await screen.findByRole("region", { name: "Quest log" });
    expect(log.previousElementSibling).toBe(screen.getByRole("region", { name: "Titles" }));
  });
});
