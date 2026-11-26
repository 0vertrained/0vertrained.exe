// Settings, mounted: one page of targets, training cues and theme, with its
// own screens behind rows. Edits stay a draft until Save; theme changes at
// once; it goes back to where it was opened from.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { SettingsScreen } from "../SettingsScreen";
import { DEFAULT_SETTINGS } from "../constants";

afterEach(cleanup);

function mount(props = {}) {
  const calls = { onSave: vi.fn(), onClose: vi.fn(), onThemeChange: vi.fn() };
  const settings = { ...DEFAULT_SETTINGS, goals: { calories: 3400, protein: 200, carbs: 420, fats: 102, water: 120 }, supplements: ["Creatine", "Whey"], dietaryRestrictions: [] };
  const view = render(<ThemeProvider><SettingsScreen settings={settings} busy={false} currentTheme="whitepaperLight" {...calls} {...props} /></ThemeProvider>);
  return { ui: within(view.container), ...calls };
}

describe("Settings", () => {
  it("opens on its page with Close, and says what the targets add up to", () => {
    const { ui, onClose } = mount();
    expect(ui.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(ui.getByText(/add up to/).textContent).toBe("Protein, carbs and fat add up to 3,398\u00a0kcal. Protein is 24% of that.");
    fireEvent.click(ui.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("goes back to the screen it was opened from", () => {
    const { ui, onClose } = mount({ backLabel: "Profile" });
    expect(ui.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Profile" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps edits as a draft until Save, across its screens", () => {
    const { ui, onSave } = mount();
    expect(ui.queryByText("Not saved yet.")).toBeNull();
    fireEvent.change(ui.getByLabelText("Protein (g)"), { target: { value: "210" } });
    fireEvent.click(ui.getByRole("switch", { name: "Sound when rest ends" }));
    expect(ui.getByText("Not saved yet.")).toBeTruthy();

    fireEvent.click(ui.getByRole("button", { name: /^Supplements/ }));
    expect(ui.getByRole("heading", { level: 1, name: "Supplements" })).toBeTruthy();
    fireEvent.change(ui.getByLabelText("Add a supplement"), { target: { value: "Magnesium" } });
    fireEvent.click(ui.getByRole("button", { name: "Add" }));
    fireEvent.click(ui.getByRole("button", { name: "Move Whey up" }));
    fireEvent.click(ui.getByRole("button", { name: "Settings" }));

    fireEvent.click(ui.getByRole("button", { name: /^Dietary restrictions/ }));
    fireEvent.click(ui.getByRole("button", { name: "Gluten-free" }));
    expect(ui.getByRole("button", { name: "Gluten-free" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(ui.getByRole("button", { name: "Settings" }));

    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole("button", { name: "Save settings" }));
    expect(onSave).toHaveBeenCalledWith({
      goals: expect.objectContaining({ protein: 210 }),
      supplements: ["Whey", "Creatine", "Magnesium"],
      dietaryRestrictions: ["gluten-free"],
      trainingCues: expect.objectContaining({ haptics: true, restAudio: true }),
    });
  });

  it("changes the theme at once", () => {
    const { ui, onThemeChange, onSave } = mount();
    fireEvent.click(within(ui.getByRole("radiogroup", { name: "Theme" })).getByRole("radio", { name: "Dark" }));
    expect(onThemeChange).toHaveBeenCalledWith("whitepaperDark");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("checks a new recovery phrase before sending it", () => {
    const { ui } = mount({ initialSection: "account" });
    expect(ui.getByRole("heading", { level: 1, name: "Account" })).toBeTruthy();
    fireEvent.change(ui.getByLabelText("New recovery phrase"), { target: { value: "short" } });
    fireEvent.click(ui.getByRole("button", { name: "Update recovery phrase" }));
    expect(ui.getByRole("alert").textContent).toBe("Recovery phrase must be at least 8 characters.");
    fireEvent.click(ui.getByRole("button", { name: "Suggest a strong phrase" }));
    expect(ui.getByLabelText("New recovery phrase").value.length).toBeGreaterThanOrEqual(8);
    expect(ui.getByLabelText("Confirm the new phrase").value).toBe(ui.getByLabelText("New recovery phrase").value);
  });

  it("lists the three wearables, each not connected until it says so", async () => {
    const { ui } = mount({ initialSection: "integrations" });
    for (const name of ["Oura", "Whoop", "Strava"]) {
      const card = within(ui.getByRole("heading", { level: 2, name }).closest("section"));
      expect(card.getByText("Not connected")).toBeTruthy();
    }
    expect(ui.getByText("Powered by Strava")).toBeTruthy();
    expect(ui.queryByText(/Fitbit|Google Health/)).toBeNull();
  });
});
