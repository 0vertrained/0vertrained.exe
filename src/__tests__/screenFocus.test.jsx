// Focus follows the screen: down a level it lands on Back, back up it lands
// on the title when it would otherwise be lost, and a tab press keeps it.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { Header } from "../AppHeader";

function Shell({ bar, row = false }) {
  return (
    <ThemeProvider>
      <div className="ot ovt-app-shell">
        <Header title={bar.title} back={bar.back} onBack={() => {}} close={bar.close} onClose={() => {}} />
        <main id="main">{row && <button type="button">Open strength</button>}</main>
        <nav><button type="button">Fuel</button></nav>
      </div>
    </ThemeProvider>
  );
}

// One shell on the page at a time, as in the app: the hook looks it up.
afterEach(cleanup);

describe("focus follows the screen", () => {
  it("lands on Back when a screen opens one level down", () => {
    const view = render(<Shell bar={{ title: "Progress" }} row />);
    const ui = within(view.container);
    ui.getByRole("button", { name: "Open strength" }).focus();
    view.rerender(<Shell bar={{ title: "Strength", back: "Progress" }} />);
    expect(document.activeElement).toBe(ui.getByRole("button", { name: "Progress" }));
  });

  it("moves again when one deep screen opens another", () => {
    const view = render(<Shell bar={{ title: "History", back: "Progress" }} />);
    const ui = within(view.container);
    view.rerender(<Shell bar={{ title: "Tue, Nov 24", back: "History" }} />);
    expect(document.activeElement).toBe(ui.getByRole("button", { name: "History" }));
  });

  it("lands on Close for a screen that closes instead of going back", () => {
    const view = render(<Shell bar={{ title: "Today" }} />);
    const ui = within(view.container);
    view.rerender(<Shell bar={{ title: "Profile", close: "Close" }} />);
    expect(document.activeElement).toBe(ui.getByRole("button", { name: "Close" }));
  });

  it("lands on the title after Back, since the button that was pressed is gone", () => {
    const view = render(<Shell bar={{ title: "Strength", back: "Progress" }} />);
    const ui = within(view.container);
    ui.getByRole("button", { name: "Progress" }).focus();
    view.rerender(<Shell bar={{ title: "Progress" }} row />);
    expect(document.activeElement).toBe(ui.getByRole("heading", { level: 1, name: "Progress" }));
  });

  it("stays on the tab when a tab is pressed from a deep screen", () => {
    const view = render(<Shell bar={{ title: "Strength", back: "Progress" }} />);
    const ui = within(view.container);
    const tab = ui.getByRole("button", { name: "Fuel" });
    tab.focus();
    view.rerender(<Shell bar={{ title: "Fuel" }} />);
    expect(document.activeElement).toBe(tab);
  });

  it("does nothing on a plain change of tab or on first render", () => {
    const view = render(<Shell bar={{ title: "Today" }} />);
    const ui = within(view.container);
    expect(document.activeElement).toBe(document.body);
    const tab = ui.getByRole("button", { name: "Fuel" });
    tab.focus();
    view.rerender(<Shell bar={{ title: "Fuel" }} />);
    expect(document.activeElement).toBe(tab);
  });
});
