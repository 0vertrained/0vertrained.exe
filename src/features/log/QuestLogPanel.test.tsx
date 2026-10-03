import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../test/axe";
import { QuestLogPanel } from "./QuestLogPanel";
import { Harness } from "./testHarness";

const TODAY = "2026-10-02";

describe("QuestLogPanel", () => {
  it("shows `limit` rows with the tier as a word, opens a day, and offers View all when the log is longer", async () => {
    const onOpen = vi.fn();
    const onViewAll = vi.fn();
    const { container } = render(
      <Harness character="demo" todayKey={TODAY}>
        <QuestLogPanel todayKey={TODAY} limit={5} onOpen={onOpen} onViewAll={onViewAll} />
      </Harness>,
    );
    await screen.findByRole("heading", { level: 2, name: "Quest log" });
    const list = screen.getByRole("list", { name: "Logged days" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);

    const rows = within(list).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Fri 2 Oct");
    expect(within(rows[0] as HTMLElement).getByRole("img", { name: "Tier: Reduced" })).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("Open");
    expect(rows[0]).toHaveTextContent("+10 XP");
    expect(rows[1]).toHaveTextContent("Thu 1 Oct");
    expect(within(rows[1] as HTMLElement).getByRole("img", { name: "Tier: Rest" })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("+30 XP");

    await userEvent.click(within(list).getByRole("button", { name: /Thu 1 Oct/ }));
    expect(onOpen).toHaveBeenCalledWith("2026-10-01");

    await userEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(0);
    await expectNoA11yViolations(container);
  });

  it("shows 20 rows by default and no View all when every row fits", async () => {
    const twenty = render(
      <Harness character="demo" todayKey={TODAY}>
        <QuestLogPanel todayKey={TODAY} onOpen={() => undefined} onViewAll={() => undefined} />
      </Harness>,
    );
    const list = await screen.findByRole("list", { name: "Logged days" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByRole("button", { name: "View all" })).toBeInTheDocument();
    twenty.unmount();

    render(
      <Harness character="demo" todayKey={TODAY}>
        <QuestLogPanel todayKey={TODAY} limit={100} onOpen={() => undefined} onViewAll={() => undefined} />
      </Harness>,
    );
    const all = await screen.findByRole("list", { name: "Logged days" });
    expect(within(all).getAllByRole("listitem")).toHaveLength(70);
    expect(screen.queryByRole("button", { name: "View all" })).not.toBeInTheDocument();
  });

  it("keeps the ghost out when there is nowhere to go, and says so when nothing is logged", async () => {
    render(
      <Harness character="demo" todayKey={TODAY}>
        <QuestLogPanel todayKey={TODAY} limit={5} onOpen={() => undefined} />
      </Harness>,
    );
    await screen.findByRole("list", { name: "Logged days" });
    expect(screen.queryByRole("button", { name: "View all" })).not.toBeInTheDocument();

    render(
      <Harness character="bare" todayKey={TODAY}>
        <QuestLogPanel todayKey={TODAY} onOpen={() => undefined} />
      </Harness>,
    );
    expect(await screen.findByText("Nothing logged yet.")).toBeInTheDocument();
  });
});
